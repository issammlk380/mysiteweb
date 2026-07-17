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
const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const { Pool }     = require('pg');
const cors         = require('cors');
const mqttBridge   = require('./mqtt-bridge');
const dataGenerator = require('./data-generator');
const path         = require('path');

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
   ✅ CACHE-CONTROL HEADERS: Prevent CDN/Browser caching issues
   - HTML files: no-cache (always revalidate with server)
   - Static assets: short cache for performance
═══════════════════════════════════════════════════════════════════ */
app.use((req, res, next) => {
    // Force no-cache for HTML files to prevent Railway CDN caching stale versions
    if (req.path.endsWith('.html') || req.path === '/' || req.path === '/dashboard' || req.path === '/technicien' || req.path === '/login') {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('X-Content-Type-Options', 'nosniff');
        console.log(`[CACHE] No-cache headers set for: ${req.path}`);
    } 
    // Allow short caching for static assets (CSS, JS, images)
    else if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf)$/)) {
        res.set('Cache-Control', 'public, max-age=300'); // 5 minutes
    }
    // API endpoints: no cache
    else if (req.path.startsWith('/api/')) {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
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
                machine VARCHAR(20) NOT NULL DEFAULT 'KA01',
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
            // ✅ COMPLETE LIFECYCLE TRACKING COLUMNS
            { name: 'date_arrivee_technicien', type: 'TIMESTAMP', default: 'NULL' },
            { name: 'heure_panne', type: 'VARCHAR(20)', default: 'NULL' },
            { name: 'heure_arrivee', type: 'VARCHAR(20)', default: 'NULL' },
            { name: 'heure_reparation', type: 'VARCHAR(20)', default: 'NULL' },
            { name: 'temps_reaction_minutes', type: 'INTEGER', default: 'NULL' },
            { name: 'temps_reparation_minutes', type: 'INTEGER', default: 'NULL' },
            { name: 'temps_total_arret_minutes', type: 'INTEGER', default: 'NULL' },
            { name: 'lifecycle_phase', type: 'VARCHAR(50)', default: "'detected'" },
            { name: 'operator', type: 'VARCHAR(100)', default: 'NULL' },
            // ✅ ADDITIONAL LIFECYCLE FIELDS
            { name: 'rfid_uid', type: 'VARCHAR(100)', default: 'NULL' },
            { name: 'temps_intervention_minutes', type: 'INTEGER', default: 'NULL' },
            { name: 'breakdown_category', type: 'VARCHAR(100)', default: 'NULL' },
            { name: 'root_cause', type: 'TEXT', default: 'NULL' },
            { name: 'actions_taken', type: 'TEXT', default: 'NULL' },
            { name: 'spare_parts_used', type: 'TEXT', default: 'NULL' },
            { name: 'preventive_actions', type: 'TEXT', default: 'NULL' },
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
                type_erreur VARCHAR(100),
                location VARCHAR(100),
                model VARCHAR(100),
                installation_date DATE,
                last_maintenance DATE,
                maintenance_interval_days INTEGER DEFAULT 30
            )
        `);
        console.log('[DB] Table machines ready');

        // ✅ NEW: Technicians table for RFID and lifecycle tracking
        await client.query(`
            CREATE TABLE IF NOT EXISTS technicians (
                id SERIAL PRIMARY KEY,
                rfid_uid VARCHAR(100) UNIQUE NOT NULL,
                name VARCHAR(100) NOT NULL,
                specialization VARCHAR(100),
                contact_info VARCHAR(200),
                shift VARCHAR(50),
                active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('[DB] Table technicians ready');

        // ✅ NEW: KPI summary table for performance tracking
        await client.query(`
            CREATE TABLE IF NOT EXISTS kpi_summary (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                machine VARCHAR(20),
                atelier VARCHAR(50),
                total_breakdowns INTEGER DEFAULT 0,
                total_downtime_minutes INTEGER DEFAULT 0,
                avg_mtta_minutes DECIMAL(10,2) DEFAULT 0,
                avg_mttr_minutes DECIMAL(10,2) DEFAULT 0,
                avg_reaction_time_minutes DECIMAL(10,2) DEFAULT 0,
                avg_repair_time_minutes DECIMAL(10,2) DEFAULT 0,
                availability_percentage DECIMAL(5,2) DEFAULT 100,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(date, machine)
            )
        `);
        console.log('[DB] Table kpi_summary ready');

        // ✅ NEW: Breakdown categories for better classification
        await client.query(`
            CREATE TABLE IF NOT EXISTS breakdown_categories (
                id SERIAL PRIMARY KEY,
                category_name VARCHAR(100) UNIQUE NOT NULL,
                description TEXT,
                typical_duration_minutes INTEGER,
                priority_level INTEGER DEFAULT 3,
                required_skills VARCHAR(200),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('[DB] Table breakdown_categories ready');

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

        // ✅ FIXED: Use temps_total_arret_minutes instead of deleted 'duration' column
        await client.query(`
            UPDATE downtime_logs 
            SET date_reparation = created_at + (CAST(temps_total_arret_minutes AS VARCHAR) || ' minutes')::INTERVAL
            WHERE date_reparation IS NULL 
              AND status = 'Termine' 
              AND temps_total_arret_minutes IS NOT NULL
              AND temps_total_arret_minutes > 0
        `);

        const countResult = await client.query('SELECT COUNT(*) FROM downtime_logs');
        const count = parseInt(countResult.rows[0].count, 10);

        if (count === 0) {
            console.log('[DB] Seeding demo data...');
            // ✅ FIXED: Removed 'duration' and 'start_time' columns (deleted in cleanup)
            await client.query(`
                INSERT INTO downtime_logs 
                (machine, technician, status, criticite, alert_type, piece_observationatelier, atelier, date_panne, date_reparation, 
                 heure_panne, heure_arrivee, temps_reaction_minutes, temps_reparation_minutes, temps_total_arret_minutes,
                 breakdown_category, root_cause)
                VALUES 
                ('KA01', 'Ahmed Benali', 'Résolu', 'Faible', 'Electrique', 'Remplacement capteur proximite', 'Atelier A', 
                 NOW() - INTERVAL '2 hours', NOW() - INTERVAL '75 minutes', '08:30', '08:45', 15, 45, 60,
                 'Electrical', 'Faulty sensor'),
                ('KB03', 'Non assigne', 'En attente', 'Majeure', 'Mecanique', 'Surchauffe moteur principal', 'Atelier B', 
                 NOW() - INTERVAL '30 minutes', NULL, '09:15', NULL, 0, 0, 0,
                 'Mechanical', 'Motor overheating'),
                ('KC07', 'Karim Fassi', 'Résolu', 'Critique', 'Electrique', 'Changement carte d axe', 'Atelier C', 
                 NOW() - INTERVAL '5 hours', NOW() - INTERVAL '3 hours', '14:20', '14:35', 15, 120, 135,
                 'Electrical', 'Axis card failure'),
                ('KD02', 'Youssef Amrani', 'Résolu', 'Moderee', 'Hydraulique', 'Lubrification glissieres', 'Atelier D', 
                 NOW() - INTERVAL '4 hours', NOW() - INTERVAL '3.5 hours', '10:00', '10:10', 10, 30, 40,
                 'Hydraulic', 'Lubrication needed'),
                ('KX01', '11:45:00', 0, 'Non assigne', 'En attente', 'Majeure', 'Hydraulique', NULL, 'Fuite hydraulique detectee', 'Atelier X', NOW() - INTERVAL '1 hour', NULL)
            `);
            console.log('[DB] 5 demo records inserted');
        } else {
            console.log(`[DB] Table already has ${count} records, skipping seed`);
        }

        // ✅ SEED: Technicians with RFID UIDs
        const techCount = await client.query('SELECT COUNT(*) FROM technicians');
        if (parseInt(techCount.rows[0].count, 10) === 0) {
            await client.query(`
                INSERT INTO technicians (rfid_uid, name, specialization, contact_info, shift, active)
                VALUES 
                ('04A3B8FA', 'Ahmed Benali', 'Électrique', 'ahmed.benali@sews.ma', 'Matin', true),
                ('04C5D2FB', 'Karim Fassi', 'Mécanique', 'karim.fassi@sews.ma', 'Après-midi', true),
                ('04E7F6FC', 'Youssef Amrani', 'Hydraulique', 'youssef.amrani@sews.ma', 'Nuit', true),
                ('04B9A4FD', 'Omar Alami', 'Électronique', 'omar.alami@sews.ma', 'Matin', true),
                ('04D1C8FE', 'Hassan Idrissi', 'Polyvalent', 'hassan.idrissi@sews.ma', 'Après-midi', true)
            `);
            console.log('[DB] Technicians seeded');
        }

        // ✅ SEED: Breakdown categories
        const catCount = await client.query('SELECT COUNT(*) FROM breakdown_categories');
        if (parseInt(catCount.rows[0].count, 10) === 0) {
            await client.query(`
                INSERT INTO breakdown_categories (category_name, description, typical_duration_minutes, priority_level, required_skills)
                VALUES 
                ('Électrique', 'Problèmes électriques, capteurs, câblage', 45, 2, 'Électricien industriel'),
                ('Mécanique', 'Problèmes mécaniques, usure pièces', 90, 2, 'Mécanicien industriel'),
                ('Hydraulique', 'Fuites, pressions, vérins hydrauliques', 60, 3, 'Hydraulicien'),
                ('Pneumatique', 'Circuits air comprimé, vérins pneumatiques', 30, 3, 'Pneumaticien'),
                ('Électronique', 'Cartes électroniques, automates, variateurs', 120, 1, 'Électronicien'),
                ('Informatique', 'Logiciels, réseaux, communication', 30, 4, 'Informaticien industriel'),
                ('Lubrification', 'Graissage, huiles, maintenance préventive', 15, 4, 'Graisseur'),
                ('Sécurité', 'Arrêts d urgence, capteurs sécurité', 20, 1, 'Agent sécurité')
            `);
            console.log('[DB] Breakdown categories seeded');
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

// ═══════════════════════════════════════════════════════════════════
// GET /api/logs - Bulletproof logs retrieval with pagination
// ═══════════════════════════════════════════════════════════════════
app.get('/api/logs', async (req, res) => {
  // Sanitize and validate inputs
  const limit = Math.min(
    sanitizeInt(req.query.limit, CONFIG.pagination.defaultLimit), 
    CONFIG.pagination.maxLimit
  );
  const offset = sanitizeInt(req.query.offset, 0);
  const status = sanitizeStr(req.query.status);
  const machine = sanitizeStr(req.query.machine);
  
  try {
    // Build dynamic WHERE clause with proper parameter indexing
    const conditions = [];
    const params = [];
    let paramIndex = 1;
    
    if (status && status.trim() !== '') {
      conditions.push(`LOWER(COALESCE(status, '')) = LOWER($${paramIndex})`);
      params.push(status.trim());
      paramIndex++;
    }
    
    if (machine && machine.trim() !== '') {
      conditions.push(`LOWER(COALESCE(machine, '')) LIKE LOWER($${paramIndex})`);
      params.push(`%${machine.trim()}%`);
      paramIndex++;
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    // Separate params for data query (includes limit/offset) and count query
    const dataParams = [...params, limit, offset];
    const countParams = [...params]; // Count query doesn't need limit/offset
    
    // Data query with NULL-safe ordering
    const dataQuery = `
      SELECT 
        id,
        machine,
        status,
        alert_type,
        operator,
        technician,
        criticite,
        atelier,
        zone,
        breakdown_category,
        root_cause,
        actions_taken,
        preventive_actions,
        resolved_by,
        date_panne,
        heure_panne,
        date_arrivee_technicien,
        heure_arrivee,
        date_reparation,
        heure_reparation,
        temps_reaction_minutes,
        temps_reparation_minutes,
        temps_total_arret_minutes,
        temps_intervention_minutes,
        lifecycle_phase,
        piece_observation,
        spare_parts_used,
        rfid_uid,
        created_at,
        updated_at
      FROM downtime_logs 
      ${whereClause} 
      ORDER BY COALESCE(updated_at, created_at, NOW()) DESC 
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    // Count query
    const countQuery = `
      SELECT COUNT(*) AS total 
      FROM downtime_logs 
      ${whereClause}
    `;
    
    // Execute both queries in parallel
    const [dataResult, countResult] = await Promise.all([
      safeQuery(dataQuery, dataParams),
      safeQuery(countQuery, countParams)
    ]);
    
    // Handle NULL values in response
    const sanitizedLogs = (dataResult.rows || []).map(log => ({
      ...log,
      machine: log.machine || '—',
      status: log.status || 'Unknown',
      alert_type: log.alert_type || '—',
      operator: log.operator || '—',
      technician: log.technician || 'Unassigned',
      criticite: log.criticite || 'Moyenne',
      atelier: log.atelier || '—',
      breakdown_category: log.breakdown_category || '—',
      root_cause: log.root_cause || '—',
      temps_reaction_minutes: log.temps_reaction_minutes || 0,
      temps_reparation_minutes: log.temps_reparation_minutes || 0,
      temps_total_arret_minutes: log.temps_total_arret_minutes || 0,
    }));
    
    const total = parseInt(countResult.rows[0]?.total || 0, 10);
    
    return sendSuccess(res, {
      logs: sanitizedLogs,
      pagination: {
        total: total,
        limit: limit,
        offset: offset,
        returned: sanitizedLogs.length,
        hasNext: offset + sanitizedLogs.length < total,
        hasPrev: offset > 0
      }
    });
    
  } catch (err) {
    console.error('[API] /api/logs error:', err.message);
    console.error('[API] Stack:', err.stack);
    return sendError(res, 500, 'Erreur récupération logs', err.message);
  }
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
try { const result = await safeQuery('SELECT * FROM downtime_logs ORDER BY GREATEST(created_at, COALESCE(updated_at, created_at)) DESC, id DESC LIMIT $1 OFFSET $2', [limit, offset]); return res.json(result.rows); }  catch (err) { console.error('[HISTORIQUE] Erreur:', err.message); return res.status(500).json({ success: false, message: 'Erreur recuperation historique.', detail: CONFIG.server.env !== 'production' ? err.message : undefined, data: [] }); }
});

app.get('/api/stats', async (req, res) => {
  try {
    const [total, byStatus, kpiResults, topMachines, today, weekly, pendingCount] = await Promise.all([
      safeQuery('SELECT COUNT(*) AS count FROM downtime_logs'),
      safeQuery('SELECT status, COUNT(*) AS count FROM downtime_logs GROUP BY status ORDER BY count DESC'),
      // ✅ ENHANCED KPI CALCULATION with lifecycle tracking
      safeQuery(`
        SELECT 
          -- MTTR (Mean Time To Repair) - Total breakdown duration
          COALESCE(ROUND(AVG(temps_total_arret_minutes), 2), 0) AS mttr_minutes,
          -- MTTA (Mean Time To Acknowledge) - Detection to technician arrival
          COALESCE(ROUND(AVG(temps_reaction_minutes), 2), 0) AS mtta_minutes,
          -- Mean repair time (technician arrival to resolution)
          COALESCE(ROUND(AVG(temps_reparation_minutes), 2), 0) AS mean_repair_minutes,
          -- Count of resolved breakdowns for KPI validity
          COUNT(*) FILTER (WHERE status IN ('Resolved', 'Termine', 'Completed')) AS resolved_count,
          COUNT(*) FILTER (WHERE temps_reaction_minutes IS NOT NULL) AS acknowledged_count,
          COUNT(*) FILTER (WHERE temps_reparation_minutes IS NOT NULL) AS repair_time_count
        FROM downtime_logs 
        WHERE date_panne >= NOW() - INTERVAL '30 days'
      `),
      safeQuery('SELECT machine, COUNT(*) AS pannes FROM downtime_logs GROUP BY machine ORDER BY pannes DESC LIMIT 5'),
      safeQuery('SELECT COUNT(*) AS count FROM downtime_logs WHERE DATE(created_at) = CURRENT_DATE'),
      safeQuery(`SELECT DATE(created_at) AS jour, COUNT(*) AS total FROM downtime_logs WHERE created_at >= NOW() - INTERVAL '7 days' GROUP BY DATE(created_at) ORDER BY jour ASC`),
      safeQuery(`SELECT COUNT(*) AS count FROM downtime_logs WHERE status IN ('En attente', 'En cours')`)
    ]);
    
    const totalInterventions = parseInt(total.rows[0].count, 10) || 0;
    const kpi = kpiResults.rows[0];
    const pannesPending = parseInt(pendingCount.rows[0].count, 10) || 0;
    
    // Format KPI displays
    function formatDuration(minutes) {
      if (!minutes || minutes === 0) return 'N/A';
      if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        const mins = Math.round(minutes % 60);
        return `${hours}h ${mins}m`;
      }
      return `${Math.round(minutes)}m`;
    }
    
    const mttrDisplay = formatDuration(parseFloat(kpi.mttr_minutes));
    const mttaDisplay = formatDuration(parseFloat(kpi.mtta_minutes));
    const repairDisplay = formatDuration(parseFloat(kpi.mean_repair_minutes));
    
    // Calculate availability (assuming 24/7 operation for last 30 days)
    const totalMinutesInMonth = 30 * 24 * 60;
    const totalDowntimeMinutes = parseFloat(kpi.mttr_minutes) * parseInt(kpi.resolved_count) || 0;
    const availability = Math.max(0, ((totalMinutesInMonth - totalDowntimeMinutes) / totalMinutesInMonth) * 100);
    
    return res.json({ 
      // Legacy fields for compatibility
      downtime: totalInterventions, 
      mttr: mttrDisplay, 
      mttrMinutes: parseFloat(kpi.mttr_minutes) || 0,
      mttrAvailable: parseInt(kpi.resolved_count) > 0,
      pannesResolues: parseInt(kpi.resolved_count) || 0,
      pannesPending: pannesPending,
      
      // ✅ NEW: Complete KPI set
      mtta: mttaDisplay,
      mttaMinutes: parseFloat(kpi.mtta_minutes) || 0,
      mttaAvailable: parseInt(kpi.acknowledged_count) > 0,
      
      meanRepairTime: repairDisplay,
      meanRepairTimeMinutes: parseFloat(kpi.mean_repair_minutes) || 0,
      repairTimeAvailable: parseInt(kpi.repair_time_count) > 0,
      
      availability: `${availability.toFixed(1)}%`,
      availabilityPercentage: availability,
      
      // Additional metrics
      totalBreakdowns30Days: parseInt(kpi.resolved_count) + parseInt(kpi.acknowledged_count) || 0,
      acknowledgedBreakdowns: parseInt(kpi.acknowledged_count) || 0,
      
      // Legacy compatibility
      tempsReaction: mttaDisplay,
      tempsReparation: repairDisplay,
      tempsReactionMinutes: parseFloat(kpi.mtta_minutes) || 0,
      tempsReparationMinutes: parseFloat(kpi.mean_repair_minutes) || 0,
      mtbf: '120h', // Placeholder - would need production schedule data
      
      total: totalInterventions, 
      today: parseInt(today.rows[0].count, 10) || 0, 
      avgDuration: parseFloat(kpi.mttr_minutes) || 0,
      byStatus: byStatus.rows, 
      topMachines: topMachines.rows, 
      weekly: weekly.rows 
    });
  } catch (err) { 
    console.error('[STATS] Erreur:', err.message); 
    return res.status(500).json({ 
      success: false, 
      message: err.message, 
      // Fallback values
      downtime: 0, mttr: 'Erreur', mtta: 'N/A', meanRepairTime: 'N/A',
      mtbf: '0h', availability: '0%', total: 0, today: 0, 
      avgDuration: 0, byStatus: [], topMachines: [], weekly: [] 
    }); 
  }
});

app.get('/api/analysis', async (req, res) => {
  try {
    const [byAlertType, byAtelier, byTechnician, byMonth] = await Promise.all([
      safeQuery(`SELECT alert_type, COUNT(*) AS count FROM downtime_logs WHERE alert_type IS NOT NULL GROUP BY alert_type ORDER BY count DESC LIMIT 10`),
      safeQuery(`SELECT atelier, COUNT(*) AS count FROM downtime_logs WHERE atelier IS NOT NULL GROUP BY atelier ORDER BY count DESC`),
      safeQuery(`SELECT technician, COUNT(*) AS count FROM downtime_logs WHERE technician IS NOT NULL AND technician != 'Non assigne' GROUP BY technician ORDER BY count DESC LIMIT 10`),
      safeQuery(`SELECT DATE_TRUNC('month', created_at) AS month, COUNT(*) AS count FROM downtime_logs GROUP BY DATE_TRUNC('month', created_at) ORDER BY month DESC LIMIT 12`)
    ]);
    return sendSuccess(res, {
      byAlertType: byAlertType.rows,
      byAtelier: byAtelier.rows,
      byTechnician: byTechnician.rows,
      byMonth: byMonth.rows.map(r => ({ month: r.month.toISOString().slice(0, 7), count: parseInt(r.count, 10) }))
    }, 'Analyse des pannes');
  } catch (err) { return sendError(res, 500, 'Erreur analyse des pannes.', err.message); }
});

// ✅ NEW: Manual Data Generator trigger
app.post('/api/data-generator/trigger', async (req, res) => {
  try {
    const generator = req.app.get('dataGenerator');
    if (!generator) {
      return sendError(res, 503, 'Data Generator non initialisé');
    }
    
    await generator.generateNow();
    return sendSuccess(res, null, 'Génération de données déclenchée avec succès');
    
  } catch (err) {
    return sendError(res, 500, 'Erreur génération données', err.message);
  }
});

app.post('/api/data-generator/fill-nulls', async (req, res) => {
  try {
    const generator = req.app.get('dataGenerator');
    if (!generator) {
      return sendError(res, 503, 'Data Generator non initialisé');
    }
    
    await generator.fillNullValues();
    return sendSuccess(res, null, 'Valeurs NULL remplies avec succès');
    
  } catch (err) {
    return sendError(res, 500, 'Erreur remplissage NULL', err.message);
  }
});

app.get('/api/sessions', async (req, res) => {
  const limit = Math.min(sanitizeInt(req.query.limit, 200), CONFIG.pagination.maxLimit);
  try { const result = await safeQuery(`SELECT id AS log_id, machine AS name, alert_type AS type, status, duration, technician AS service, created_at AS date FROM downtime_logs ORDER BY GREATEST(created_at, updated_at) DESC LIMIT $1`, [limit]); return res.status(200).json(result.rows); }
  catch (err) { return sendError(res, 500, 'Erreur recuperation sessions.', err.message); }
});

// ✅ NEW: Factory status overview
app.get('/api/factory/status', async (req, res) => {
  try {
    const [totalMachines, nonOperational, byStatus, byZone] = await Promise.all([
      safeQuery(`SELECT COUNT(DISTINCT machine) as count FROM downtime_logs WHERE machine != 'KA01'`),
      safeQuery(`
        SELECT COUNT(DISTINCT machine) as count
        FROM downtime_logs
        WHERE status NOT IN ('Termine', 'Resolved', 'Completed', 'resolved', 'termine', 'completed')
          AND machine != 'KA01'
          AND status IS NOT NULL
          AND date_panne >= NOW() - INTERVAL '24 hours'
      `),
      safeQuery(`
        SELECT 
          CASE 
            WHEN status IN ('En attente') THEN 'downtime'
            WHEN status IN ('En cours') THEN 'maintenance'
            ELSE 'other'
          END as status_category,
          COUNT(DISTINCT machine) as count
        FROM downtime_logs
        WHERE status NOT IN ('Termine', 'Resolved', 'Completed', 'resolved', 'termine', 'completed')
          AND machine != 'KA01'
          AND status IS NOT NULL
          AND date_panne >= NOW() - INTERVAL '24 hours'
        GROUP BY status_category
      `),
      safeQuery(`
        SELECT 
          SUBSTRING(machine FROM 1 FOR 2) as zone,
          COUNT(DISTINCT machine) as count
        FROM downtime_logs
        WHERE status NOT IN ('Termine', 'Resolved', 'Completed', 'resolved', 'termine', 'completed')
          AND machine != 'KA01'
          AND status IS NOT NULL
          AND date_panne >= NOW() - INTERVAL '24 hours'
        GROUP BY zone
        ORDER BY zone
      `)
    ]);
    
    const total = parseInt(totalMachines.rows[0].count) || 0;
    const nonOp = parseInt(nonOperational.rows[0].count) || 0;
    const operational = total - nonOp;
    
    return sendSuccess(res, {
      total_machines: total,
      operational: operational,
      non_operational: nonOp,
      operational_percentage: total > 0 ? Math.round((operational / total) * 100) : 100,
      by_status: byStatus.rows,
      by_zone: byZone.rows,
      target_non_operational: '5-20',
      is_balanced: nonOp >= 5 && nonOp <= 20
    }, 'État usine');
    
  } catch (err) {
    return sendError(res, 500, 'Erreur récupération état usine', err.message);
  }
});

// ✅ NEW: RFID Technician lookup endpoint
app.get('/api/technicians/rfid/:uid', async (req, res) => {
  const { uid } = req.params;
  
  if (!uid) {
    return sendError(res, 400, 'RFID UID requis');
  }
  
  try {
    const result = await safeQuery(
      'SELECT * FROM technicians WHERE rfid_uid = $1 AND active = true LIMIT 1',
      [uid]
    );
    
    if (result.rows.length === 0) {
      return sendError(res, 404, 'Technicien non trouvé pour ce badge RFID');
    }
    
    const technician = result.rows[0];
    console.log(`[RFID] Technicien identifié: ${technician.name} (${uid})`);
    
    return sendSuccess(res, technician, 'Technicien trouvé');
    
  } catch (err) {
    console.error('[RFID] Erreur:', err);
    return sendError(res, 500, 'Erreur lors de la recherche du technicien', err.message);
  }
});

// ✅ NEW: Get breakdown categories for classification
app.get('/api/breakdown-categories', async (req, res) => {
  try {
    const result = await safeQuery(
      'SELECT * FROM breakdown_categories ORDER BY priority_level ASC, category_name ASC'
    );
    
    return sendSuccess(res, result.rows, 'Catégories de pannes');
    
  } catch (err) {
    return sendError(res, 500, 'Erreur récupération catégories', err.message);
  }
});

// ✅ NEW: Get active breakdowns for technician dashboard
app.get('/api/breakdowns/active', async (req, res) => {
  try {
    const result = await safeQuery(`
      SELECT 
        id,
        machine,
        alert_type,
        criticite,
        date_panne,
        heure_panne,
        atelier,
        lifecycle_phase,
        piece_observation,
        EXTRACT(EPOCH FROM (NOW() - date_panne)) / 60 AS minutes_elapsed
      FROM downtime_logs 
      WHERE status NOT IN ('Resolved', 'Termine', 'Completed', 'resolved', 'termine', 'completed')
        AND status IS NOT NULL
      ORDER BY 
        CASE criticite 
          WHEN 'Critique' THEN 1 
          WHEN 'Majeure' THEN 2 
          WHEN 'Moderee' THEN 3 
          ELSE 4 
        END,
        date_panne DESC
    `);
    
    return sendSuccess(res, result.rows, 'Pannes actives');
    
  } catch (err) {
    return sendError(res, 500, 'Erreur récupération pannes actives', err.message);
  }
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

// ✅ NEW: PHASE 2 API - Technician Acknowledgment (Arrival)
app.post('/api/technician/acknowledge', async (req, res) => {
  const { logId, machineId, technicianName, criticite, observation, rfidUid } = req.body;
  
  if (!logId && !machineId) {
    return sendError(res, 400, 'logId ou machineId requis');
  }
  
  if (!technicianName) {
    return sendError(res, 400, 'technicianName requis');
  }
  
  try {
    const now = new Date();
    const heureArrivee = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    let query, params;
    
    if (logId) {
      // Update by log ID (preferred)
      query = `
        UPDATE downtime_logs 
        SET 
          technician = $1,
          date_arrivee_technicien = $2,
          heure_arrivee = $3,
          heure_arret_technicien = $3,
          criticite = COALESCE($4, criticite),
          piece_observation = COALESCE($5, piece_observation),
          rfid_uid = $6,
          lifecycle_phase = 'acknowledged',
          status = 'En cours',
          -- Calculate reaction time (time from detection to technician arrival)
          temps_reaction_minutes = GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_panne)) / 60)::INTEGER,
          updated_at = $2
        WHERE id = $7
          AND status NOT IN ('Resolved', 'Termine', 'Completed', 'resolved', 'termine', 'completed')
        RETURNING *;
      `;
      params = [technicianName, now, heureArrivee, criticite, observation, rfidUid, logId];
    } else {
      // Update by machine ID (find most recent active breakdown)
      query = `
        UPDATE downtime_logs 
        SET 
          technician = $1,
          date_arrivee_technicien = $2,
          heure_arrivee = $3,
          heure_arret_technicien = $3,
          criticite = COALESCE($4, criticite),
          piece_observation = COALESCE($5, piece_observation),
          rfid_uid = $6,
          lifecycle_phase = 'acknowledged',
          status = 'En cours',
          temps_reaction_minutes = GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_panne)) / 60)::INTEGER,
          updated_at = $2
        WHERE id = (
          SELECT id FROM downtime_logs
          WHERE machine = $7
            AND status NOT IN ('Resolved', 'Termine', 'Completed', 'resolved', 'termine', 'completed')
            AND status IS NOT NULL
          ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC
          LIMIT 1
        )
        RETURNING *;
      `;
      params = [technicianName, now, heureArrivee, criticite, observation, rfidUid, machineId];
    }
    
    const result = await safeQuery(query, params);
    
    if (result.rowCount === 0) {
      return sendError(res, 404, 'Aucune panne active trouvée pour cette machine');
    }
    
    const updatedLog = result.rows[0];
    
    console.log(`[PHASE 2: ACKNOWLEDGMENT] ✅ Technicien arrivé`);
    console.log(`   Log ID: ${updatedLog.id}`);
    console.log(`   Machine: ${updatedLog.machine}`);
    console.log(`   Technicien: ${technicianName}`);
    console.log(`   Date arrivée: ${now.toLocaleDateString('fr-FR')}`);
    console.log(`   Heure arrivée: ${heureArrivee}`);
    console.log(`   Temps réaction: ${updatedLog.temps_reaction_minutes} minutes`);
    console.log(`   Criticité: ${updatedLog.criticite}`);
    console.log(`   Lifecycle: detected → acknowledged → waiting for resolution`);
    
    // Emit real-time event
    const io = req.app.get('io');
    if (io) {
      const ackEvent = {
        logId: updatedLog.id,
        code: updatedLog.machine,
        status: 'maintenance',
        type: updatedLog.alert_type || 'En cours',
        color: 'blue',
        technicianName: technicianName,
        rfid_uid: rfidUid,
        dateArrivee: now.toISOString(),
        heureArrivee: heureArrivee,
        tempsReaction: updatedLog.temps_reaction_minutes,
        criticite: updatedLog.criticite,
        observation: updatedLog.piece_observation,
        lifecycle_phase: 'acknowledged',
        timestamp: Date.now()
      };
      
      io.emit('technician_acknowledged', ackEvent);
      io.emit('machineStatusChanged', ackEvent);
      io.emit('updateMachines', [ackEvent]);
      
      console.log(`   📡 Real-time acknowledgment events sent to dashboard`);
    }
    
    // ✅ Notify MQTT bridge if available
    const bridge = req.app.get('mqttBridge');
    if (bridge && bridge.publishLifecycleEvent) {
      bridge.publishLifecycleEvent('acknowledged', updatedLog.machine, {
        technician: technicianName,
        rfid_uid: rfidUid,
        reaction_time: updatedLog.temps_reaction_minutes,
        criticite: updatedLog.criticite
      });
    }
    
    return sendSuccess(res, {
      log: updatedLog,
      mtta: updatedLog.temps_reaction_minutes
    }, 'Arrivée technicien enregistrée avec succès');
    
  } catch (err) {
    console.error('[PHASE 2: ACKNOWLEDGMENT] Erreur:', err);
    return sendError(res, 500, 'Erreur lors de l\'enregistrement de l\'arrivée', err.message);
  }
});

// ✅ NEW: PHASE 3 API - Manual Resolution (Green Button Alternative)
app.post('/api/breakdown/resolve', async (req, res) => {
  const { logId, machineId, resolvedBy, actionsTaken, sparePartsUsed, rootCause, preventiveActions } = req.body;
  
  if (!logId && !machineId) {
    return sendError(res, 400, 'logId ou machineId requis');
  }
  
  if (!resolvedBy) {
    return sendError(res, 400, 'resolvedBy requis (nom de la personne qui résout)');
  }
  
  try {
    const now = new Date();
    const heureReparation = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    let query, params;
    
    if (logId) {
      // Resolve by specific log ID
      query = `
        UPDATE downtime_logs 
        SET 
          status = 'Termine',
          resolved_by = $1,
          date_reparation = $2,
          heure_reparation = $3,
          lifecycle_phase = 'resolved',
          actions_taken = COALESCE($4, actions_taken),
          spare_parts_used = COALESCE($5, spare_parts_used),
          root_cause = COALESCE($6, root_cause),
          preventive_actions = COALESCE($7, preventive_actions),
          -- Calculate total downtime (from detection to repair)
          temps_total_arret_minutes = GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_panne)) / 60)::INTEGER,
          duration = GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_panne)) / 60)::INTEGER,
          -- Calculate repair time (from technician arrival to repair completion)
          temps_reparation_minutes = CASE 
            WHEN date_arrivee_technicien IS NOT NULL 
            THEN GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_arrivee_technicien)) / 60)::INTEGER
            ELSE NULL
          END,
          temps_intervention_minutes = CASE 
            WHEN date_arrivee_technicien IS NOT NULL 
            THEN GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_arrivee_technicien)) / 60)::INTEGER
            ELSE GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_panne)) / 60)::INTEGER
          END,
          updated_at = $2
        WHERE id = $8
          AND status NOT IN ('Resolved', 'Termine', 'Completed', 'resolved', 'termine', 'completed')
        RETURNING *;
      `;
      params = [resolvedBy, now, heureReparation, actionsTaken, sparePartsUsed, rootCause, preventiveActions, logId];
    } else {
      // Resolve by machine ID (most recent active breakdown)
      query = `
        UPDATE downtime_logs 
        SET 
          status = 'Termine',
          resolved_by = $1,
          date_reparation = $2,
          heure_reparation = $3,
          lifecycle_phase = 'resolved',
          actions_taken = COALESCE($4, actions_taken),
          spare_parts_used = COALESCE($5, spare_parts_used),
          root_cause = COALESCE($6, root_cause),
          preventive_actions = COALESCE($7, preventive_actions),
          temps_total_arret_minutes = GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_panne)) / 60)::INTEGER,
          duration = GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_panne)) / 60)::INTEGER,
          temps_reparation_minutes = CASE 
            WHEN date_arrivee_technicien IS NOT NULL 
            THEN GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_arrivee_technicien)) / 60)::INTEGER
            ELSE NULL
          END,
          temps_intervention_minutes = CASE 
            WHEN date_arrivee_technicien IS NOT NULL 
            THEN GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_arrivee_technicien)) / 60)::INTEGER
            ELSE GREATEST(0, EXTRACT(EPOCH FROM ($2 - date_panne)) / 60)::INTEGER
          END,
          updated_at = $2
        WHERE id = (
          SELECT id FROM downtime_logs
          WHERE machine = $8
            AND status NOT IN ('Resolved', 'Termine', 'Completed', 'resolved', 'termine', 'completed')
            AND status IS NOT NULL
          ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC
          LIMIT 1
        )
        RETURNING *;
      `;
      params = [resolvedBy, now, heureReparation, actionsTaken, sparePartsUsed, rootCause, preventiveActions, machineId];
    }
    
    const result = await safeQuery(query, params);
    
    if (result.rowCount === 0) {
      return sendError(res, 404, 'Aucune panne active trouvée à résoudre');
    }
    
    const resolvedLog = result.rows[0];
    
    console.log(`[PHASE 3: MANUAL RESOLUTION] ✅ Panne résolue manuellement`);
    console.log(`   Log ID: ${resolvedLog.id}`);
    console.log(`   Machine: ${resolvedLog.machine}`);
    console.log(`   Résolu par: ${resolvedBy}`);
    console.log(`   Durée totale: ${resolvedLog.temps_total_arret_minutes} minutes`);
    console.log(`   Temps réparation: ${resolvedLog.temps_reparation_minutes || 'N/A'} minutes`);
    console.log(`   Lifecycle: detected → acknowledged → resolved ✓`);
    
    // Emit real-time resolution event
    const io = req.app.get('io');
    if (io) {
      const resolutionEvent = {
        logId: resolvedLog.id,
        code: resolvedLog.machine,
        status: 'operational',
        type: 'Resolved',
        color: 'green',
        resolvedBy: resolvedBy,
        dateReparation: now.toISOString(),
        heureReparation: heureReparation,
        tempsTotal: resolvedLog.temps_total_arret_minutes,
        tempsReparation: resolvedLog.temps_reparation_minutes,
        tempsReaction: resolvedLog.temps_reaction_minutes,
        actionsTaken: resolvedLog.actions_taken,
        rootCause: resolvedLog.root_cause,
        lifecycle_phase: 'resolved',
        timestamp: Date.now()
      };
      
      io.emit('breakdown_resolved', resolutionEvent);
      io.emit('machineStatusChanged', resolutionEvent);
      io.emit('updateMachines', [resolutionEvent]);
      io.emit('alert_resolved', resolutionEvent);
      
      console.log(`   📡 Real-time resolution events sent to dashboard`);
    }
    
    // Update machine status in machines table
    await safeQuery(
      'UPDATE machines SET status = $1, type_erreur = NULL WHERE code = $2',
      ['operational', resolvedLog.machine]
    );
    
    // ✅ Notify MQTT bridge
    const bridge = req.app.get('mqttBridge');
    if (bridge) {
      if (bridge.publishLifecycleEvent) {
        bridge.publishLifecycleEvent('resolved', resolvedLog.machine, {
          resolved_by: resolvedBy,
          total_duration: resolvedLog.temps_total_arret_minutes,
          repair_duration: resolvedLog.temps_reparation_minutes
        });
      }
      
      if (bridge.updateMachineStateTracker) {
        bridge.updateMachineStateTracker(resolvedLog.machine, 'operational', 'Resolved');
      }
    }
    
    return sendSuccess(res, {
      log: resolvedLog,
      mttr: resolvedLog.temps_total_arret_minutes,
      repairTime: resolvedLog.temps_reparation_minutes
    }, 'Panne résolue avec succès');
    
  } catch (err) {
    console.error('[PHASE 3: MANUAL RESOLUTION] Erreur:', err);
    return sendError(res, 500, 'Erreur lors de la résolution', err.message);
  }
});

// ✅ NEW: Get breakdown lifecycle status for real-time monitoring
app.get('/api/breakdown/lifecycle/:machineId', async (req, res) => {
  const { machineId } = req.params;
  
  try {
    const result = await safeQuery(`
      SELECT 
        id,
        machine,
        alert_type,
        status,
        lifecycle_phase,
        criticite,
        technician,
        operator,
        date_panne,
        date_arrivee_technicien,
        date_reparation,
        heure_panne,
        heure_arrivee,
        heure_reparation,
        temps_reaction_minutes,
        temps_reparation_minutes,
        temps_total_arret_minutes,
        temps_intervention_minutes,
        piece_observation,
        actions_taken,
        root_cause,
        spare_parts_used,
        preventive_actions,
        resolved_by,
        atelier,
        rfid_uid,
        created_at,
        updated_at
      FROM downtime_logs 
      WHERE machine = $1 
        AND status NOT IN ('Resolved', 'Termine', 'Completed', 'resolved', 'termine', 'completed')
        AND status IS NOT NULL
      ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC 
      LIMIT 1
    `, [machineId]);
    
    if (result.rows.length === 0) {
      return sendSuccess(res, null, 'Aucune panne active pour cette machine');
    }
    
    const breakdown = result.rows[0];
    
    // Calculate elapsed times
    const now = new Date();
    const timeSinceDetection = breakdown.date_panne 
      ? Math.floor((now - new Date(breakdown.date_panne)) / 60000)
      : 0;
    
    const timeSinceAcknowledgment = breakdown.date_arrivee_technicien
      ? Math.floor((now - new Date(breakdown.date_arrivee_technicien)) / 60000)
      : null;
    
    return sendSuccess(res, {
      ...breakdown,
      elapsed_time_minutes: timeSinceDetection,
      elapsed_since_acknowledgment: timeSinceAcknowledgment,
      is_active: true
    }, 'Lifecycle actuel de la panne');
    
  } catch (err) {
    return sendError(res, 500, 'Erreur récupération lifecycle', err.message);
  }
});

// ✅ NEW: Get complete breakdown history for a machine
app.get('/api/breakdown/history/:machineId', async (req, res) => {
  const { machineId } = req.params;
  const limit = Math.min(sanitizeInt(req.query.limit, 20), 100);
  const offset = sanitizeInt(req.query.offset, 0);
  
  try {
    const result = await safeQuery(`
      SELECT 
        id,
        machine,
        alert_type,
        status,
        lifecycle_phase,
        criticite,
        technician,
        operator,
        date_panne,
        date_arrivee_technicien,
        date_reparation,
        temps_reaction_minutes,
        temps_reparation_minutes,
        temps_total_arret_minutes,
        piece_observation,
        actions_taken,
        root_cause,
        resolved_by,
        atelier,
        created_at
      FROM downtime_logs 
      WHERE machine = $1 
      ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC 
      LIMIT $2 OFFSET $3
    `, [machineId, limit, offset]);
    
    return sendSuccess(res, result.rows, `Historique des pannes pour ${machineId}`);
    
  } catch (err) {
    return sendError(res, 500, 'Erreur récupération historique', err.message);
  }
});

// ✅ NEW: Real-time KPI dashboard endpoint
app.get('/api/kpi/realtime', async (req, res) => {
  const period = req.query.period || '24h'; // 24h, 7d, 30d
  
  let intervalClause;
  switch (period) {
    case '7d':
      intervalClause = "7 days";
      break;
    case '30d':
      intervalClause = "30 days";
      break;
    default:
      intervalClause = "24 hours";
  }
  
  try {
    const [activeBreakdowns, kpiData, machinePerformance, technicianPerformance] = await Promise.all([
      // Active breakdowns
      safeQuery(`
        SELECT 
          machine,
          alert_type,
          lifecycle_phase,
          criticite,
          date_panne,
          technician,
          EXTRACT(EPOCH FROM (NOW() - date_panne)) / 60 AS elapsed_minutes
        FROM downtime_logs 
        WHERE status NOT IN ('Resolved', 'Termine', 'Completed', 'resolved', 'termine', 'completed')
          AND status IS NOT NULL
        ORDER BY 
          CASE criticite 
            WHEN 'Critique' THEN 1 
            WHEN 'Majeure' THEN 2 
            WHEN 'Moderee' THEN 3 
            ELSE 4 
          END,
          date_panne ASC
      `),
      
      // KPI calculations
      safeQuery(`
        SELECT 
          COUNT(*) AS total_breakdowns,
          COUNT(*) FILTER (WHERE status IN ('Resolved', 'Termine', 'Completed')) AS resolved_breakdowns,
          COUNT(*) FILTER (WHERE lifecycle_phase = 'acknowledged') AS acknowledged_breakdowns,
          COALESCE(ROUND(AVG(temps_total_arret_minutes), 2), 0) AS avg_mttr,
          COALESCE(ROUND(AVG(temps_reaction_minutes), 2), 0) AS avg_mtta,
          COALESCE(ROUND(AVG(temps_reparation_minutes), 2), 0) AS avg_repair_time,
          COALESCE(SUM(temps_total_arret_minutes), 0) AS total_downtime_minutes
        FROM downtime_logs 
        WHERE created_at >= NOW() - INTERVAL '${intervalClause}'
      `),
      
      // Machine performance
      safeQuery(`
        SELECT 
          machine,
          COUNT(*) AS breakdown_count,
          COALESCE(ROUND(AVG(temps_total_arret_minutes), 2), 0) AS avg_downtime,
          COALESCE(SUM(temps_total_arret_minutes), 0) AS total_downtime
        FROM downtime_logs 
        WHERE created_at >= NOW() - INTERVAL '${intervalClause}'
        GROUP BY machine 
        ORDER BY breakdown_count DESC, total_downtime DESC
        LIMIT 10
      `),
      
      // Technician performance
      safeQuery(`
        SELECT 
          technician,
          COUNT(*) AS interventions,
          COALESCE(ROUND(AVG(temps_reaction_minutes), 2), 0) AS avg_reaction_time,
          COALESCE(ROUND(AVG(temps_reparation_minutes), 2), 0) AS avg_repair_time
        FROM downtime_logs 
        WHERE created_at >= NOW() - INTERVAL '${intervalClause}'
          AND technician IS NOT NULL 
          AND technician != 'Non assigne'
          AND temps_reaction_minutes IS NOT NULL
        GROUP BY technician 
        ORDER BY interventions DESC
        LIMIT 10
      `)
    ]);
    
    const kpi = kpiData.rows[0];
    
    // Calculate availability (assuming 24/7 operation)
    const totalPossibleMinutes = period === '7d' ? 7 * 24 * 60 : 
                                  period === '30d' ? 30 * 24 * 60 : 
                                  24 * 60;
    const availability = Math.max(0, ((totalPossibleMinutes - kpi.total_downtime_minutes) / totalPossibleMinutes) * 100);
    
    return sendSuccess(res, {
      period: period,
      timestamp: new Date().toISOString(),
      active_breakdowns: activeBreakdowns.rows,
      kpi: {
        total_breakdowns: parseInt(kpi.total_breakdowns),
        resolved_breakdowns: parseInt(kpi.resolved_breakdowns),
        acknowledged_breakdowns: parseInt(kpi.acknowledged_breakdowns),
        pending_breakdowns: activeBreakdowns.rows.length,
        mttr_minutes: parseFloat(kpi.avg_mttr),
        mtta_minutes: parseFloat(kpi.avg_mtta),
        repair_time_minutes: parseFloat(kpi.avg_repair_time),
        total_downtime_minutes: parseInt(kpi.total_downtime_minutes),
        availability_percentage: Math.round(availability * 100) / 100,
        availability_display: `${availability.toFixed(1)}%`
      },
      machine_performance: machinePerformance.rows,
      technician_performance: technicianPerformance.rows
    }, 'KPI temps réel');
    
  } catch (err) {
    return sendError(res, 500, 'Erreur calcul KPI temps réel', err.message);
  }
});

app.post('/api/machines/update-status', async (req, res) => {
  const { code, status, type_erreur } = req.body;
  if (!isPresent(code) || !isPresent(status)) return sendError(res, 400, 'Les champs "code" et "status" sont obligatoires.');
  try {
    await safeQuery('UPDATE machines SET status = $1, type_erreur = $2 WHERE code = $3', [status, status.toLowerCase() === 'operational' ? null : (type_erreur || null), code]);
    console.log(`[Machines] ${code} -> status: "${status}"`);
    
    const wokwiStatus = (status === 'Operational' || status === 'Termine') ? 'operational' : status.toLowerCase();
    
    // ✅ FIX GREEN BUTTON: Update mqtt-bridge state tracker to prevent reversion
    const bridge = req.app.get('mqttBridge');
    if (bridge && bridge.updateMachineStateTracker) {
        bridge.updateMachineStateTracker(code, wokwiStatus, type_erreur || 'Resolved');
    }
    
    const io = req.app.get('io');
    if (io) {
        io.emit('machineStatusChanged', { machine: code, status: status, alert_type: type_erreur || null });
        // ✅ EMIT updateMachines pour temps réel (5 états Wokwi)
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
  console.log(`[SOCKET] Client connecté - ID: ${socket.id}`);
  
  // ✅ NEW: Send current breakdown status on connection
  socket.on('request_breakdown_status', async () => {
    try {
      const result = await pool.query(`
        SELECT 
          machine,
          alert_type,
          status,
          lifecycle_phase,
          criticite,
          technician,
          date_panne,
          date_arrivee_technicien,
          temps_reaction_minutes,
          EXTRACT(EPOCH FROM (NOW() - date_panne)) / 60 AS elapsed_minutes
        FROM downtime_logs 
        WHERE status NOT IN ('Resolved', 'Termine', 'Completed', 'resolved', 'termine', 'completed')
          AND status IS NOT NULL
        ORDER BY 
          CASE criticite 
            WHEN 'Critique' THEN 1 
            WHEN 'Majeure' THEN 2 
            WHEN 'Moderee' THEN 3 
            ELSE 4 
          END,
          date_panne ASC
      `);
      
      socket.emit('breakdown_status_update', {
        active_breakdowns: result.rows,
        timestamp: new Date().toISOString()
      });
      
      console.log(`[SOCKET] Current breakdown status sent to ${socket.id}`);
      
    } catch (err) {
      console.error('[SOCKET] Error sending breakdown status:', err.message);
    }
  });
  
  // ✅ NEW: Request real-time KPI data  
  socket.on('request_kpi_update', async (data) => {
    const period = data?.period || '24h';
    
    try {
      // Directly calculate KPI data instead of making HTTP request
      const [kpiData] = await Promise.all([
        pool.query(`
          SELECT 
            COUNT(*) AS total_breakdowns,
            COUNT(*) FILTER (WHERE status IN ('Resolved', 'Termine', 'Completed')) AS resolved_breakdowns,
            COUNT(*) FILTER (WHERE lifecycle_phase = 'acknowledged') AS acknowledged_breakdowns,
            COALESCE(ROUND(AVG(temps_total_arret_minutes), 2), 0) AS avg_mttr,
            COALESCE(ROUND(AVG(temps_reaction_minutes), 2), 0) AS avg_mtta,
            COALESCE(ROUND(AVG(temps_reparation_minutes), 2), 0) AS avg_repair_time,
            COALESCE(SUM(temps_total_arret_minutes), 0) AS total_downtime_minutes
          FROM downtime_logs 
          WHERE created_at >= NOW() - INTERVAL '${period === '7d' ? '7 days' : period === '30d' ? '30 days' : '24 hours'}'
        `)
      ]);
      
      const kpi = kpiData.rows[0];
      
      socket.emit('kpi_update', {
        period: period,
        kpi: {
          mttr_minutes: parseFloat(kpi.avg_mttr),
          mtta_minutes: parseFloat(kpi.avg_mtta), 
          repair_time_minutes: parseFloat(kpi.avg_repair_time),
          total_breakdowns: parseInt(kpi.total_breakdowns),
          resolved_breakdowns: parseInt(kpi.resolved_breakdowns)
        },
        timestamp: new Date().toISOString()
      });
      
      console.log(`[SOCKET] KPI data sent to ${socket.id} (period: ${period})`);
      
    } catch (err) {
      console.error('[SOCKET] Error sending KPI data:', err.message);
    }
  });
  
  // ✅ NEW: Join machine-specific rooms for targeted updates
  socket.on('monitor_machine', (machineId) => {
    if (machineId) {
      socket.join(`machine_${machineId}`);
      console.log(`[SOCKET] ${socket.id} monitoring machine ${machineId}`);
    }
  });
  
  // ✅ NEW: Leave machine monitoring
  socket.on('stop_monitoring_machine', (machineId) => {
    if (machineId) {
      socket.leave(`machine_${machineId}`);
      console.log(`[SOCKET] ${socket.id} stopped monitoring machine ${machineId}`);
    }
  });
  
  // ✅ NEW: Request machine lifecycle details
  socket.on('request_machine_lifecycle', async (machineId) => {
    try {
      const result = await pool.query(`
        SELECT 
          id, machine, alert_type, status, lifecycle_phase, criticite, technician,
          date_panne, date_arrivee_technicien, date_reparation,
          temps_reaction_minutes, temps_reparation_minutes, temps_total_arret_minutes,
          piece_observation, actions_taken, root_cause, resolved_by
        FROM downtime_logs 
        WHERE machine = $1 
          AND status NOT IN ('Resolved', 'Termine', 'Completed', 'resolved', 'termine', 'completed')
          AND status IS NOT NULL
        ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC 
        LIMIT 1
      `, [machineId]);
      
      socket.emit('machine_lifecycle_update', {
        machine: machineId,
        breakdown: result.rows[0] || null,
        timestamp: new Date().toISOString()
      });
      
    } catch (err) {
      console.error(`[SOCKET] Error getting lifecycle for ${machineId}:`, err.message);
    }
  });
  
  socket.on('disconnect', () => console.log(`[SOCKET] Client deconnecte - ID: ${socket.id}`));
});

// ✅ NEW: Enhanced Socket.IO event emitters for lifecycle events
function emitBreakdownDetected(breakdownData) {
  if (io) {
    io.emit('breakdown_detected', breakdownData);
    io.to(`machine_${breakdownData.code}`).emit('machine_breakdown_detected', breakdownData);
    console.log(`[SOCKET-EMIT] Breakdown detected event sent for ${breakdownData.code}`);
  }
}

function emitTechnicianAcknowledged(ackData) {
  if (io) {
    io.emit('technician_acknowledged', ackData);
    io.to(`machine_${ackData.code}`).emit('machine_technician_acknowledged', ackData);
    console.log(`[SOCKET-EMIT] Technician acknowledged event sent for ${ackData.code}`);
  }
}

function emitBreakdownResolved(resolutionData) {
  if (io) {
    io.emit('breakdown_resolved', resolutionData);
    io.emit('alert_resolved', resolutionData);
    io.to(`machine_${resolutionData.code}`).emit('machine_breakdown_resolved', resolutionData);
    console.log(`[SOCKET-EMIT] Breakdown resolved event sent for ${resolutionData.code}`);
  }
}

// Export these functions for use by other modules
app.set('socketEmitters', {
  emitBreakdownDetected,
  emitTechnicianAcknowledged,
  emitBreakdownResolved
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
    
    // ✅ INITIALISER DATA GENERATOR APRÈS DB READY
    try {
        dataGenerator.init(pool, io);
        app.set('dataGenerator', dataGenerator);
        console.log('✅ Data Generator initialisé avec succès');
        
        // Fill NULL values in existing data
        setTimeout(() => {
            console.log('[DATA-GEN] Starting NULL value cleanup...');
            dataGenerator.fillNullValues();
        }, 10000);
        
    } catch (err) {
        console.error('❌ Erreur initialisation Data Generator:', err.message);
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
      console.log('  ✅ LIFECYCLE API:');
      console.log('    GET  /api/technicians/rfid/:uid');
      console.log('    GET  /api/breakdown-categories');
      console.log('    GET  /api/breakdowns/active');
      console.log('    POST /api/technician/acknowledge');
      console.log('    POST /api/breakdown/resolve');
      console.log('    GET  /api/breakdown/lifecycle/:machineId');
      console.log('    GET  /api/breakdown/history/:machineId');
      console.log('    GET  /api/kpi/realtime');
      console.log('  ✅ DATA GENERATOR API:');
      console.log('    GET  /api/factory/status');
      console.log('    POST /api/data-generator/trigger');
      console.log('    POST /api/data-generator/fill-nulls');
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
  
  // Stop data generator
  try {
    const generator = app.get('dataGenerator');
    if (generator && generator.stop) {
      generator.stop();
      console.log('   -> Data Generator arrêté.');
    }
  } catch (err) {
    console.error('   -> Erreur arrêt Data Generator:', err.message);
  }
  
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