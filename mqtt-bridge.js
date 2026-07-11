/*
 * mqtt-bridge.js - Pont MQTT → PostgreSQL + Socket.IO
 * Andon KA01 - Intégration Wokwi ESP32 (5 États)
 * 
 * 5 États Wokwi supportés:
 *   🔴 DOWNTIME     → downtime     (Panne)
 *   🔵 MAINTENANCE  → maintenance  (Maintenance)
 *   🟡 BREAK        → break        (Break / Pause)
 *   🟠 WAIT_MATERIAL→ material     (Manque Matériel)
 *   🟢 OPERATIONAL  → operational  (Résolu)
 * 
 * FIX: Topic MQTT aligné avec Wokwi: factory/ligne1/andon/alert
 * FIX: Payload parsing corrigé (machine_id, status, type)
 */

const mqtt = require('mqtt');

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION MQTT (même broker que Wokwi ESP32)
// ═══════════════════════════════════════════════════════════════════
const MQTT_HOST = process.env.MQTT_HOST || 'broker.hivemq.com';
const MQTT_PORT = process.env.MQTT_PORT || 1883;
const MQTT_USER = process.env.MQTT_USER || '';
const MQTT_PASS = process.env.MQTT_PASS || '';

// ✅ TOPICS MQTT - ALIGNÉS AVEC WOKWI
const TOPIC_ALERT   = 'factory/ligne1/andon/alert';      // ← FIX: même topic que Wokwi
const TOPIC_RESOLVE = 'factory/ligne1/andon/resolve';      // ← FIX: topic resolve
const TOPIC_AUTH    = 'factory/ligne1/andon/auth';         // ← FIX: topic auth
const TOPIC_HEART   = 'andon/zone/ka/machine/ka01/heartbeat';

let mqttClient = null;
let poolRef = null;
let ioRef = null;

// ═══════════════════════════════════════════════════════════════════
// MAPPING 5 ÉTATS WOKWI → DASHBOARD
// ═══════════════════════════════════════════════════════════════════

// Mapping status Wokwi → alert_type (affichage dashboard)
function mapAlertType(statusOrType) {
  const upper = String(statusOrType).toUpperCase();
  const map = {
    'DOWNTIME':      'Panne',
    'MAINTENANCE':   'Maintenance',
    'BREAK':         'Break / Pause',
    'WAIT_MATERIAL': 'Manque Matériel',
    'OPERATIONAL':   'Résolu',
    'PANNE':         'Panne',
    'BREAK / PAUSE': 'Break / Pause',
    'MANQUE MATÉRIEL': 'Manque Matériel',
    'RÉSOLU':        'Résolu'
  };
  return map[upper] || map[statusOrType] || 'Panne';
}

// Mapping status Wokwi → status dashboard (5 valeurs)
function mapDashboardStatus(status) {
  const upper = String(status).toUpperCase();
  const map = {
    'DOWNTIME':      'downtime',
    'MAINTENANCE':   'maintenance',
    'BREAK':         'break',
    'WAIT_MATERIAL': 'material',
    'OPERATIONAL':   'operational',
    'PENDING':       'downtime',
    'EN ATTENTE':    'downtime',
    'EN PANNE':      'downtime'
  };
  return map[upper] || 'downtime';
}

// Mapping criticité par défaut
function mapCriticite(status) {
  const upper = String(status).toUpperCase();
  const map = {
    'DOWNTIME':      'Majeure',
    'MAINTENANCE':   'Moderee',
    'BREAK':         'Faible',
    'WAIT_MATERIAL': 'Moyenne',
    'OPERATIONAL':   'Faible'
  };
  return map[upper] || 'Moyenne';
}

// ═══════════════════════════════════════════════════════════════════
// FONCTIONS DB
// ═══════════════════════════════════════════════════════════════════

// ✅ Insérer alerte MQTT dans downtime_logs
async function insertAlert(payload) {
  try {
    // 🔧 FIX: Wokwi envoie machine_id, pas machine
    const machine = payload.machine_id || payload.machine || 'KA01';

    // 🔧 FIX: Wokwi envoie status + type séparément
    const wokwiStatus = payload.status || payload.code || 'DOWNTIME';
    const wokwiType = payload.type || mapAlertType(wokwiStatus);

    const operator = payload.operator || 'Opérateur_Wokwi';
    const alertType = mapAlertType(wokwiType);
    const criticite = mapCriticite(wokwiStatus);
    const dbStatus = (wokwiStatus === 'OPERATIONAL') ? 'Resolved' : 'Pending';
    const now = new Date();
    const timeStr = now.toLocaleTimeString('fr-FR', { hour12: false });

    console.log(`[MQTT→DB] Traitement alerte: machine=${machine}, status=${wokwiStatus}, type=${wokwiType}`);

    const result = await poolRef.query(
      `INSERT INTO downtime_logs 
       (machine, start_time, duration, technician, status, criticite, alert_type, 
        heure_arret_technicien, piece_observation, atelier, date_panne, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
       RETURNING *;`,
      [
        machine,           // $1
        timeStr,           // $2 start_time
        0,                 // $3 duration
        'Non assigne',     // $4 technician
        dbStatus,          // $5 status ← 'Pending' ou 'Resolved'
        criticite,         // $6 criticite
        alertType,         // $7 alert_type ← 'Panne', 'Maintenance', etc.
        null,              // $8 heure_arret_technicien
        `Alerte Wokwi: ${wokwiStatus} (${wokwiType}) par ${operator}`,  // $9 piece_observation
        deriveAtelier(machine),  // $10 atelier
        now,               // $11 date_panne
        now                // $12 created_at
      ]
    );

    const newLog = result.rows[0];
    console.log(`[MQTT→DB] ✅ Alerte insérée - ID: ${newLog.id} | Machine: ${machine} | Type: ${alertType} | DB Status: ${dbStatus}`);

    // ✅ ÉMETTRE VERS DASHBOARD AVEC 5 ÉTATS
    const dashboardStatus = mapDashboardStatus(wokwiStatus);

    ioRef.emit('updateMachines', [{
      code: machine,
      status: dashboardStatus,      // ← 5 valeurs: downtime/maintenance/break/material/operational
      type_erreur: alertType,
      criticite: criticite,
      logId: newLog.id,
      operator: operator,
      source: 'wokwi_mqtt',
      timestamp: Date.now()
    }]);

    // Émettre aussi l'event legacy pour compatibilité
    ioRef.emit('machineStatusChanged', {
      machine: machine,
      status: dbStatus,
      alert_type: alertType,
      criticite: criticite,
      logId: newLog.id,
      source: 'wokwi_mqtt'
    });

    return newLog;
  } catch (err) {
    console.error('[MQTT→DB] ❌ Erreur insertion:', err.message);
    throw err;
  }
}

// ✅ Résoudre alerte (bouton RESOLVE ou RFID)
async function resolveAlert(payload) {
  try {
    const machine = payload.machine_id || payload.machine || 'KA01';
    const resolvedBy = payload.resolvedBy || payload.operator || 'Technicien_RFID';
    const now = new Date();

    // Mettre à jour le dernier log non résolu
    const result = await poolRef.query(
      `UPDATE downtime_logs 
       SET status = 'Resolved', 
           resolved_by = $1,
           date_reparation = $2,
           duration = GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_panne)) / 60)::INTEGER,
           updated_at = $2
       WHERE machine = $3 AND resolved_at IS NULL AND status != 'Resolved'
       ORDER BY created_at DESC 
       LIMIT 1
       RETURNING *;`,
      [resolvedBy, now, machine]
    );

    if (result.rows.length > 0) {
      const updatedLog = result.rows[0];
      console.log(`[MQTT→DB] ✅ Alerte résolue - ID: ${updatedLog.id} | Par: ${resolvedBy}`);

      // ✅ ÉMETTRE STATUS OPERATIONAL VERS DASHBOARD
      ioRef.emit('updateMachines', [{
        code: updatedLog.machine,
        status: 'operational',
        type_erreur: 'Résolu',
        criticite: 'Faible',
        logId: updatedLog.id,
        source: 'wokwi_resolve',
        timestamp: Date.now()
      }]);

      ioRef.emit('machineStatusChanged', {
        machine: updatedLog.machine,
        status: 'Resolved',
        alert_type: updatedLog.alert_type,
        criticite: updatedLog.criticite,
        logId: updatedLog.id,
        source: 'wokwi_resolve'
      });

      return updatedLog;
    } else {
      console.log('[MQTT→DB] ⚠️ Aucune alerte ouverte à résoudre pour', machine);
    }
  } catch (err) {
    console.error('[MQTT→DB] ❌ Erreur résolution:', err.message);
    throw err;
  }
}

// Enregistrer opérateur RFID
async function authOperator(payload) {
  try {
    const uid = payload.uid || 'UNKNOWN';
    const name = payload.name || 'Opérateur_' + uid;

    await poolRef.query(
      `INSERT INTO operators (uid, name, role) 
       VALUES ($1, $2, 'operator')
       ON CONFLICT (uid) DO UPDATE SET name = $2, role = 'operator';`,
      [uid, name]
    );

    console.log(`[MQTT→DB] Opérateur enregistré: ${name} (UID: ${uid})`);
  } catch (err) {
    console.error('[MQTT→DB] Erreur auth opérateur:', err.message);
  }
}

// Helper: dériver atelier depuis code machine
function deriveAtelier(machine) {
  if (!machine) return 'Atelier General';
  const prefix = String(machine).substring(0, 2).toUpperCase();
  const map = { 
    'KA': 'Atelier A', 
    'KB': 'Atelier B', 
    'KC': 'Atelier C', 
    'KD': 'Atelier D', 
    'KX': 'Atelier X',
    'M0': 'Atelier Wokwi'
  };
  return map[prefix] || 'Atelier Wokwi';
}

// ═══════════════════════════════════════════════════════════════════
// INITIALISATION MQTT
// ═══════════════════════════════════════════════════════════════════
function init(pool, io) {
  poolRef = pool;
  ioRef = io;

  const mqttUrl = MQTT_USER 
    ? `mqtts://${MQTT_USER}:${MQTT_PASS}@${MQTT_HOST}:${MQTT_PORT}` 
    : `mqtt://${MQTT_HOST}:${MQTT_PORT}`;

  mqttClient = mqtt.connect(mqttUrl, {
    clientId: 'smi-enterprise-mqtt-bridge-' + Math.random().toString(16).substr(2, 8),
    reconnectPeriod: 5000,
    connectTimeout: 30000,
    clean: true
  });

  mqttClient.on('connect', () => {
    console.log('');
    console.log('========================================');
    console.log('  MQTT BRIDGE CONNECTÉ (5 ÉTATS)');
    console.log('  Broker:', MQTT_HOST + ':' + MQTT_PORT);
    console.log('========================================');

    mqttClient.subscribe([
      TOPIC_ALERT,
      TOPIC_RESOLVE,
      TOPIC_AUTH,
      TOPIC_HEART
    ], (err) => {
      if (err) {
        console.error('[MQTT] ❌ Erreur subscription:', err.message);
      } else {
        console.log('  ✅ Topics abonnés:');
        console.log('     -', TOPIC_ALERT);
        console.log('     -', TOPIC_RESOLVE);
        console.log('     -', TOPIC_AUTH);
        console.log('     -', TOPIC_HEART);
        console.log('========================================');
        console.log('');
      }
    });
  });

  mqttClient.on('error', (err) => {
    console.error('[MQTT] ❌ Erreur:', err.message);
  });

  mqttClient.on('reconnect', () => {
    console.log('[MQTT] 🔄 Reconnexion...');
  });

  mqttClient.on('offline', () => {
    console.warn('[MQTT] ⚠️ Client hors ligne');
  });

  mqttClient.on('message', async (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      console.log('[MQTT] 📨 RX [' + topic + ']:', JSON.stringify(payload).substring(0, 300));

      switch (topic) {
        case TOPIC_ALERT:
          if (payload.type === 'SYSTEM') {
            console.log('[MQTT] ℹ️ Message système ignoré');
            return;
          }
          // 🔧 FIX: Vérifier si c'est un RESOLVE (status OPERATIONAL)
          const status = payload.status || '';
          if (status === 'OPERATIONAL' || status === 'operational') {
            console.log('[MQTT] 🟢 Résolution détectée pour', payload.machine_id || payload.machine);
            await resolveAlert(payload);
          } else {
            console.log('[MQTT] 🔴 Alerte détectée:', status);
            await insertAlert(payload);
          }
          break;

        case TOPIC_RESOLVE:
          console.log('[MQTT] 🟢 Topic resolve reçu');
          await resolveAlert(payload);
          break;

        case TOPIC_AUTH:
          await authOperator(payload);
          break;

        case TOPIC_HEART:
          console.log('[MQTT] 💓 Heartbeat - État:', payload.state, '| RSSI:', payload.rssi);
          break;

        default:
          console.log('[MQTT] ❓ Topic inconnu:', topic);
      }
    } catch (err) {
      console.error('[MQTT] ❌ Erreur traitement message:', err.message);
    }
  });

  return mqttClient;
}

// ═══════════════════════════════════════════════════════════════════
// FONCTIONS UTILITAIRES
// ═══════════════════════════════════════════════════════════════════

// Publier un message MQTT (commander Wokwi depuis backend)
function publish(topic, message) {
  if (mqttClient && mqttClient.connected) {
    mqttClient.publish(topic, JSON.stringify(message));
    console.log('[MQTT] 📤 TX [' + topic + ']:', message);
  } else {
    console.warn('[MQTT] ⚠️ Client non connecté, impossible de publier');
  }
}

// Vérifier connexion MQTT
function isConnected() {
  return mqttClient ? mqttClient.connected : false;
}

module.exports = { init, publish, isConnected };