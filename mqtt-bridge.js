/*
 * mqtt-bridge-v2.js - Pont MQTT → PostgreSQL + Socket.IO (Robuste)
 * Andon KA01 - Intégration Wokwi ESP32 (5 États)
 * 
 * FIXES v2:
 *   - QoS 1 pour fiabilité
 *   - Clean Session = false (persist subscriptions)
 *   - Last Will Testament (LWT)
 *   - Message queue pour offline
 *   - Reconnection optimisée
 *   - Heartbeat monitoring
 */

const mqtt = require('mqtt');

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION MQTT
// ═══════════════════════════════════════════════════════════════════
const MQTT_HOST = process.env.MQTT_HOST || 'broker.hivemq.com';
const MQTT_PORT = process.env.MQTT_PORT || 1883;
const MQTT_USER = process.env.MQTT_USER || '';
const MQTT_PASS = process.env.MQTT_PASS || '';

// Topics
const TOPIC_ALERT   = 'factory/ligne1/andon/alert';
const TOPIC_RESOLVE = 'factory/ligne1/andon/resolve';
const TOPIC_AUTH    = 'factory/ligne1/andon/auth';
const TOPIC_HEART   = 'andon/zone/ka/machine/ka01/heartbeat';
const TOPIC_STATUS  = 'factory/ligne1/andon/status';  // LWT topic

let mqttClient = null;
let poolRef = null;
let ioRef = null;
let isConnected = false;
let messageQueue = [];
let reconnectCount = 0;
const MAX_RECONNECT = 10;

// ═══════════════════════════════════════════════════════════════════
// MAPPING Wokwi → Dashboard
// ═══════════════════════════════════════════════════════════════════
function mapWokwiToDashboard(payload) {
    const status = (payload.status || '').toString().toUpperCase().trim();
    const type   = (payload.type || '').toString().trim();

    const statusMap = {
        'DOWNTIME': 'downtime',
        'MAINTENANCE': 'maintenance',
        'BREAK': 'break',
        'WAIT_MATERIAL': 'material',
        'OPERATIONAL': 'operational',
        'PENDING': 'downtime',
        'EN ATTENTE': 'downtime',
        'EN PANNE': 'downtime'
    };

    const typeMap = {
        'DOWNTIME': 'Panne',
        'MAINTENANCE': 'Maintenance',
        'BREAK': 'Break / Pause',
        'WAIT_MATERIAL': 'Manque Matériel',
        'OPERATIONAL': 'Résolu',
        'PANNE': 'Panne',
        'BREAK / PAUSE': 'Break / Pause',
        'MANQUE MATÉRIEL': 'Manque Matériel',
        'RÉSOLU': 'Résolu'
    };

    const mappedStatus = statusMap[status] || 'downtime';
    const mappedType = type || typeMap[status] || 'Panne';

    return {
        machine: payload.machine_id || payload.machine || 'KA01',
        zone: payload.zone || 'KA',
        status: mappedStatus,
        alert_type: mappedType,
        operator: payload.operator || 'Op_0102',
        timestamp: payload.timestamp || Date.now()
    };
}

function mapCriticite(status) {
    const map = {
        'downtime': 'Majeure',
        'maintenance': 'Moderee',
        'break': 'Faible',
        'material': 'Moyenne',
        'operational': 'Faible'
    };
    return map[status] || 'Moyenne';
}

// ═══════════════════════════════════════════════════════════════════
// FONCTIONS DB
// ═══════════════════════════════════════════════════════════════════

async function insertAlert(payload) {
    try {
        const mapped = mapWokwiToDashboard(payload);
        const now = new Date();
        const timeStr = now.toLocaleTimeString('fr-FR', { hour12: false });

        console.log(`[MQTT→DB] 📨 Traitement: machine=${mapped.machine}, status=${mapped.status}, type=${mapped.alert_type}`);

        const result = await poolRef.query(
            `INSERT INTO downtime_logs 
             (machine, start_time, duration, technician, status, criticite, alert_type, 
              heure_arret_technicien, piece_observation, atelier, date_panne, created_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
             RETURNING *;`,
            [
                mapped.machine,
                timeStr,
                0,
                'Non assigne',
                mapped.status === 'operational' ? 'Resolved' : 'Pending',
                mapCriticite(mapped.status),
                mapped.alert_type,
                null,
                `Alerte Wokwi: ${mapped.status} (${mapped.alert_type}) par ${mapped.operator}`,
                mapped.zone,
                now,
                now
            ]
        );

        const newLog = result.rows[0];
        console.log(`[MQTT→DB] ✅ Inséré - ID: ${newLog.id} | ${mapped.machine} | ${mapped.status} | ${mapped.alert_type}`);
        emitToDashboard(mapped, newLog.id);
        return newLog;
    } catch (err) {
        console.error('[MQTT→DB] ❌ Erreur insertion:', err.message);
        throw err;
    }
}

async function resolveAlert(payload) {
    try {
        const mapped = mapWokwiToDashboard(payload);
        const resolvedBy = payload.resolvedBy || payload.operator || 'Technicien_RFID';
        const now = new Date();

        console.log(`[MQTT→DB] 🟢 Résolution: ${mapped.machine} par ${resolvedBy}`);

        const result = await poolRef.query(
            `UPDATE downtime_logs 
             SET status = 'Resolved', 
                 resolved_by = $1,
                 date_reparation = $2,
                 duration = GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_panne)) / 60)::INTEGER,
                 updated_at = $2
             WHERE machine = $3 AND status != 'Resolved'
             ORDER BY created_at DESC 
             LIMIT 1
             RETURNING *;`,
            [resolvedBy, now, mapped.machine]
        );

        if (result.rows.length > 0) {
            const updatedLog = result.rows[0];
            console.log(`[MQTT→DB] ✅ Résolu - ID: ${updatedLog.id}`);
            mapped.status = 'operational';
            mapped.alert_type = 'Résolu';
            emitToDashboard(mapped, updatedLog.id, 'wokwi_resolve');
            return updatedLog;
        } else {
            console.log(`[MQTT→DB] ⚠️ Aucune alerte ouverte pour ${mapped.machine}`);
        }
    } catch (err) {
        console.error('[MQTT→DB] ❌ Erreur résolution:', err.message);
        throw err;
    }
}

function emitToDashboard(mapped, logId, source = 'wokwi_mqtt') {
    if (!ioRef) {
        console.warn('[MQTT→Socket] ⚠️ ioRef non initialisé');
        return;
    }

    const payload = {
        code: mapped.machine,
        status: mapped.status,
        type_erreur: mapped.alert_type,
        criticite: mapCriticite(mapped.status),
        logId: logId,
        operator: mapped.operator,
        source: source,
        timestamp: Date.now()
    };

    ioRef.emit('updateMachines', [payload]);
    ioRef.emit('machineStatusChanged', {
        machine: mapped.machine,
        status: mapped.status === 'operational' ? 'Resolved' : 'Pending',
        alert_type: mapped.alert_type,
        criticite: mapCriticite(mapped.status),
        logId: logId,
        source: source
    });

    console.log(`[MQTT→Socket] 📡 Emit: ${JSON.stringify(payload)}`);
}

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
        console.log(`[MQTT→DB] Opérateur: ${name} (UID: ${uid})`);
    } catch (err) {
        console.error('[MQTT→DB] Erreur auth:', err.message);
    }
}

// ═══════════════════════════════════════════════════════════════════
// INITIALISATION MQTT (ROBUSTE)
// ═══════════════════════════════════════════════════════════════════
function init(pool, io) {
    poolRef = pool;
    ioRef = io;

    const mqttUrl = MQTT_USER 
        ? `mqtts://${MQTT_USER}:${MQTT_PASS}@${MQTT_HOST}:${MQTT_PORT}` 
        : `mqtt://${MQTT_HOST}:${MQTT_PORT}`;

    const clientId = 'smi-andon-bridge-' + Math.random().toString(16).substr(2, 8);

    mqttClient = mqtt.connect(mqttUrl, {
        clientId: clientId,
        reconnectPeriod: 3000,      // ← 3s (moins que 5s)
        connectTimeout: 10000,       // ← 10s (moins que 30s)
        clean: false,                // ← PERSIST subscriptions!
        keepalive: 30,              // ← Ping every 30s
        resubscribe: true,          // ← Auto-resubscribe on reconnect
        will: {                     // ← Last Will Testament
            topic: TOPIC_STATUS,
            payload: JSON.stringify({
                machine_id: 'KA01',
                status: 'OFFLINE',
                timestamp: Date.now()
            }),
            qos: 1,
            retain: true
        }
    });

    // ═══ EVENT: CONNECT ═══
    mqttClient.on('connect', (connack) => {
        isConnected = true;
        reconnectCount = 0;

        console.log('');
        console.log('========================================');
        console.log('  ✅ MQTT BRIDGE CONNECTÉ');
        console.log('  Broker:', MQTT_HOST + ':' + MQTT_PORT);
        console.log('  Client ID:', clientId);
        console.log('  Session present:', connack.sessionPresent);
        console.log('========================================');

        // Subscribe avec QoS 1 (format correct pour mqtt.js)
        mqttClient.subscribe({
            [TOPIC_ALERT]: { qos: 1 },
            [TOPIC_RESOLVE]: { qos: 1 },
            [TOPIC_AUTH]: { qos: 1 },
            [TOPIC_HEART]: { qos: 0 }
        }, (err) => {
            if (err) {
                console.error('[MQTT] ❌ Subscribe error:', err.message);
            } else {
                console.log('  ✅ Subscribed:');
                console.log('     -', TOPIC_ALERT, '(QoS 1)');
                console.log('     -', TOPIC_RESOLVE, '(QoS 1)');
                console.log('     -', TOPIC_AUTH, '(QoS 1)');
                console.log('     -', TOPIC_HEART, '(QoS 0)');
                console.log('========================================');
                console.log('');
            }
        });

        // Flush message queue
        if (messageQueue.length > 0) {
            console.log(`[MQTT] 📤 Flushing ${messageQueue.length} queued messages`);
            while (messageQueue.length > 0) {
                const msg = messageQueue.shift();
                mqttClient.publish(msg.topic, msg.payload, { qos: 1, retain: true });
            }
        }
    });

    // ═══ EVENT: ERROR ═══
    mqttClient.on('error', (err) => {
        console.error('[MQTT] ❌ Error:', err.message);
        isConnected = false;
    });

    // ═══ EVENT: RECONNECT ═══
    mqttClient.on('reconnect', () => {
        reconnectCount++;
        console.log(`[MQTT] 🔄 Reconnecting... (attempt ${reconnectCount}/${MAX_RECONNECT})`);
        if (reconnectCount >= MAX_RECONNECT) {
            console.error('[MQTT] ❌ Max reconnections reached!');
            mqttClient.end(true);
        }
    });

    // ═══ EVENT: OFFLINE ═══
    mqttClient.on('offline', () => {
        console.warn('[MQTT] ⚠️ Client offline');
        isConnected = false;
    });

    // ═══ EVENT: CLOSE ═══
    mqttClient.on('close', () => {
        console.warn('[MQTT] 🔌 Connection closed');
        isConnected = false;
    });

    // ═══ EVENT: MESSAGE ═══
    mqttClient.on('message', async (topic, message, packet) => {
        try {
            const payload = JSON.parse(message.toString());
            console.log(`[MQTT] 📨 RX [${topic}] QoS:${packet.qos}:`, JSON.stringify(payload).substring(0, 300));

            switch (topic) {
                case TOPIC_ALERT:
                    if (payload.type === 'SYSTEM') {
                        console.log('[MQTT] ℹ️ System message ignored');
                        return;
                    }
                    const status = (payload.status || '').toString().toUpperCase().trim();
                    if (status === 'OPERATIONAL' || status === 'RESOLVED') {
                        console.log('[MQTT] 🟢 Resolve:', payload.machine_id || payload.machine);
                        await resolveAlert(payload);
                    } else {
                        console.log('[MQTT] 🔴 Alert:', status);
                        await insertAlert(payload);
                    }
                    break;

                case TOPIC_RESOLVE:
                    console.log('[MQTT] 🟢 Resolve topic');
                    await resolveAlert(payload);
                    break;

                case TOPIC_AUTH:
                    await authOperator(payload);
                    break;

                case TOPIC_HEART:
                    console.log('[MQTT] 💓 Heartbeat:', payload.state, '| RSSI:', payload.rssi);
                    break;

                default:
                    console.log('[MQTT] ❓ Unknown topic:', topic);
            }
        } catch (err) {
            console.error('[MQTT] ❌ Parse error:', err.message);
        }
    });

    return mqttClient;
}

// ═══════════════════════════════════════════════════════════════════
// FONCTIONS UTILITAIRES
// ═══════════════════════════════════════════════════════════════════

function publish(topic, message) {
    if (mqttClient && isConnected) {
        mqttClient.publish(topic, JSON.stringify(message), { qos: 1, retain: true });
        console.log('[MQTT] 📤 TX [' + topic + ']:', message);
    } else {
        console.warn('[MQTT] ⚠️ Offline, queuing message');
        messageQueue.push({ topic, payload: JSON.stringify(message) });
    }
}

function getStatus() {
    return {
        connected: isConnected,
        reconnectCount: reconnectCount,
        queuedMessages: messageQueue.length
    };
}

module.exports = { init, publish, getStatus };