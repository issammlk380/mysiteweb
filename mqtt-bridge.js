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

// ✅ FIX GREEN BUTTON: Track last known state per machine to avoid reverting manual interventions
let lastKnownMachineState = {};

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
// GESTION DES ALERTES - LIFECYCLE 3 PHASES
// ============================================================================
async function handleAlert(data) {
    try {
        const machineId = data.machine_id;
        const zone = data.zone || 'KA';
        const rawStatus = (data.status || '').toUpperCase().trim();
        const type = data.type || rawStatus;
        const operator = data.operator || 'Unknown';
        const timestamp = data.timestamp || Date.now();
        const lifecyclePhase = data.lifecycle_phase || 'detected'; // ← NOUVEAU

        console.log(`[ALERT] ${machineId} | Status: ${rawStatus} | Type: ${type} | Lifecycle: ${lifecyclePhase}`);

        const mapped = STATUS_MAP[rawStatus];
        if (!mapped) {
            console.warn('⚠️ Statut inconnu:', rawStatus);
            return;
        }

        // ═══════════════════════════════════════════════════════════════════
        // LIFECYCLE 3 PHASES
        // ═══════════════════════════════════════════════════════════════════
        
        // ─── PHASE 1: DETECTED (Opérateur signale panne) ───
        if (lifecyclePhase === 'detected') {
            console.log(`📍 PHASE 1: DETECTED - Opérateur signale ${type}`);
            const log = await insertDowntimeLog(machineId, zone, mapped.db, type, operator, lifecyclePhase);
            await upsertMachineState(machineId, zone, mapped.db, type);
            emitToDashboard(machineId, zone, mapped.db, type, mapped.color, operator, timestamp, log.id, lifecyclePhase);
        }
        
        // ─── PHASE 2: ACKNOWLEDGED (Technicien arrive) ───
        else if (lifecyclePhase === 'acknowledged') {
            console.log(`📍 PHASE 2: ACKNOWLEDGED - Technicien arrive sur ${machineId}`);
            await acknowledgeTechnician(machineId, operator, timestamp);
            // État reste 'maintenance' mais lifecycle passe à 'acknowledged'
            await upsertMachineState(machineId, zone, 'maintenance', 'En cours');
            emitToDashboard(machineId, zone, 'maintenance', 'En cours', 'blue', operator, timestamp, null, 'acknowledged');
        }
        
        // ─── PHASE 3: RESOLVED (Réparation terminée) ───
        else if (lifecyclePhase === 'resolved' || rawStatus === 'RESOLVED' || rawStatus === 'OPERATIONAL') {
            console.log(`📍 PHASE 3: RESOLVED - Réparation terminée sur ${machineId}`);
            await resolveAlert(machineId, operator, timestamp);
            await upsertMachineState(machineId, zone, 'operational', 'Resolved');
            emitToDashboard(machineId, zone, 'operational', 'Resolved', 'green', operator, timestamp, null, 'resolved');
        }

    } catch (err) {
        console.error('❌ Erreur handleAlert:', err.message);
    }
}

// ============================================================================
// INSERTION EN BASE (Nouvelle alerte) - PHASE 1: DETECTED
// ============================================================================
async function insertDowntimeLog(machine, zone, status, type, operator, lifecyclePhase = 'detected') {
    const now = new Date();
    const query = `
        INSERT INTO downtime_logs 
        (machine, status, alert_type, operator, date_panne, lifecycle_phase, atelier, created_at, updated_at)
        VALUES ($1, 'En attente', $2, $3, $4, $5, $6, $4, $4)
        RETURNING *;
    `;
    const atelier = deriveAtelier(machine);
    const result = await poolRef.query(query, [machine, type, operator, now, lifecyclePhase, atelier]);
    console.log(`[PHASE 1] ✅ Panne détectée - ID: ${result.rows[0].id} | ${machine} | ${type}`);
    console.log(`   → date_panne: ${now.toISOString()}`);
    console.log(`   → lifecycle_phase: ${lifecyclePhase}`);

    // Update criticite if available
    try {
        await poolRef.query(`UPDATE downtime_logs SET criticite = $1 WHERE id = $2`, ['Moyenne', result.rows[0].id]);
    } catch (e) { /* ignore */ }
    return result.rows[0];
}

// ============================================================================
// ACKNOWLEDGMENT TECHNICIEN - PHASE 2: ACKNOWLEDGED
// ============================================================================
async function acknowledgeTechnician(machine, technicianName, timestamp) {
    try {
        const now = new Date();
        const heureArrivee = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const query = `
            UPDATE downtime_logs 
            SET 
                technician = $1,
                date_arrivee_technicien = $2,
                heure_arrivee = $3,
                lifecycle_phase = 'acknowledged',
                status = 'En cours',
                -- ✅ Calcul MTTA (Mean Time To Acknowledge)
                temps_reaction_minutes = GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_panne)) / 60)::INTEGER,
                updated_at = $2
            WHERE id = (
                SELECT id FROM downtime_logs 
                WHERE machine = $4
                  AND status = 'En attente'
                  AND lifecycle_phase = 'detected'
                ORDER BY date_panne DESC
                LIMIT 1
            )
            RETURNING *;
        `;

        const result = await poolRef.query(query, [technicianName, now, heureArrivee, machine]);

        if (result.rows.length > 0) {
            const row = result.rows[0];
            console.log(`[PHASE 2] ✅ Technicien arrivé - ID: ${row.id} | ${machine}`);
            console.log(`   → date_arrivee: ${now.toISOString()}`);
            console.log(`   → temps_reaction (MTTA): ${row.temps_reaction_minutes} minutes`);
            console.log(`   → lifecycle_phase: acknowledged`);
            
            // Emit real-time event
            if (ioRef) {
                ioRef.emit('technician_acknowledged', {
                    code: machine,
                    logId: row.id,
                    technician: technicianName,
                    temps_reaction: row.temps_reaction_minutes,
                    timestamp: now.toISOString()
                });
            }
        } else {
            console.log(`[PHASE 2] ⚠️ Aucune panne 'En attente' trouvée pour ${machine}`);
        }

    } catch (err) {
        console.error('❌ Erreur acknowledgeTechnician:', err.message);
    }
}

function deriveAtelier(machine) {
    if (!machine) return 'Atelier General';
    const prefix = String(machine).substring(0, 2).toUpperCase();
    const map = { 'KA': 'Atelier A', 'KB': 'Atelier B', 'KC': 'Atelier C', 'KD': 'Atelier D', 'KX': 'Atelier X' };
    return map[prefix] || 'Atelier General';
}

// ============================================================================
// RÉSOLUTION D'ALERTE - PHASE 3: RESOLVED
// ============================================================================
async function resolveAlert(machine, resolvedBy, timestamp) {
    try {
        const now = new Date();
        const heureReparation = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const query = `
            UPDATE downtime_logs 
            SET 
                status = 'Termine', 
                resolved_by = $1,
                date_reparation = $2,
                heure_reparation = $3,
                lifecycle_phase = 'resolved',
                -- ✅ Calcul MTTR (Mean Time To Repair) - Temps total
                temps_total_arret_minutes = GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_panne)) / 60)::INTEGER,
                duration = GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_panne)) / 60)::INTEGER,
                -- ✅ Calcul temps réparation (arrivée → fin)
                temps_reparation_minutes = CASE 
                    WHEN date_arrivee_technicien IS NOT NULL 
                    THEN GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_arrivee_technicien)) / 60)::INTEGER
                    ELSE NULL
                END,
                updated_at = $2
            WHERE id = (
                SELECT id FROM downtime_logs 
                WHERE machine = $4 
                  AND status NOT IN ('Resolved', 'Termine', 'Completed', 'resolved', 'termine', 'completed')
                  AND status IS NOT NULL
                ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC 
                LIMIT 1
            )
            RETURNING *;
        `;

        const result = await poolRef.query(query, [resolvedBy, now, heureReparation, machine]);

        if (result.rows.length > 0) {
            const row = result.rows[0];
            console.log(`[PHASE 3] ✅ Panne résolue - ID: ${row.id} | ${machine}`);
            console.log(`   → date_reparation: ${now.toISOString()}`);
            console.log(`   → temps_total_arret (MTTR): ${row.temps_total_arret_minutes} minutes`);
            console.log(`   → temps_reparation: ${row.temps_reparation_minutes} minutes`);
            console.log(`   → lifecycle_phase: resolved`);

            // Émettre événement de résolution
            if (ioRef) {
                ioRef.emit('alert_resolved', {
                    code: machine,
                    status: 'operational',
                    type: 'Resolved',
                    color: 'green',
                    operator: resolvedBy,
                    timestamp: timestamp,
                    resolved_at: now.toISOString(),
                    mttr: row.temps_total_arret_minutes,
                    repair_time: row.temps_reparation_minutes,
                    log_id: row.id
                });
            }
        } else {
            console.log(`[PHASE 3] ⚠️ Aucun log actif à résoudre pour ${machine}`);
            // Force reset dashboard
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
        console.error('   Stack:', err.stack);
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
        // ✅ FIX: Use actual column names from Railway schema (code, status, type_erreur)
        // First check if machine exists
        const checkQuery = `SELECT code FROM machines WHERE code = $1`;
        const existing = await poolRef.query(checkQuery, [machineId]);
        
        if (existing.rows.length > 0) {
            // Update existing machine
            const updateQuery = `
                UPDATE machines 
                SET status = $1, type_erreur = $2
                WHERE code = $3
            `;
            await poolRef.query(updateQuery, [status, type, machineId]);
        } else {
            // Insert new machine (use default columns: code, status, type_erreur)
            const insertQuery = `
                INSERT INTO machines (code, status, type_erreur)
                VALUES ($1, $2, $3)
            `;
            await poolRef.query(insertQuery, [machineId, status, type]);
        }
        console.log(`[DB] Machine ${machineId} state updated: ${status} (${type})`);
    } catch (err) {
        // Si la table n'existe pas, ce n'est pas bloquant
        if (err.message.includes('relation "machines" does not exist')) {
            console.log('[DB] Table machines non trouvée (optionnelle)');
        } else {
            console.error('❌ Erreur updateMachineState:', err.message);
        }
    }
}

// ============================================================================
// ÉMISSION SOCKET.IO VERS LE DASHBOARD - LIFECYCLE AWARE
// ============================================================================
function emitToDashboard(machineId, zone, status, type, color, operator, timestamp, logId = null, lifecyclePhase = 'detected') {
    if (!ioRef) return;

    const payload = {
        code: machineId,
        zone: zone,
        status: status,
        type: type,
        color: color,
        operator: operator,
        lifecycle_phase: lifecyclePhase,  // ← NOUVEAU
        timestamp: timestamp,
        updated_at: new Date().toISOString(),
        log_id: logId,
        criticite: 'Moyenne'
    };

    // ✅ FIX GREEN BUTTON: Skip duplicate states
    const lastState = lastKnownMachineState[machineId];
    
    if (lastState && lastState.status === status && lastState.type === type && lastState.lifecycle_phase === lifecyclePhase) {
        console.log(`[MQTT→Socket] ⏭️  Skip duplicate - ${machineId} already at ${status} (${lifecyclePhase})`);
        return;
    }

    // Update tracking
    lastKnownMachineState[machineId] = { status, type, lifecycle_phase: lifecyclePhase, timestamp: Date.now() };

    console.log(`[MQTT→Socket] 📡 Emit - ${machineId} | ${status} | Phase: ${lifecyclePhase}`);
    ioRef.emit('machine_status_updated', payload);
    ioRef.emit('status_update', payload);
    ioRef.emit('updateMachines', [payload]);
    
    // Événements lifecycle spécifiques
    if (lifecyclePhase === 'detected') {
        ioRef.emit('breakdown_detected', payload);
    } else if (lifecyclePhase === 'acknowledged') {
        ioRef.emit('technician_acknowledged', payload);
    } else if (lifecyclePhase === 'resolved') {
        ioRef.emit('breakdown_resolved', payload);
    }
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
module.exports = { 
    init,
    // ✅ FIX GREEN BUTTON: Export function to update state tracker when manual interventions occur
    updateMachineStateTracker: function(machineId, status, type) {
        if (machineId && status) {
            lastKnownMachineState[machineId] = { status, type, timestamp: Date.now() };
            console.log(`[STATE TRACKER] ✅ Updated ${machineId} -> ${status} (${type})`);
        }
    }
};