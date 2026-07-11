/*
 * mqtt-bridge.js - Pont MQTT → PostgreSQL + Socket.IO
 * Andon KA01 - Intégration Wokwi ESP32
 * 
 * Ce module s'intègre à server.js existant sans modification
 * Exporte une fonction init() qui prend (pool, io) en paramètres
 */

const mqtt = require('mqtt');

// Configuration MQTT (même broker que Wokwi)
const MQTT_HOST = process.env.MQTT_HOST || 'broker.hivemq.com';
const MQTT_PORT = process.env.MQTT_PORT || 1883;
const MQTT_USER = process.env.MQTT_USER || '';
const MQTT_PASS = process.env.MQTT_PASS || '';

// Topics
const TOPIC_ALERT   = 'factory/ligne1/andon/alert';
const TOPIC_RESOLVE = 'factory/ligne1/andon/resolve';
const TOPIC_AUTH    = 'factory/ligne1/operator/auth';
const TOPIC_HEART   = 'factory/ligne1/andon/heartbeat';

let mqttClient = null;
let poolRef = null;
let ioRef = null;

// Mapping alerte Wokwi → alert_type SMI
function mapAlertType(code) {
  const map = {
    'DOWNTIME':    'Electrique',
    'MAINTENANCE': 'Mecanique',
    'BREAK':       'Pause',
    'WAIT_MATERIAL':'Logistique',
    'QUALITY':     'Qualite',
    'SETUP':       'Setup',
    'CLEANING':    'Nettoyage',
    'SAFETY':      'Securite'
  };
  return map[code] || 'Electrique';
}

// Mapping criticité par défaut
function mapCriticite(code) {
  const map = {
    'DOWNTIME':    'Majeure',
    'MAINTENANCE': 'Moderee',
    'BREAK':       'Faible',
    'WAIT_MATERIAL':'Moyenne',
    'QUALITY':     'Moderee',
    'SETUP':       'Faible',
    'CLEANING':    'Faible',
    'SAFETY':      'Critique'
  };
  return map[code] || 'Moyenne';
}

// Insérer alerte MQTT dans downtime_logs (même format que ton API)
async function insertAlert(payload) {
  try {
    const machine = payload.machine || 'M01';
    const code = payload.code || payload.type || 'DOWNTIME';
    const operator = payload.operator || 'Opérateur_Wokwi';
    const alertType = mapAlertType(code);
    const criticite = mapCriticite(code);
    const now = new Date();
    const timeStr = now.toLocaleTimeString('fr-FR', { hour12: false });

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
        'En attente',      // $5 status
        criticite,         // $6 criticite
        alertType,         // $7 alert_type
        null,              // $8 heure_arret_technicien
        `Alerte Wokwi: ${code} par ${operator}`,  // $9 piece_observation
        deriveAtelier(machine),  // $10 atelier
        now,               // $11 date_panne
        now                // $12 created_at
      ]
    );

    const newLog = result.rows[0];
    console.log(`[MQTT→DB] Alerte insérée - ID: ${newLog.id} | Machine: ${machine} | Type: ${alertType}`);

    // Émettre vers frontend (même format que ton API /api/logs)
    ioRef.emit('machineStatusChanged', {
      machine: newLog.machine,
      status: newLog.status,
      alert_type: newLog.alert_type,
      criticite: newLog.criticite,
      logId: newLog.id,
      source: 'wokwi_mqtt'
    });

    return newLog;
  } catch (err) {
    console.error('[MQTT→DB] Erreur insertion:', err.message);
    throw err;
  }
}

// Résoudre alerte (scan RFID)
async function resolveAlert(payload) {
  try {
    const machine = payload.machine || 'M01';
    const resolvedBy = payload.resolvedBy || 'Technicien_RFID';
    const now = new Date();

    // Mettre à jour le dernier log non résolu
    const result = await poolRef.query(
      `UPDATE downtime_logs 
       SET status = 'Termine', 
           resolved_by = $1,
           date_reparation = $2,
           duration = GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_panne)) / 60)::INTEGER,
           updated_at = $2
       WHERE machine = $3 AND resolved_at IS NULL AND status != 'Termine'
       ORDER BY created_at DESC 
       LIMIT 1
       RETURNING *;`,
      [resolvedBy, now, machine]
    );

    if (result.rows.length > 0) {
      const updatedLog = result.rows[0];
      console.log(`[MQTT→DB] Alerte résolue - ID: ${updatedLog.id} | Par: ${resolvedBy}`);

      ioRef.emit('machineStatusChanged', {
        machine: updatedLog.machine,
        status: 'Termine',
        alert_type: updatedLog.alert_type,
        criticite: updatedLog.criticite,
        logId: updatedLog.id,
        source: 'wokwi_resolve'
      });

      return updatedLog;
    } else {
      console.log('[MQTT→DB] Aucune alerte ouverte à résoudre pour', machine);
    }
  } catch (err) {
    console.error('[MQTT→DB] Erreur résolution:', err.message);
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

// Initialiser le pont MQTT
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
    console.log('  MQTT BRIDGE CONNECTÉ');
    console.log('  Broker:', MQTT_HOST + ':' + MQTT_PORT);
    console.log('========================================');

    mqttClient.subscribe([
      TOPIC_ALERT,
      TOPIC_RESOLVE,
      TOPIC_AUTH,
      TOPIC_HEART
    ], (err) => {
      if (err) {
        console.error('[MQTT] Erreur subscription:', err.message);
      } else {
        console.log('  Topics abonnés:');
        console.log('    -', TOPIC_ALERT);
        console.log('    -', TOPIC_RESOLVE);
        console.log('    -', TOPIC_AUTH);
        console.log('    -', TOPIC_HEART);
        console.log('========================================');
        console.log('');
      }
    });
  });

  mqttClient.on('error', (err) => {
    console.error('[MQTT] Erreur:', err.message);
  });

  mqttClient.on('reconnect', () => {
    console.log('[MQTT] Reconnexion...');
  });

  mqttClient.on('offline', () => {
    console.warn('[MQTT] Client hors ligne');
  });

  mqttClient.on('message', async (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      console.log('[MQTT] RX [' + topic + ']:', JSON.stringify(payload).substring(0, 200));

      switch (topic) {
        case TOPIC_ALERT:
          if (payload.type === 'SYSTEM') {
            console.log('[MQTT] Message système ignoré');
            return;
          }
          await insertAlert(payload);
          break;

        case TOPIC_RESOLVE:
          await resolveAlert(payload);
          break;

        case TOPIC_AUTH:
          await authOperator(payload);
          break;

        case TOPIC_HEART:
          // Heartbeat: juste log, pas d'action DB
          console.log('[MQTT] Heartbeat - État:', payload.state, '| RSSI:', payload.rssi);
          break;

        default:
          console.log('[MQTT] Topic inconnu:', topic);
      }
    } catch (err) {
      console.error('[MQTT] Erreur traitement message:', err.message);
    }
  });

  // Retourner le client pour usage externe si besoin
  return mqttClient;
}

// Fonction pour publier un message (si besoin de commander Wokwi depuis backend)
function publish(topic, message) {
  if (mqttClient && mqttClient.connected) {
    mqttClient.publish(topic, JSON.stringify(message));
    console.log('[MQTT] TX [' + topic + ']:', message);
  } else {
    console.warn('[MQTT] Client non connecté, impossible de publier');
  }
}

// Fonction pour obtenir l'état de connexion
function isConnected() {
  return mqttClient ? mqttClient.connected : false;
}

module.exports = { init, publish, isConnected };