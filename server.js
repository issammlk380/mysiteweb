/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║     SMI ENTERPRISE — BACKEND API SERVER v2.4 (RAILWAY)          ║
 * ║     Production-ready CORS + Railway deployment                   ║
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

const path     = require('path');
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
   3. CORS - CONFIGURATION RAILWAY (m9adda)
═══════════════════════════════════════════════════════════════════ */
// Railway: khalli '*' f development, w domain dialk f production
const ALLOWED_ORIGIN = process.env.NODE_ENV === 'production' 
    ? '*'  // Railway kisupporti '*' f production
    : '*';

// Middleware CORS (BEFORE all routes)
app.use(cors({
    origin: ALLOWED_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Origin', 'X-Requested-With', 'Content-Type', 'Accept',
        'Authorization', 'ngrok-skip-browser-warning'
    ],
    credentials: false  // FALSE m3a Railway (mashi true)
}));

// Manual CORS headers (backup)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, ngrok-skip-browser-warning');
    
    // Handle preflight requests immediately
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

const server = http.createServer(app);
/* ═══════════════════════════════════════════════════════════════════
   4. POSTGRESQL - RAILWAY CONFIG
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

console.log(`🗄️  Mode: ${isRailway ? 'Railway (SSL ON)' : 'Localhost (SSL OFF)'}`);


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
                technician VARCHAR(100) DEFAULT 'Operateur',
                status VARCHAR(50) DEFAULT 'En attente',
                alert_type VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ [DB] Base table downtime_logs ready');

        const columnsToAdd = [
            { name: 'criticite', type: 'VARCHAR(50)', default: "'Moyenne'" },
            { name: 'alert_type', type: 'VARCHAR(100)', default: 'NULL' },
            { name: 'heure_arret_technicien', type: 'VARCHAR(20)', default: 'NULL' },
            { name: 'piece_observation', type: 'TEXT', default: 'NULL' },
            { name: 'atelier', type: 'VARCHAR(50)', default: 'NULL' },
            { name: 'updated_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
        ];

        for (const col of columnsToAdd) {
            try {
                await client.query(`
                    ALTER TABLE downtime_logs 
                    ADD COLUMN IF NOT EXISTS ${col.name} ${col.type} DEFAULT ${col.default}
                `);
                console.log(`✅ [DB] Column '${col.name}' ready`);
            } catch (e) {
                console.warn(`⚠️ [DB] Column '${col.name}': ${e.message}`);
            }
        }

        await client.query(`
            CREATE TABLE IF NOT EXISTS machines (
                code VARCHAR(10) PRIMARY KEY,
                status VARCHAR(50) DEFAULT 'operational',
                type_erreur VARCHAR(100)
            )
        `);
        console.log('✅ [DB] Table machines ready');

        const countResult = await client.query('SELECT COUNT(*) FROM downtime_logs');
        const count = parseInt(countResult.rows[0].count, 10);

        if (count === 0) {
            console.log('🔄 [DB] Seeding demo data...');
            await client.query(`
                INSERT INTO downtime_logs 
                (machine, start_time, duration, technician, status, criticite, alert_type, heure_arret_technicien, piece_observation, atelier)
                VALUES 
                ('KA01', '08:30:00', '45', 'Ahmed Benali', 'Terminé', 'Faible', 'Électrique', '08:45:00', 'Remplacement capteur proximité', 'Atelier A'),
                ('KB03', '09:15:00', '0', 'Operateur', 'Pending', 'Majeure', 'Mécanique', NULL, 'Surchauffe moteur principal', 'Atelier B'),
                ('KC07', '14:20:00', '120', 'Karim Fassi', 'En réparation', 'Critique', 'Électrique', '14:35:00', 'Changement carte d''axe', 'Atelier C'),
                ('KD02', '10:00:00', '30', 'Youssef Amrani', 'Terminé', 'Modérée', 'Hydraulique', '10:10:00', 'Lubrification glissières', 'Atelier D'),
                ('KX01', '11:45:00', '0', 'Operateur', 'Pending', 'Majeure', 'Hydraulique', NULL, 'Fuite hydraulique détectée', 'Atelier X'),
                ('KA05', '07:30:00', '60', 'Ahmed Benali', 'Terminé', 'Faible', 'Électrique', '07:40:00', 'Serrage connexions électriques', 'Atelier A'),
                ('KB08', '16:00:00', '90', 'Karim Fassi', 'Terminé', 'Modérée', 'Mécanique', '16:20:00', 'Remplacement roulements', 'Atelier B'),
                ('KC12', '13:10:00', '180', 'Youssef Amrani', 'En réparation', 'Critique', 'Hydraulique', '13:30:00', 'Purge circuit hydraulique', 'Atelier C'),
                ('KD05', '09:00:00', '40', 'Ahmed Benali', 'Terminé', 'Faible', 'Mécanique', '09:15:00', 'Nettoyage filtre à air', 'Atelier D'),
                ('KA09', '15:30:00', '0', 'Operateur', 'Pending', 'Majeure', 'Hydraulique', NULL, 'Changement joint étanchéité', 'Atelier A')
            `);
            console.log('✅ [DB] 10 demo records inserted');
        } else {
            console.log(`✅ [DB] Table already has ${count} records, skipping seed`);
        }

        await client.query('COMMIT');
        dbHealthy = true;
        dbError = null;
        console.log('✅ [DB] All migrations completed successfully');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ [DB] Migration failed:', err.message);
        dbHealthy = false;
        dbError = err.message;
        throw err;
    } finally {
        client.release();
    }
}

/* ═══════════════════════════════════════════════════════════════════
   6. SOCKET.IO - RAILWAY CONFIG (m9adda)
═══════════════════════════════════════════════════════════════════ */
const io = new Server(server, {
    transports: ['websocket', 'polling'],  // websocket f lwl
    cors: {
        origin: '*',  // Railway: khalli '*'
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Accept"],
        credentials: false  // FALSE m3a Railway
    },
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'issam.html'));
});
/* ── Logger ── */
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

function sendSuccess(res, data, msg = 'Opération réussie', status = 200) {
  return res.status(status).json({
    success: true,
    message: msg,
    timestamp: new Date().toISOString(),
    data,
  });
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

async function safeQuery(query, params = []) {
    if (!dbHealthy) {
        throw new Error('Database not initialized: ' + (dbError || 'Unknown error'));
    }
    return pool.query(query, params);
}

/* ═══════════════════════════════════════════════════════════════════
   8. VALIDATION
═══════════════════════════════════════════════════════════════════ */
function validateLogPayload(req, res, next) {
  const body = req.body;
  const requiredFields = {
    machine:    body.machine    || body.machineID,
    alert_type: body.alertType  || body.alert_type,
  };
  const missing = Object.entries(requiredFields)
    .filter(([, v]) => !isPresent(v))
    .map(([k]) => k);

  if (missing.length > 0) {
    return sendError(res, 400, `Champs obligatoires manquants : ${missing.join(', ')}`);
  }
  next();
}

/* ═══════════════════════════════════════════════════════════════════
   9. SIMULATION
═══════════════════════════════════════════════════════════════════ */
const LISTE_MACHINES_SMI = [ 
  'KA01','KA02','KA03','KA04','KA05','KA06','KA07','KA08','KA09','KA10','KA11','KA12','KA13','KA14','KA15', 
  'KB01','KB02','KB03','KB04','KB05','KB06','KB07','KB08','KB09','KB10','KB11','KB12','KB13','KB14','KB15', 
  'KC01','KC02','KC03','KC04','KC05','KC06','KC07','KC08','KC12','KC15','KC16','KC17','KC18', 
  'KD01','KD02','KD03','KD04','KD05','KD06','KD07','KD08', 
  'KX01','KX02','KX03','KX04','KX05' 
];

const LISTE_PANNES = ["Électrique", "Mécanique", "Surchauffe", "Hydraulique"];

const LISTE_OBSERVATIONS = [
  "Remplacement du capteur de proximité défectueux.",
  "Changement du fusible grillé sur le bloc d'alimentation.",
  "Nettoyage du filtre à air suite à une alerte de surchauffe.",
  "Remplacement de la courroie de transmission usée.",
  "Ajustement des paramètres de pression hydraulique.",
  "Lubrification des glissières et axes principaux.",
  "Serrage des connexions électriques desserrées dans l'armoire.",
  "Changement du joint d'étanchéité sur le vérin principal.",
  "Remplacement de la carte d'axe après court-circuit.",
  "Mise à jour du firmware de l'automate de contrôle.",
  "Changement de l'électrovanne de commande pneumatique.",
  "Purge du circuit hydraulique et appoint de fluide.",
  "Remplacement des roulements à billes de l'arbre moteur.",
  "Calibrage du capteur de température laser."
];

async function maintenirQuotaDesPannes() {
  try {
    if (!dbHealthy) return;

    const cibleAleatoire = Math.floor(Math.random() * (15 - 5 + 1)) + 5;
    const machinesMelangees = [...LISTE_MACHINES_SMI].sort(() => 0.5 - Math.random());
    const selectionMachinesEnPanne = machinesMelangees.slice(0, cibleAleatoire);

    const typesErreurs = ['Material', 'Mechanical', 'Electrical', 'Sensor', 'Software'];

    let listeFinaleDesPannes = selectionMachinesEnPanne.map(code => ({
      code: code,
      status: 'en panne',
      type_erreur: typesErreurs[Math.floor(Math.random() * typesErreurs.length)]
    }));

    const pannesReelles = await safeQuery(
      `SELECT machine AS code, 'en panne' AS status, piece_observation AS type_erreur 
       FROM downtime_logs 
       WHERE status IN ('Pending', 'Escalated', 'En attente') 
          OR heure_arret_technicien IS NULL 
          OR heure_arret_technicien = ''`
    );

    pannesReelles.rows.forEach(panneReelle => {
      const existeDeja = listeFinaleDesPannes.some(p => p.code === panneReelle.code);
      if (!existeDeja) listeFinaleDesPannes.push(panneReelle);
    });

    if (app.get('io')) {
      app.get('io').emit('updateMachines', listeFinaleDesPannes);
      console.log(`🎲 [Simulation] ${listeFinaleDesPannes.length} machines EN PANNE (Cible: ${cibleAleatoire})`);
    }
  } catch (err) {
    console.error('❌ [Machines] Erreur simulation :', err.message);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   10. ROUTES
═══════════════════════════════════════════════════════════════════ */
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return sendSuccess(res, {
      server: 'En ligne',
      database: dbHealthy ? 'Connecté' : 'Dégradé',
      version: '2.4.0',
      env: CONFIG.server.env,
      uptime: `${Math.floor(process.uptime())} secondes`,
    }, 'Serveur opérationnel');
  } catch (err) {
    return sendError(res, 503, 'Base de données inaccessible', err.message);
  }
});

app.get('/api/debug', async (_req, res) => {
    try {
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name IN ('downtime_logs', 'machines')
        `);

        let columns = [];
        try {
            const colResult = await pool.query(`
                SELECT column_name, data_type, is_nullable 
                FROM information_schema.columns 
                WHERE table_name = 'downtime_logs' 
                ORDER BY ordinal_position
            `);
            columns = colResult.rows;
        } catch (e) {
            columns = [{ error: e.message }];
        }

        let count = 0;
        try {
            const countResult = await pool.query('SELECT COUNT(*) FROM downtime_logs');
            count = parseInt(countResult.rows[0].count, 10);
        } catch (e) {
            count = -1;
        }

        return res.json({
            success: true,
            dbHealthy,
            dbError,
            tables: tableCheck.rows.map(r => r.table_name),
            downtime_logs_columns: columns,
            downtime_logs_count: count,
            database_url: process.env.DATABASE_URL ? 'Configured (hidden)' : 'Not set',
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!isPresent(username) || !isPresent(password)) {
    return sendError(res, 400, 'Les champs "username" et "password" sont obligatoires.');
  }
  const isValid = username.trim() === CONFIG.auth.adminUsername && password === CONFIG.auth.adminPassword;
  if (!isValid) {
    console.warn(`⚠️ [AUTH] Tentative échouée — "${username}"`);
    return sendError(res, 401, 'Identifiants incorrects.');
  }
  console.log(`✅ [AUTH] Connexion réussie — "${username}"`);
  return sendSuccess(res, { username: username.trim(), role: 'admin' }, 'Connexion réussie');
});

app.post('/api/logs', validateLogPayload, async (req, res) => {
    const body = req.body;
    const indexMachine = Math.floor(Math.random() * LISTE_MACHINES_SMI.length);
    const machine = LISTE_MACHINES_SMI[indexMachine];

    const start_time = sanitizeStr(body.startTime || body.start_time, new Date().toLocaleTimeString('fr-FR'));
    const duration = sanitizeInt(body.duration, 0);
    const technician = sanitizeStr(body.technician || body.technicianName, 'Operateur');
    let status = 'En attente';

    let alert_type = null;
    let heure_arret_technicien = null;
    let piece_observation = null;
    let criticite = "Moyenne";

    const hasard = Math.random();

    if (hasard < 0.7) {
        const indexPanne = Math.floor(Math.random() * LISTE_PANNES.length);
        const indexObs = Math.floor(Math.random() * LISTE_OBSERVATIONS.length);
        alert_type = LISTE_PANNES[indexPanne];
        heure_arret_technicien = new Date().toLocaleTimeString('fr-FR'); 
        piece_observation = LISTE_OBSERVATIONS[indexObs]; 
        criticite = "Haute";
        console.log(`🤖 [70%] Auto -> Machine: ${machine} | Panne: ${alert_type}`);
    } else {
        alert_type = null;
        heure_arret_technicien = null;
        piece_observation = null;
        criticite = "Moyenne";
        console.log(`👨‍🔧 [30%] NULL -> Machine: ${machine}. En attente technicien.`);
    }

    try {
        const result = await safeQuery(
            `INSERT INTO downtime_logs 
            (machine, start_time, duration, technician, status, criticite, alert_type, heure_arret_technicien, piece_observation, atelier) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
            RETURNING id;`, 
            [machine, start_time, duration.toString(), technician, status, criticite, alert_type, heure_arret_technicien, piece_observation, deriveAtelier(machine)]
        );
        return sendSuccess(res, result.rows[0], 'Log inséré avec succès.', 201);
    } catch (err) {
        console.error('[LOGS] Erreur insertion :', err.message);
        return sendError(res, 500, "Erreur interne lors de l'insertion.", err.message);
    }
});

function deriveAtelier(machine) {
    if (!machine) return 'Atelier Général';
    const prefix = String(machine).substring(0, 2).toUpperCase();
    const map = { 'KA': 'Atelier A', 'KB': 'Atelier B', 'KC': 'Atelier C', 'KD': 'Atelier D', 'KX': 'Atelier X' };
    return map[prefix] || 'Atelier Général';
}

app.get('/api/logs', async (req, res) => {
  const limit   = Math.min(sanitizeInt(req.query.limit, CONFIG.pagination.defaultLimit), CONFIG.pagination.maxLimit);
  const offset  = sanitizeInt(req.query.offset, 0);
  const status  = sanitizeStr(req.query.status);
  const machine = sanitizeStr(req.query.machine);

  try {
    const conditions = [];
    const params     = [];
    let   idx        = 1;

    if (status)  { conditions.push(`LOWER(status) = LOWER($${idx++})`); params.push(status); }
    if (machine) { conditions.push(`LOWER(machine) LIKE LOWER($${idx++})`); params.push(`%${machine}%`); }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const dataQuery   = `SELECT * FROM downtime_logs ${whereClause} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++};`;
    const countQuery  = `SELECT COUNT(*) AS total FROM downtime_logs ${whereClause};`;
    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      safeQuery(dataQuery, params),
      safeQuery(countQuery, params.slice(0, -2)),
    ]);

    return sendSuccess(res, {
      logs: dataResult.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total, 10),
        limit, offset,
        returned: dataResult.rows.length,
      },
    });
  } catch (err) {
    return sendError(res, 500, 'Erreur récupération logs.', err.message);
  }
});

app.get('/api/logs/:id', async (req, res) => {
  const { id } = req.params;
  if (!isPresent(id)) return sendError(res, 400, 'ID requis.');
  try {
    const result = await safeQuery('SELECT * FROM downtime_logs WHERE id = $1 LIMIT 1', [sanitizeStr(id)]);
    if (!result.rows.length) return sendError(res, 404, `Log "${id}" introuvable.`);
    return sendSuccess(res, result.rows[0]);
  } catch (err) {
    return sendError(res, 500, 'Erreur recherche log.', err.message);
  }
});

app.put('/api/logs/:id', async (req, res) => {
  const { id } = req.params;
  const { status, technician, duration } = req.body;
  if (!isPresent(id)) return sendError(res, 400, 'ID requis.');
  if (!isPresent(status)) return sendError(res, 400, 'Champ "status" obligatoire.');

  try {
    const result = await safeQuery(
      `UPDATE downtime_logs SET status = $1, technician = COALESCE($2, technician), duration = COALESCE($3, duration), updated_at = NOW() WHERE id = $4 RETURNING *;`,
      [sanitizeStr(status), isPresent(technician) ? sanitizeStr(technician) : null, isPresent(duration) ? sanitizeInt(duration) : null, sanitizeStr(id)]
    );
    if (!result.rows.length) return sendError(res, 404, `Log "${id}" introuvable.`);
    console.log(`✏️ [LOGS] Mis à jour — ID: ${id} | Statut: "${status}"`);
    return sendSuccess(res, result.rows[0], 'Log mis à jour.');
  } catch (err) {
    return sendError(res, 500, 'Erreur mise à jour log.', err.message);
  }
});

app.get('/api/historique', async (req, res) => {
  const limit  = Math.min(sanitizeInt(req.query.limit, CONFIG.pagination.defaultLimit), CONFIG.pagination.maxLimit);
  const offset = sanitizeInt(req.query.offset, 0);
  try {
    const result = await safeQuery('SELECT * FROM downtime_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
    return res.json(result.rows);
  } catch (err) {
    console.error('❌ [HISTORIQUE] Erreur:', err.message);
    return res.status(500).json({ 
        success: false, 
        message: 'Erreur récupération historique.',
        detail: CONFIG.server.env !== 'production' ? err.message : undefined,
        data: [] 
    });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const [total, byStatus, avgDuration, topMachines, today, weekly] = await Promise.all([
      safeQuery('SELECT COUNT(*) AS count FROM downtime_logs'),
      safeQuery('SELECT status, COUNT(*) AS count FROM downtime_logs GROUP BY status ORDER BY count DESC'),
      safeQuery('SELECT ROUND(AVG(NULLIF(duration, \'\')::NUMERIC), 2) AS avg FROM downtime_logs'),
      safeQuery('SELECT machine, COUNT(*) AS pannes FROM downtime_logs GROUP BY machine ORDER BY pannes DESC LIMIT 5'),
      safeQuery('SELECT COUNT(*) AS count FROM downtime_logs WHERE DATE(created_at) = CURRENT_DATE'),
      safeQuery(`SELECT DATE(created_at) AS jour, COUNT(*) AS total FROM downtime_logs WHERE created_at >= NOW() - INTERVAL '7 days' GROUP BY DATE(created_at) ORDER BY jour ASC`),
    ]);

    const totalInterventions = parseInt(total.rows[0].count, 10) || 0;
    const mttrValue = parseFloat(avgDuration.rows[0].avg) || 0;

    return res.json({
      downtime: totalInterventions,
      mttr: `${mttrValue} min`,
      mtbf: '120h',
      availability: '98.5%',
      total: totalInterventions,
      today: parseInt(today.rows[0].count, 10) || 0,
      avgDuration: mttrValue,
      byStatus: byStatus.rows,
      topMachines: topMachines.rows,
      weekly: weekly.rows,
    });
  } catch (err) {
    console.error('❌ [STATS] Erreur:', err.message);
    return res.status(500).json({ 
        success: false, 
        message: err.message,
        downtime: 0, mttr: '0 min', mtbf: '0h', availability: '0%',
        total: 0, today: 0, avgDuration: 0,
        byStatus: [], topMachines: [], weekly: [],
    });
  }
});

app.get('/api/sessions', async (req, res) => {
  const limit = Math.min(sanitizeInt(req.query.limit, 200), CONFIG.pagination.maxLimit);
  try {
    const result = await safeQuery(
      `SELECT id AS log_id, machine AS name, alert_type AS type, status, duration, technician AS service, created_at AS date FROM downtime_logs ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    return sendError(res, 500, 'Erreur récupération sessions.', err.message);
  }
});

app.post('/api/intervention', async (req, res) => {
  const idPanne = req.body.idPanne || req.body.id;
  const criticite = req.body.criticiteRaw || req.body.criticite;
  const heureIntervention = req.body.heureIntervention || req.body.heure;
  const { observation } = req.body;

  if (!idPanne || !criticite || !heureIntervention || !observation) {
    return res.status(400).json({ success: false, message: '⚠️ Tous les champs sont obligatoires !' });
  }

  try {
    const result = await safeQuery(
      `UPDATE downtime_logs SET criticite = $1, heure_arret_technicien = $2, piece_observation = $3 WHERE id = $4`,
      [criticite, heureIntervention, observation, idPanne]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: '❌ Aucun enregistrement trouvé !' });
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('panne_mise_a_jour', { id: idPanne, criticite });
      io.emit('updateMachines', { id: idPanne, criticite, status: 'En panne' });
      console.log(`📢 Real-time event sent for machine ${idPanne}`);
    }
    return res.status(200).json({ success: true, message: "✅ Intervention enregistrée !" });
  } catch (err) {
    console.error('❌ [INTERVENTION] Erreur:', err);
    return res.status(500).json({ success: false, message: 'Erreur interne serveur.', detail: err.message });
  }
});

app.post('/api/machines/update-status', async (req, res) => {
  const { code, status, type_erreur } = req.body;
  if (!isPresent(code) || !isPresent(status)) {
    return sendError(res, 400, 'Les champs "code" et "status" sont obligatoires.');
  }

  try {
    await safeQuery(
      'UPDATE machines SET status = $1, type_erreur = $2 WHERE code = $3',
      [status, status.toLowerCase() === 'operational' ? null : (type_erreur || null), code]
    );

    console.log(`💾 [Machines] ${code} → status: "${status}"`);
    await maintenirQuotaDesPannes();

    return sendSuccess(res, null, 'Statut mis à jour dans PostgreSQL.');
  } catch (err) {
    return sendError(res, 500, 'Erreur mise à jour statut.', err.message);
  }
});


/* ═══════════════════════════════════════════════════════════════════
   10b. STATIC HTML PAGE ROUTES
═══════════════════════════════════════════════════════════════════ */
// Serve login.html
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Serve issam.html as the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'issam.html'));
});

// Serve dashboard.html
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Serve technicien.html
app.get('/technicien', (req, res) => {
    res.sendFile(path.join(__dirname, 'technicien.html'));
});

/* ═══════════════════════════════════════════════════════════════════
   11. ERROR HANDLERS
═══════════════════════════════════════════════════════════════════ */
app.use((req, res) => {
  console.warn(`⚠️ [404] ${req.method} ${req.originalUrl}`);
  return sendError(res, 404, `Route "${req.method} ${req.originalUrl}" introuvable.`);
});

app.use((err, req, res, _next) => {
  console.error('💥 [ERREUR GLOBALE] :', err.stack || err.message);
  return sendError(res, 500, 'Erreur interne inattendue.', err.message);
});

/* ═══════════════════════════════════════════════════════════════════
   12. START SERVER WITH RAILWAY CONFIG
═══════════════════════════════════════════════════════════════════ */
app.set('io', io);

io.on('connection', (socket) => {
  console.log(`🔌 [SOCKET] Client connecté — ID: ${socket.id}`);
  maintenirQuotaDesPannes();

  socket.on('disconnect', () => {
    console.log(`❌ [SOCKET] Client déconnecté — ID: ${socket.id}`);
  });
});

async function startServer() {
    await runMigrations();

    const tryPort = CONFIG.server.port;

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`❌ [PORT] Le port ${tryPort} est déjà utilisé !`);
            process.exit(1);
        } else {
            console.error('❌ [SERVER] Erreur:', err);
            process.exit(1);
        }
    });

    server.listen(tryPort, '0.0.0.0', () => {
      console.log('\n╔════════════════════════════════════════════╗');
      console.log('║  SMI Enterprise — API Server v2.4        ║');
      console.log('║  RAILWAY DEPLOYMENT                      ║');
      console.log('╠════════════════════════════════════════════╣');
      console.log(`║  ✅ Serveur démarré sur le port : ${tryPort}       ║`);
      console.log(`║  🌍 Environnement : ${CONFIG.server.env.padEnd(22)}║`);
      console.log(`║  🗄️  DB : ${(process.env.DATABASE_URL ? 'Railway PostgreSQL' : 'Local PostgreSQL').padEnd(26)}║`);
      console.log(`║  📊 DB Status : ${(dbHealthy ? '✅ Healthy' : '❌ Unhealthy').padEnd(20)}║`);
      console.log('╠════════════════════════════════════════════╣');
      console.log('║  📡 Endpoints disponibles :                ║');
      console.log('║    GET  /api/health                        ║');
      console.log('║    GET  /api/debug    ← Diagnostic DB      ║');
      console.log('║    POST /api/login                         ║');
      console.log('║    POST /api/logs                          ║');
      console.log('║    GET  /api/logs                          ║');
      console.log('║    GET  /api/logs/:id                      ║');
      console.log('║    PUT  /api/logs/:id                      ║');
      console.log('║    GET  /api/historique                    ║');
      console.log('║    GET  /api/stats                         ║');
      console.log('║    GET  /api/sessions                      ║');
      console.log('║    POST /api/intervention                  ║');
      console.log('║    POST /api/machines/update-status        ║');
      console.log('╚════════════════════════════════════════════╝\n');
    });
}

startServer().catch(err => {
    console.error('💥 [FATAL] Impossible de démarrer le serveur:', err);
    process.exit(1);
});

/* ═══════════════════════════════════════════════════════════════════
   13. GRACEFUL SHUTDOWN
═══════════════════════════════════════════════════════════════════ */
async function gracefulShutdown(signal) {
  console.log(`\n⚠️ [SERVEUR] Signal : ${signal}`);
  server.close(async () => {
    console.log('   → Serveur HTTP arrêté.');
    try {
      await pool.end();
      console.log('   → Pool PostgreSQL fermé.');
    } catch (err) {
      console.error('   → Erreur fermeture pool :', err.message);
    }
    console.log('✅ [SERVEUR] Arrêt complet.\n');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('❌ [SERVEUR] Timeout — Arrêt forcé.');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('💥 [CRITIQUE] Exception non capturée :', err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 [CRITIQUE] Promesse rejetée non gérée :', reason);
});
