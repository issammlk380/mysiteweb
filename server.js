/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║     SMI ENTERPRISE — BACKEND API SERVER v2.8 (RAILWAY)        ║
 * ║     FIX ROUTING: / -> issam.html, /technicien -> technicien    ║
 * ║     + MQTT Bridge Wokwi Integration                            ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════════
   1. IMPORTS
═══════════════════════════════════════════════════════════════════ */
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const { Pool }   = require('pg');
const cors       = require('cors');
const mqttBridge = require('./mqtt-bridge');
const path       = require('path');

const app = express();

/* ═══════════════════════════════════════════════════════════════════
   2. CONFIGURATION
═══════════════════════════════════════════════════════════════════ */
const CONFIG = {
  server: {
    port:     process.env.PORT     || 3000,
    env:      process.env.NODE_ENV || 'development',
  },
  auth: {
    adminUsername: process.env.ADMIN_USER || 'admin',
    adminPassword: process.env.ADMIN_PASS || 'admin123',
  },
  pagination: {
    defaultLimit: 50,
    maxLimit:     500,
  }
};

/* ═══════════════════════════════════════════════════════════════════
   3. CORS
═══════════════════════════════════════════════════════════════════ */
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Origin', 'X-Requested-With', 'Content-Type', 'Accept',
        'Authorization', 'ngrok-skip-browser-warning'
    ],
    credentials: false
}));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, ngrok-skip-browser-warning');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

const server = http.createServer(app);

/* ═══════════════════════════════════════════════════════════════════
   ✅ NO-CACHE HEADERS
═══════════════════════════════════════════════════════════════════ */
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

/* ═══════════════════════════════════════════════════════════════════
   ✅ MANIFEST
═══════════════════════════════════════════════════════════════════ */
app.get('/site.webmanifest', (req, res) => {
    res.set('Content-Type', 'application/manifest+json');
    res.set('Cache-Control', 'no-cache');
    res.json({
        name: "SEWS Technician Solutions",
        short_name: "Tech SEWS",
        description: "Application Technicien - Systeme Andon SEWS",
        start_url: "/technicien.html",
        scope: "/technicien.html",
        display: "standalone",
        background_color: "#0f172a",
        theme_color: "#0ea5e9",
        orientation: "portrait",
        icons: [
            { src: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "/icon-512x512.png", sizes: "512x512", type: "image/png" }
        ]
    });
});

/* ═══════════════════════════════════════════════════════════════════
   4. POSTGRESQL
═══════════════════════════════════════════════════════════════════ */
const isRailway = !!process.env.DATABASE_URL;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:1234@localhost:5432/sews_iot_new';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isRailway ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

console.log(`Mode: ${isRailway ? 'Railway (SSL ON)' : 'Localhost (SSL OFF)'}`);

let dbHealthy = false;
let dbError = null;

/* ═══════════════════════════════════════════════════════════════════
   5. SCHEMA MIGRATION
═══════════════════════════════════════════════════════════════════ */
async function runMigrations() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(`
            CREATE TABLE IF NOT EXISTS downtime_logs (
                id SERIAL PRIMARY KEY,
                log_id VARCHAR(50),
                machine VARCHAR(20) NOT NULL DEFAULT 'KA01',
                start_time VARCHAR(20),
                duration INTEGER DEFAULT 0,
                technician VARCHAR(100) DEFAULT 'Non assigne',
                status VARCHAR(50) DEFAULT 'En attente',
                alert_type VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('[DB] Base table downtime_logs ready');

        const newColumns = [
            { name: 'date_panne', type: 'TIMESTAMP', default: 'NULL' },
            { name: 'date_reparation', type: 'TIMESTAMP', default: 'NULL' },
        ];

        for (const col of newColumns) {
            try {
                await client.query(`
                    ALTER TABLE downtime_logs 
                    ADD COLUMN IF NOT EXISTS ${col.name} ${col.type} DEFAULT ${col.default}
                `);
                console.log(`[DB] Column '${col.name}' ready`);
            } catch (e) {
                console.warn(`[DB] Column '${col.name}': ${e.message}`);
            }
        }

        const columnsToAdd = [
            { name: 'criticite', type: 'VARCHAR(50)', default: "'Moyenne'" },
            { name: 'alert_type', type: 'VARCHAR(100)', default: 'NULL' },
            { name: 'heure_arret_technicien', type: 'VARCHAR(20)', default: 'NULL' },
            { name: 'piece_observation', type: 'TEXT', default: 'NULL' },
            { name: 'atelier', type: 'VARCHAR(50)', default: 'NULL' },
            { name: 'updated_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
            { name: 'resolved_by', type: 'VARCHAR(100)', default: 'NULL' },
        ];

        for (const col of columnsToAdd) {
            try {
                await client.query(`
                    ALTER TABLE downtime_logs 
                    ADD COLUMN IF NOT EXISTS ${col.name} ${col.type} DEFAULT ${col.default}
                `);
                console.log(`[DB] Column '${col.name}' ready`);
            } catch (e) {
                console.warn(`[DB] Column '${col.name}': ${e.message}`);
            }
        }

        await client.query(`
            CREATE TABLE IF NOT EXISTS machines (
                code VARCHAR(10) PRIMARY KEY,
                status VARCHAR(50) DEFAULT 'operational',
                type_erreur VARCHAR(100)
            )
        `);
        console.log('[DB] Table machines ready');

        await client.query(`
            UPDATE downtime_logs 
            SET date_panne = created_at 
            WHERE date_panne IS NULL AND created_at IS NOT NULL
        `);

        await client.query(`
            UPDATE downtime_logs 
            SET status = 'En attente' 
            WHERE status IN ('Pending', 'pending', 'en panne', 'En Panne')
        `);
        await client.query(`
            UPDATE downtime_logs 
            SET status = 'En cours' 
            WHERE status IN ('In Progress', 'in progress', 'Escalated', 'escalated', 'En reparation')
        `);
        await client.query(`
            UPDATE downtime_logs 
            SET status = 'Termine' 
            WHERE status IN ('Completed', 'completed', 'Resolved', 'resolved', 'termine')
        `);

        await client.query(`
            UPDATE downtime_logs 
            SET date_reparation = created_at + (CAST(duration AS VARCHAR) || ' minutes')::INTERVAL
            WHERE date_reparation IS NULL 
              AND status = 'Termine' 
              AND CAST(duration AS VARCHAR) != '0' 
              AND CAST(duration AS VARCHAR) != ''
        `);

        const countResult = await client.query('SELECT COUNT(*) FROM downtime_logs');
        const count = parseInt(countResult.rows[0].count, 10);

        if (count === 0) {
            console.log('[DB] Seeding demo data...');
            await client.query(`
                INSERT INTO downtime_logs 
                (machine, start_time, duration, technician, status, criticite, alert_type, heure_arret_technicien, piece_observation, atelier, date_panne, date_reparation)
                VALUES 
                ('KA01', '08:30:00', 45, 'Ahmed Benali', 'Termine', 'Faible', 'Electrique', '08:45:00', 'Remplacement capteur proximite', 'Atelier A', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '75 minutes'),
                ('KB03', '09:15:00', 0, 'Non assigne', 'En attente', 'Majeure', 'Mecanique', NULL, 'Surchauffe moteur principal', 'Atelier B', NOW() - INTERVAL '30 minutes', NULL),
                ('KC07', '14:20:00', 120, 'Karim Fassi', 'Termine', 'Critique', 'Electrique', '14:35:00', 'Changement carte d axe', 'Atelier C', NOW() - INTERVAL '5 hours', NOW() - INTERVAL '3 hours'),
                ('KD02', '10:00:00', 30, 'Youssef Amrani', 'Termine', 'Moderee', 'Hydraulique', '10:10:00', 'Lubrification glissieres', 'Atelier D', NOW() - INTERVAL '4 hours', NOW() - INTERVAL '3.5 hours'),
                ('KX01', '11:45:00', 0, 'Non assigne', 'En attente', 'Majeure', 'Hydraulique', NULL, 'Fuite hydraulique detectee', 'Atelier X', NOW() - INTERVAL '1 hour', NULL)
            `);
            console.log('[DB] 5 demo records inserted');
        } else {
            console.log(`[DB] Table already has ${count} records, skipping seed`);
        }

        await client.query('COMMIT');
        dbHealthy = true;
        dbError = null;
        console.log('[DB] All migrations completed successfully');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[DB] Migration failed:', err.message);
        dbHealthy = false;
        dbError = err.message;
        throw err;
    } finally {
        client.release();
    }
}

/* ═══════════════════════════════════════════════════════════════════
   6. SOCKET.IO
═══════════════════════════════════════════════════════════════════ */
const io = new Server(server, {
    transports: ['websocket', 'polling'],
    cors: { origin: '*', methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "Accept"], credentials: false },
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

/* ═══════════════════════════════════════════════════════════════════
   ✅ FIX ROUTING - Ordre corrigé : Routes explicites AVANT static

   RÈGLE D'OR Express:
   1. Routes explicites (app.get) en PREMIER
   2. express.static en DEUXIÈME
   3. Fallback 404 en DERNIER
═══════════════════════════════════════════════════════════════════ */

// ✅ 1. ROUTES EXPLICITES (prioritaires)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'issam.html'));
});

app.get('/technicien', (req, res) => {
    res.sendFile(path.join(__dirname, 'technicien.html'));
});

app.get('/technicien.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'technicien.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ✅ 2. EXPRESS.STATIC (après les routes)
//    { index: false } = ne sert PAS index.html automatiquement
app.use(express.static(__dirname, { 
    index: false,
    dotfiles: 'ignore'
}));

// ✅ 3. LOGGER (après static)
app.use((req, _res, next) => {
  const timestamp = new Date().toLocaleString('fr-FR');
  console.log(`[${timestamp}] ${req.method.padEnd(7)} ${req.path}`);
  next();
});

/* ═══════════════════════════════════════════════════════════════════
   7. UTILITAIRES
═══════════════════════════════════════════════════════════════════ */
function sendError(res, status, msg, detail = null) {
  const body = { success: false, message: msg };
  if (CONFIG.server.env !== 'production' && detail) body.detail = detail;
  return res.status(status).json(body);
}

function sendSuccess(res, data, msg = 'Operation reussie', status = 200) {
  return res.status(status).json({ success: true, message: msg, timestamp: new Date().toISOString(), data });
}

function isPresent(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function sanitizeStr(value, fallback = '') {
  if (!isPresent(value)) return fallback;
  return String(value).trim().slice(0, 500);
}

function sanitizeInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  return isNaN(n) || n < 0 ? fallback : n;
}

function deriveAtelier(machine) {
    if (!machine) return 'Atelier General';
    const prefix = String(machine).substring(0, 2).toUpperCase();
    const map = { 'KA': 'Atelier A', 'KB': 'Atelier B', 'KC': 'Atelier C', 'KD': 'Atelier D', 'KX': 'Atelier X' };
    return map[prefix] || 'Atelier General';
}

async function safeQuery(query, params = []) {
    if (!dbHealthy) throw new Error('Database not initialized: ' + (dbError || 'Unknown error'));
    return pool.query(query, params);
}

/* ═══════════════════════════════════════════════════════════════════
   8. VALIDATION
═══════════════════════════════════════════════════════════════════ */
function validateLogPayload(req, res, next) {
  const body = req.body;
  const requiredFields = { machine: body.machine || body.machineID };
  const missing = Object.entries(requiredFields).filter(([, v]) => !isPresent(v)).map(([k]) => k);
  if (missing.length > 0) return sendError(res, 400, `Champs obligatoires manquants : ${missing.join(', ')}`);
  next();
}

/* ═══════════════════════════════════════════════════════════════════
   9. ROUTES API
═══════════════════════════════════════════════════════════════════ */
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return sendSuccess(res, { server: 'En ligne', database: dbHealthy ? 'Connecte' : 'Degrade', version: '2.8.0', env: CONFIG.server.env, uptime: `${Math.floor(process.uptime())} secondes` }, 'Serveur operationnel');
  } catch (err) { return sendError(res, 503, 'Base de donnees inaccessible', err.message); }
});

app.get('/api/debug', async (_req, res) => {
    try {
        const tableCheck = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('downtime_logs', 'machines')`);
        let columns = [];
        try { const colResult = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'downtime_logs' ORDER BY ordinal_position`); columns = colResult.rows; } catch (e) { columns = [{ error: e.message }]; }
        let count = 0;
        try { const countResult = await pool.query('SELECT COUNT(*) FROM downtime_logs'); count = parseInt(countResult.rows[0].count, 10); } catch (e) { count = -1; }
        return res.json({ success: true, dbHealthy, dbError, tables: tableCheck.rows.map(r => r.table_name), downtime_logs_columns: columns, downtime_logs_count: count, database_url: process.env.DATABASE_URL ? 'Configured (hidden)' : 'Not set' });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!isPresent(username) || !isPresent(password)) return sendError(res, 400, 'Les champs "username" et "password" sont obligatoires.');
  const isValid = username.trim() === CONFIG.auth.adminUsername && password === CONFIG.auth.adminPassword;
  if (!isValid) { console.warn(`[AUTH] Tentative echouee - "${username}"`); return sendError(res, 401, 'Identifiants incorrects.'); }
  console.log(`[AUTH] Connexion reussie - "${username}"`); return sendSuccess(res, { username: username.trim(), role: 'admin' }, 'Connexion reussie');
});

app.post('/api/logs', validateLogPayload, async (req, res) => {
    const body = req.body;
    const machine = sanitizeStr(body.machine || body.machineID);
    const status = sanitizeStr(body.status, 'En attente');
    const alert_type = sanitizeStr(body.alertType || body.alert_type, null) || null;
    const start_time = sanitizeStr(body.startTime || body.start_time, new Date().toLocaleTimeString('fr-FR'));
    const duration = sanitizeInt(body.duration, 0);
    const technician = sanitizeStr(body.technician || body.technicianName, 'Non assigne');
    const criticite = sanitizeStr(body.criticite, 'Moyenne');
    const heure_arret_technicien = sanitizeStr(body.heureArretTechnicien || body.heure_arret_technicien, null) || null;
    const piece_observation = sanitizeStr(body.observation || body.piece_observation, null) || null;

    try {
        const result = await safeQuery(
            `INSERT INTO downtime_logs (machine, start_time, duration, technician, status, criticite, alert_type, heure_arret_technicien, piece_observation, atelier, date_panne) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *;`,
            [machine, start_time, duration, technician, status, criticite, alert_type, heure_arret_technicien, piece_observation, deriveAtelier(machine), new Date()]
        );
        const newLog = result.rows[0];
        console.log(`[LOGS] Nouveau log cree - Machine: ${newLog.machine} | Statut: "${newLog.status}"`);
        const io = req.app.get('io');
        if (io) io.emit('machineStatusChanged', { machine: newLog.machine, status: newLog.status, alert_type: newLog.alert_type, criticite: newLog.criticite, logId: newLog.id });
        return sendSuccess(res, newLog, 'Log cree avec succes.', 201);
    } catch (err) { console.error('[LOGS] Erreur insertion :', err.message); return sendError(res, 500, "Erreur interne lors de l'insertion.", err.message); }
});

app.get('/api/logs', async (req, res) => {
  const limit = Math.min(sanitizeInt(req.query.limit, CONFIG.pagination.defaultLimit), CONFIG.pagination.maxLimit);
  const offset = sanitizeInt(req.query.offset, 0);
  const status = sanitizeStr(req.query.status);
  const machine = sanitizeStr(req.query.machine);
  try {
    const conditions = []; const params = []; let idx = 1;
    if (status) { conditions.push(`LOWER(status) = LOWER($${idx++})`); params.push(status); }
    if (machine) { conditions.push(`LOWER(machine) LIKE LOWER($${idx++})`); params.push(`%${machine}%`); }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const dataQuery = `SELECT * FROM downtime_logs ${whereClause} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++};`;
    const countQuery = `SELECT COUNT(*) AS total FROM downtime_logs ${whereClause};`;
    params.push(limit, offset);
    const [dataResult, countResult] = await Promise.all([safeQuery(dataQuery, params), safeQuery(countQuery, params.slice(0, -2))]);
    return sendSuccess(res, { logs: dataResult.rows, pagination: { total: parseInt(countResult.rows[0].total, 10), limit, offset, returned: dataResult.rows.length } });
  } catch (err) { return sendError(res, 500, 'Erreur recuperation logs.', err.message); }
});

app.get('/api/logs/:id', async (req, res) => {
  const { id } = req.params;
  if (!isPresent(id)) return sendError(res, 400, 'ID requis.');
  try { const result = await safeQuery('SELECT * FROM downtime_logs WHERE id = $1 LIMIT 1', [sanitizeStr(id)]); if (!result.rows.length) return sendError(res, 404, `Log "${id}" introuvable.`); return sendSuccess(res, result.rows[0]); }
  catch (err) { return sendError(res, 500, 'Erreur recherche log.', err.message); }
});

app.put('/api/logs/:id', async (req, res) => {
  const { id } = req.params;
  const { status, technician, duration, criticite, resolved_by } = req.body;
  if (!isPresent(id)) return sendError(res, 400, 'ID requis.');
  if (!isPresent(status)) return sendError(res, 400, 'Champ "status" obligatoire.');
  try {
    const dateReparation = status === 'Termine' ? new Date() : null;
    const result = await safeQuery(
      `UPDATE downtime_logs SET status = $1, technician = COALESCE($2, technician), duration = COALESCE($3, duration), date_reparation = COALESCE($4, date_reparation), criticite = COALESCE($5, criticite), resolved_by = COALESCE($6, resolved_by), updated_at = NOW() WHERE id = $7 RETURNING *;`,
      [sanitizeStr(status), isPresent(technician) ? sanitizeStr(technician) : null, isPresent(duration) ? sanitizeInt(duration) : null, dateReparation, isPresent(criticite) ? sanitizeStr(criticite) : null, isPresent(resolved_by) ? sanitizeStr(resolved_by) : null, sanitizeStr(id)]
    );
    if (!result.rows.length) return sendError(res, 404, `Log "${id}" introuvable.`);
    const updatedLog = result.rows[0];
    console.log(`[LOGS] Mis a jour - ID: ${id} | Statut: "${status}"`);
    const io = req.app.get('io');
    if (io) io.emit('machineStatusChanged', { machine: updatedLog.machine, status: updatedLog.status, alert_type: updatedLog.alert_type, criticite: updatedLog.criticite, logId: updatedLog.id });
    return sendSuccess(res, updatedLog, 'Log mis a jour.');
  } catch (err) { return sendError(res, 500, 'Erreur mise a jour log.', err.message); }
});

app.get('/api/historique', async (req, res) => {
  const limit = Math.min(sanitizeInt(req.query.limit, CONFIG.pagination.defaultLimit), CONFIG.pagination.maxLimit);
  const offset = sanitizeInt(req.query.offset, 0);
  try { const result = await safeQuery('SELECT * FROM downtime_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]); return res.json(result.rows); }
  catch (err) { console.error('[HISTORIQUE] Erreur:', err.message); return res.status(500).json({ success: false, message: 'Erreur recuperation historique.', detail: CONFIG.server.env !== 'production' ? err.message : undefined, data: [] }); }
});

app.get('/api/stats', async (req, res) => {
  try {
    const [total, byStatus, mttrResult, topMachines, today, weekly, pendingCount, tempsResult] = await Promise.all([
      safeQuery('SELECT COUNT(*) AS count FROM downtime_logs'),
      safeQuery('SELECT status, COUNT(*) AS count FROM downtime_logs GROUP BY status ORDER BY count DESC'),
      safeQuery(`SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (date_reparation - date_panne)) / 60), 2), 0) AS mttr_minutes, COUNT(*) AS pannes_resolues FROM downtime_logs WHERE status = 'Termine' AND date_panne IS NOT NULL AND date_reparation IS NOT NULL`),
      safeQuery('SELECT machine, COUNT(*) AS pannes FROM downtime_logs GROUP BY machine ORDER BY pannes DESC LIMIT 5'),
      safeQuery('SELECT COUNT(*) AS count FROM downtime_logs WHERE DATE(created_at) = CURRENT_DATE'),
      safeQuery(`SELECT DATE(created_at) AS jour, COUNT(*) AS total FROM downtime_logs WHERE created_at >= NOW() - INTERVAL '7 days' GROUP BY DATE(created_at) ORDER BY jour ASC`),
      safeQuery(`SELECT COUNT(*) AS count FROM downtime_logs WHERE status IN ('En attente', 'En cours')`),
      safeQuery(`SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (heure_arret_technicien::timestamp - date_panne)) / 60), 2), 0) AS temps_reaction_minutes, COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (date_reparation - heure_arret_technicien::timestamp)) / 60), 2), 0) AS temps_reparation_minutes FROM downtime_logs WHERE status = 'Termine' AND date_panne IS NOT NULL AND heure_arret_technicien IS NOT NULL AND date_reparation IS NOT NULL`)
    ]);
    const totalInterventions = parseInt(total.rows[0].count, 10) || 0;
    const mttrMinutes = parseFloat(mttrResult.rows[0].mttr_minutes) || 0;
    const pannesResolues = parseInt(mttrResult.rows[0].pannes_resolues, 10) || 0;
    const pannesPending = parseInt(pendingCount.rows[0].count, 10) || 0;
    let mttrDisplay;
    if (pannesResolues === 0) mttrDisplay = 'N/A';
    else if (mttrMinutes >= 60) { const hours = Math.floor(mttrMinutes / 60); const mins = Math.round(mttrMinutes % 60); mttrDisplay = `${hours}h ${mins}m`; }
    else mttrDisplay = `${Math.round(mttrMinutes)}m`;
    const tempsReactionMinutes = parseFloat(tempsResult.rows[0].temps_reaction_minutes) || 0;
    const tempsReparationMinutes = parseFloat(tempsResult.rows[0].temps_reparation_minutes) || 0;
    const formatTemps = (mins) => { if (mins >= 60) { const h = Math.floor(mins / 60); const m = Math.round(mins % 60); return `${h}h ${m}m`; } return `${Math.round(mins)}m`; };
    return res.json({ downtime: totalInterventions, mttr: mttrDisplay, mttrMinutes, mttrAvailable: pannesResolues > 0, pannesResolues, pannesPending, tempsReaction: formatTemps(tempsReactionMinutes), tempsReparation: formatTemps(tempsReparationMinutes), tempsReactionMinutes, tempsReparationMinutes, mtbf: '120h', availability: '98.5%', total: totalInterventions, today: parseInt(today.rows[0].count, 10) || 0, avgDuration: mttrMinutes, byStatus: byStatus.rows, topMachines: topMachines.rows, weekly: weekly.rows });
  } catch (err) { console.error('[STATS] Erreur:', err.message); return res.status(500).json({ success: false, message: err.message, downtime: 0, mttr: 'Erreur', mtbf: '0h', availability: '0%', total: 0, today: 0, avgDuration: 0, byStatus: [], topMachines: [], weekly: [] }); }
});

app.get('/api/sessions', async (req, res) => {
  const limit = Math.min(sanitizeInt(req.query.limit, 200), CONFIG.pagination.maxLimit);
  try { const result = await safeQuery(`SELECT id AS log_id, machine AS name, alert_type AS type, status, duration, technician AS service, created_at AS date FROM downtime_logs ORDER BY created_at DESC LIMIT $1`, [limit]); return res.status(200).json(result.rows); }
  catch (err) { return sendError(res, 500, 'Erreur recuperation sessions.', err.message); }
});

app.post('/api/intervention', async (req, res) => {
  const idPanne = req.body.idPanne || req.body.id;
  const criticite = req.body.criticiteRaw || req.body.criticite;
  const heureIntervention = req.body.heureIntervention || req.body.heure;
  const { observation } = req.body;
  if (!idPanne || !criticite || !heureIntervention || !observation) return res.status(400).json({ success: false, message: 'Tous les champs sont obligatoires !' });
  try {
    const result = await safeQuery(`UPDATE downtime_logs SET criticite = $1, heure_arret_technicien = $2, piece_observation = $3, resolved_by = COALESCE($4, resolved_by) WHERE id = $5 RETURNING *`, [criticite, heureIntervention, observation, req.body.technician || null, idPanne]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Aucun enregistrement trouve !' });
    const updatedLog = result.rows[0];
    const io = req.app.get('io');
    if (io) {
        io.emit('machineStatusChanged', { machine: updatedLog.machine, status: updatedLog.status, alert_type: updatedLog.alert_type, criticite: criticite, logId: updatedLog.id });
        // ✅ EMIT updateMachines pour temps réel (5 états Wokwi)
        io.emit('updateMachines', [{
            code: updatedLog.machine,
            status: 'maintenance',
            type_erreur: updatedLog.alert_type || 'Intervention',
            criticite: criticite || 'Moderee',
            logId: updatedLog.id,
            source: 'intervention',
            timestamp: Date.now()
        }]);
        console.log(`Real-time event sent for machine ${updatedLog.machine}`);
    }
    return res.status(200).json({ success: true, message: "Intervention enregistree !" });
  } catch (err) { console.error('[INTERVENTION] Erreur:', err); return res.status(500).json({ success: false, message: 'Erreur interne serveur.', detail: err.message }); }
});

app.post('/api/machines/update-status', async (req, res) => {
  const { code, status, type_erreur } = req.body;
  if (!isPresent(code) || !isPresent(status)) return sendError(res, 400, 'Les champs "code" et "status" sont obligatoires.');
  try {
    await safeQuery('UPDATE machines SET status = $1, type_erreur = $2 WHERE code = $3', [status, status.toLowerCase() === 'operational' ? null : (type_erreur || null), code]);
    console.log(`[Machines] ${code} -> status: "${status}"`);
    const io = req.app.get('io');
    if (io) {
        io.emit('machineStatusChanged', { machine: code, status: status, alert_type: type_erreur || null });
        // ✅ EMIT updateMachines pour temps réel (5 états Wokwi)
        const wokwiStatus = (status === 'Operational' || status === 'Termine') ? 'operational' : status.toLowerCase();
        io.emit('updateMachines', [{
            code: code,
            status: wokwiStatus,
            type_erreur: type_erreur || null,
            source: 'api_update',
            timestamp: Date.now()
        }]);
    }
    return sendSuccess(res, null, 'Statut mis a jour dans PostgreSQL.');
  } catch (err) { return sendError(res, 500, 'Erreur mise a jour statut.', err.message); }
});

/* ═══════════════════════════════════════════════════════════════════
   10. ERROR HANDLERS
═══════════════════════════════════════════════════════════════════ */
app.use((req, res) => {
  console.warn(`[404] ${req.method} ${req.originalUrl}`);
  return sendError(res, 404, `Route "${req.method} ${req.originalUrl}" introuvable.`);
});

app.use((err, req, res, _next) => {
  console.error('[ERREUR GLOBALE] :', err.stack || err.message);
  return sendError(res, 500, 'Erreur interne inattendue.', err.message);
});

/* ═══════════════════════════════════════════════════════════════════
   11. START SERVER
═══════════════════════════════════════════════════════════════════ */
app.set('io', io);

io.on('connection', (socket) => {
  console.log(`[SOCKET] Client connecte - ID: ${socket.id}`);
  socket.on('disconnect', () => console.log(`[SOCKET] Client deconnecte - ID: ${socket.id}`));
});

async function startServer() {
    await runMigrations();

    // ✅ INITIALISER MQTT BRIDGE APRÈS DB READY
    try {
        mqttBridge.init(pool, io);
        app.set('mqttBridge', mqttBridge);
        console.log('✅ MQTT Bridge initialisé avec succès');
    } catch (err) {
        console.error('❌ Erreur initialisation MQTT Bridge:', err.message);
    }
    const tryPort = CONFIG.server.port;
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') { console.error(`[PORT] Le port ${tryPort} est deja utilise !`); process.exit(1); }
        else { console.error('[SERVER] Erreur:', err); process.exit(1); }
    });
    server.listen(tryPort, '0.0.0.0', () => {
      console.log('');
      console.log('========================================');
      console.log('  SMI Enterprise - API Server v2.8');
      console.log('  FIX ROUTING + MQTT Wokwi');
      console.log('========================================');
      console.log(`  Serveur demarre sur le port : ${tryPort}`);
      console.log(`  Environnement : ${CONFIG.server.env}`);
      console.log(`  DB : ${process.env.DATABASE_URL ? 'Railway PostgreSQL' : 'Local PostgreSQL'}`);
      console.log(`  DB Status : ${dbHealthy ? 'Healthy' : 'Unhealthy'}`);
      console.log('========================================');
      console.log('  ROUTING:');
      console.log('    GET  /                  -> issam.html (Dashboard)');
      console.log('    GET  /technicien        -> technicien.html');
      console.log('    GET  /technicien.html   -> technicien.html');
      console.log('    GET  /login             -> login.html');
      console.log('    GET  /dashboard         -> dashboard.html');
      console.log('  API:');
      console.log('    GET  /api/health');
      console.log('    GET  /api/logs');
      console.log('    POST /api/logs');
      console.log('    PUT  /api/logs/:id');
      console.log('    GET  /api/stats');
      console.log('    POST /api/intervention');
      console.log('========================================');
      console.log('');
    });
}

startServer().catch(err => {
    console.error('[FATAL] Impossible de demarrer le serveur:', err);
    process.exit(1);
});

/* ═══════════════════════════════════════════════════════════════════
   12. GRACEFUL SHUTDOWN
═══════════════════════════════════════════════════════════════════ */
async function gracefulShutdown(signal) {
  console.log(`[SERVEUR] Signal : ${signal}`);
  server.close(async () => {
    console.log('   -> Serveur HTTP arrete.');
    try { await pool.end(); console.log('   -> Pool PostgreSQL ferme.'); } catch (err) { console.error('   -> Erreur fermeture pool :', err.message); }
    console.log('[SERVEUR] Arret complet.');
    process.exit(0);
  });
  setTimeout(() => { console.error('[SERVEUR] Timeout - Arret force.'); process.exit(1); }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => console.error('[CRITIQUE] Exception non capturee :', err.stack));
process.on('unhandledRejection', (reason) => console.error('[CRITIQUE] Promesse rejetee non geree :', reason));