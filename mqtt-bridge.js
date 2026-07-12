const mqtt = require('mqtt');

// ============================================================================
// CONFIGURATION TOPICS
// ============================================================================
const TOPIC_ALERT = 'factory/ligne1/andon/alert';
const TOPIC_STATUS = 'factory/ligne1/andon/status';
const TOPIC_HEART = 'andon/zone/ka/machine/ka01/heartbeat';

// ============================================================================
// ÉTAT GLOBAL
// ============================================================================
let poolRef = null;
let ioRef = null;
let mqttClient = null;
let isConnected = false;
let messageQueue = [];

// Mapping des statuts ESP32 → Dashboard
const STATUS_MAP = {
    'DOWNTIME':      { db: 'downtime',    color: 'red',    label: 'Panne' },
    'MAINTENANCE':   { db: 'maintenance', color: 'blue',   label: 'Maintenance' },
    'BREAK':         { db: 'break',       color: 'yellow', label: 'Break / Pause' },
    'MATERIAL':      { db: 'material',    color: 'orange', label: 'Material' },
    'WAIT_MATERIAL': { db: 'material',    color: 'orange', label: 'Manque Matériel' },
    'RESOLVED':      { db: 'operational', color: 'green',  label: 'Operational' },
    'OPERATIONAL':   { db: 'operational', color: 'green',  label: 'Operational' }
};

// ============================================================================
// INITIALISATION
// ============================================================================
function init(pool, io) {
    poolRef = pool;
    ioRef = io;

    const mqttUrl = process.env.MQTT_URL || 'mqtt://broker.hivemq.com:1883';

    mqttClient = mqtt.connect(mqttUrl, {
        clientId: 'smi-andon-bridge-' + Math.random().toString(16).substr(2, 8),
        reconnectPeriod: 3000,
        connectTimeout: 10000,
        clean: false,
        keepalive: 30,
        will: {
            topic: TOPIC_STATUS,
            payload: JSON.stringify({ machine_id: 'BRIDGE', status: 'OFFLINE', timestamp: Date.now() }),
            qos: 1,
            retain: true
        }
    });

    // --- CONNECT ---
    mqttClient.on('connect', () => {
        isConnected = true;
        console.log('✅ MQTT BRIDGE CONNECTÉ');
        console.log('========================================');
        console.log('  Broker:', mqttUrl);
        console.log('  Client ID:', mqttClient.options.clientId);
        console.log('  Session present:', mqttClient.options.sessionPresent || false);
        console.log('========================================');

        // Flush la file d'attente
        while (messageQueue.length > 0) {
            const msg = messageQueue.shift();
            mqttClient.publish(msg.topic, msg.payload, { qos: 1, retain: true });
        }

        // Subscribe avec QoS
        mqttClient.subscribe({
            [TOPIC_ALERT]: { qos: 1 },
            [TOPIC_HEART]: { qos: 0 }
        }, (err) => {
            if (err) {
                console.error('❌ Erreur subscribe:', err.message);
            } else {
                console.log('  ✅ Subscribed:');
                console.log('     -', TOPIC_ALERT, '(QoS 1)');
                console.log('     -', TOPIC_HEART, '(QoS 0)');
                console.log('========================================');
            }
        });

        // Publish status ONLINE
        mqttClient.publish(TOPIC_STATUS, JSON.stringify({
            machine_id: 'BRIDGE',
            status: 'ONLINE',
            timestamp: Date.now()
        }), { qos: 1, retain: true });
    });

    // --- MESSAGE ---
    mqttClient.on('message', async (topic, message) => {
        try {
            const payload = message.toString();
            const qos = message.qos || 0;
            console.log(`[MQTT] 📨 RX [${topic}] QoS:${qos}: ${payload}`);

            if (topic === TOPIC_ALERT) {
                await handleAlert(JSON.parse(payload));
            } else if (topic === TOPIC_HEART) {
                await handleHeartbeat(JSON.parse(payload));
            }
        } catch (err) {
            console.error('❌ Erreur traitement message:', err.message);
        }
    });

    // --- ERROR / CLOSE / RECONNECT ---
    mqttClient.on('error', (err) => {
        console.error('❌ MQTT Error:', err.message);
    });
    mqttClient.on('close', () => {
        isConnected = false;
        console.log('⚠️ MQTT Déconnecté');
    });
    mqttClient.on('reconnect', () => {
        console.log('🔄 MQTT Reconnexion...');
    });
}

// ============================================================================
// GESTION DES ALERTES
// ============================================================================
async function handleAlert(data) {
    try {
        const machineId = data.machine_id;
        const zone = data.zone || 'KA';
        const rawStatus = (data.status || '').toUpperCase().trim();
        const type = data.type || rawStatus;
        const operator = data.operator || 'Unknown';
        const timestamp = data.timestamp || Date.now();

        console.log(`[ALERT] ${machineId} | Status: ${rawStatus} | Type: ${type} | Op: ${operator}`);

        const mapped = STATUS_MAP[rawStatus];
        if (!mapped) {
            console.warn('⚠️ Statut inconnu:', rawStatus);
            return;
        }

        // --- CAS 1: RÉSOLUTION (Bouton Vert) ---
        if (rawStatus === 'RESOLVED' || rawStatus === 'OPERATIONAL') {
            await resolveAlert(machineId, operator, timestamp);

            // Mettre à jour l'état machine en DB
            await upsertMachineState(machineId, zone, 'operational', 'Resolved');

            // ÉMETTRE LE STATUT OPERATIONAL AU DASHBOARD
            emitToDashboard(machineId, zone, 'operational', 'Resolved', 'green', operator, timestamp);
        }
        // --- CAS 2: NOUVELLE ALERTE ---
        else {
            const log = await insertDowntimeLog(machineId, zone, mapped.db, type, operator);
            await upsertMachineState(machineId, zone, mapped.db, type);
            emitToDashboard(machineId, zone, mapped.db, type, mapped.color, operator, timestamp, log.id);
        }

    } catch (err) {
        console.error('❌ Erreur handleAlert:', err.message);
    }
}

// ============================================================================
// INSERTION EN BASE (Nouvelle alerte)
// ============================================================================
async function insertDowntimeLog(machine, zone, status, type, operator) {
    const now = new Date();
    const query = `
        INSERT INTO downtime_logs 
        (machine, status, type, operator, date_panne, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $5, $5)
        RETURNING *;
    `;
    const result = await poolRef.query(query, [machine, status, type, operator, now]);
    console.log(`[MQTT→DB] ✅ Inséré - ID: ${result.rows[0].id} | ${machine} | ${status} | ${type}`);
    return result.rows[0];
}

// ============================================================================
// RÉSOLUTION D'ALERTE (Bouton Vert) - SQL CORRIGÉ
// ============================================================================
async function resolveAlert(machine, resolvedBy, timestamp) {
    try {
        const now = new Date();

        // ⚠️ CORRECTION CRITIQUE : PostgreSQL n'accepte pas ORDER BY dans UPDATE
        // On utilise une sous-requête SELECT pour trouver l'ID du dernier log
        const query = `
            UPDATE downtime_logs 
            SET 
                status = 'Resolved', 
                resolved_by = $1,
                date_reparation = $2,
                duration = GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_panne)) / 60)::INTEGER,
                updated_at = $2
            WHERE id = (
                SELECT id FROM downtime_logs 
                WHERE machine = $3 AND status != 'Resolved'
                ORDER BY created_at DESC 
                LIMIT 1
            )
            RETURNING *;
        `;

        const result = await poolRef.query(query, [resolvedBy, now, machine]);

        if (result.rows.length > 0) {
            const row = result.rows[0];
            console.log(`[MQTT→DB] ✅ Résolu - ID: ${row.id} | ${machine} | Durée: ${row.duration}min`);

            // Émettre aussi un événement spécifique de résolution
            if (ioRef) {
                ioRef.emit('alert_resolved', {
                    code: machine,
                    status: 'operational',
                    type: 'Resolved',
                    color: 'green',
                    operator: resolvedBy,
                    timestamp: timestamp,
                    resolved_at: now.toISOString(),
                    duration: row.duration,
                    log_id: row.id
                });
            }
        } else {
            console.log(`[MQTT→DB] ⚠️ Aucun log actif à résoudre pour ${machine}`);
            // Même si pas de log, on force le reset dashboard
            if (ioRef) {
                ioRef.emit('alert_resolved', {
                    code: machine,
                    status: 'operational',
                    type: 'Resolved',
                    color: 'green',
                    operator: resolvedBy,
                    timestamp: timestamp
                });
            }
        }

    } catch (err) {
        console.error('❌ Erreur résolution:', err.message);
        // En cas d'erreur DB, on émet quand même pour ne pas bloquer le dashboard
        if (ioRef) {
            ioRef.emit('alert_resolved', {
                code: machine,
                status: 'operational',
                type: 'Resolved',
                color: 'green',
                operator: resolvedBy,
                timestamp: timestamp
            });
        }
    }
}

// ============================================================================
// MISE À JOUR ÉTAT MACHINE (Table machines - état courant)
// ============================================================================
async function upsertMachineState(machineId, zone, status, type) {
    try {
        // Vérifie si la table machines existe, sinon on ignore silencieusement
        const query = `
            INSERT INTO machines (machine_id, zone, current_status, current_type, last_updated)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (machine_id) 
            DO UPDATE SET 
                zone = EXCLUDED.zone,
                current_status = EXCLUDED.current_status,
                current_type = EXCLUDED.current_type,
                last_updated = NOW();
        `;
        await poolRef.query(query, [machineId, zone, status, type]);
    } catch (err) {
        // Si la table n'existe pas, ce n'est pas bloquant
        if (err.message.includes('relation "machines" does not exist')) {
            // Création silencieuse si besoin, ou on ignore
            console.log('[DB] Table machines non trouvée (optionnelle)');
        } else {
            console.error('❌ Erreur updateMachineState:', err.message);
        }
    }
}

// ============================================================================
// ÉMISSION SOCKET.IO VERS LE DASHBOARD
// ============================================================================
function emitToDashboard(machineId, zone, status, type, color, operator, timestamp, logId = null) {
    if (!ioRef) return;

    const payload = {
        code: machineId,
        zone: zone,
        status: status,        // 'downtime' | 'maintenance' | 'break' | 'material' | 'operational'
        type: type,            // 'Panne' | 'Maintenance' | 'Break / Pause' | 'Material' | 'Resolved'
        color: color,        // 'red' | 'blue' | 'yellow' | 'orange' | 'green'
        operator: operator,
        timestamp: timestamp,
        updated_at: new Date().toISOString(),
        log_id: logId
    };

    console.log('[MQTT→Socket] 📡 Emit machine_status_updated:', payload);
    ioRef.emit('machine_status_updated', payload);

    // Événement legacy pour compatibilité
    ioRef.emit('status_update', payload);

    // ✅ CORRECTION CRITIQUE : Émettre aussi 'updateMachines' pour que le Dashboard issam.html reçoive l'événement
    // Le Dashboard issam.html n'écoute que 'updateMachines', pas 'machine_status_updated'
    ioRef.emit('updateMachines', [payload]);
    console.log('[MQTT→Socket] 📡 Emit updateMachines:', [payload]);
}

// ============================================================================
// HEARTBEAT (Optionnel)
// ============================================================================
async function handleHeartbeat(data) {
    // Traitement du heartbeat si nécessaire
    // console.log('[HEARTBEAT]', data.machine_id, data.status);
}

// ============================================================================
// EXPORTS
// ============================================================================
module.exports = { init };