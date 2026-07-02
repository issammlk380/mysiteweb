/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║          SMI ENTERPRISE — BACKEND API SERVER v2.1               ║
 * ║          Railway Ready — Express.js + PostgreSQL + Socket.io     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════════
   1. IMPORTS & DÉPENDANCES
═══════════════════════════════════════════════════════════════════ */
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const { Pool }   = require('pg');
const cors       = require('cors');

const app = express();

/* ═══════════════════════════════════════════════════════════════════
   2. CONFIGURATION — Railway + Local
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
   3. CORS — Railway + Ngrok compatible
═══════════════════════════════════════════════════════════════════ */
const ALLOWED_ORIGIN = process.env.RAILWAY_STATIC_URL || '*';

app.use(cors({
    origin: ALLOWED_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'ngrok-skip-browser-warning'
    ],
    credentials: true
}));

// Safety net manual headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, ngrok-skip-browser-warning');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

const server = http.createServer(app);

/* ═══════════════════════════════════════════════════════════════════
   4. POSTGRESQL — Railway DATABASE_URL or local fallback
═══════════════════════════════════════════════════════════════════ */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1234@localhost:5432/sews_iot_new',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

/* ═══════════════════════════════════════════════════════════════════
   5. SOCKET.IO
═══════════════════════════════════════════════════════════════════ */
const io = new Server(server, {
    transports: ['polling', 'websocket'],
    cors: {
        origin: ALLOWED_ORIGIN,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["ngrok-skip-browser-warning", "Content-Type", "Accept"],
        credentials: true
    },
    allowEIO3: true
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

/* ── Logger ── */
app.use((req, _res, next) => {
  const timestamp = new Date().toLocaleString('fr-FR');
  console.log(`[${timestamp}] ${req.method.padEnd(7)} ${req.path}`);
  next();
});

/* ── DB Connection Check ── */
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ [DB] Échec connexion PostgreSQL :', err.message);
  } else {
    console.log('✅ [DB] Connexion PostgreSQL établie !');
    console.log(`   → DATABASE_URL: ${process.env.DATABASE_URL ? 'Railway' : 'Local'}`);
    release();
  }
});

pool.on('error', (err) => {
  console.error('❌ [DB] Erreur pool PostgreSQL :', err.message);
});

/* ═══════════════════════════════════════════════════════════════════
   6. UTILITAIRES
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

/* ═══════════════════════════════════════════════════════════════════
   7. VALIDATION
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
   8. SIMULATION MACHINES
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
    const cibleAleatoire = Math.floor(Math.random() * (15 - 5 + 1)) + 5;
    const machinesMelangees = [...LISTE_MACHINES_SMI].sort(() => 0.5 - Math.random());
    const selectionMachinesEnPanne = machinesMelangees.slice(0, cibleAleatoire);

    const typesErreurs = ['Material', 'Mechanical', 'Electrical', 'Sensor', 'Software'];

    let listeFinaleDesPannes = selectionMachinesEnPanne.map(code => ({
      code: code,
      status: 'en panne',
      type_erreur: typesErreurs[Math.floor(Math.random() * typesErreurs.length)]
    }));

    const pannesReelles = await pool.query(
      "SELECT machine AS code, 'en panne' AS status, piece_observation AS type_erreur FROM downtime_logs WHERE status IN ('Pending', 'Escalated') OR heure_arret_technicien IS NULL OR heure_arret_technicien = '[null]'"
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

setInterval(maintenirQuotaDesPannes, 4000);

/* ═══════════════════════════════════════════════════════════════════
   9. ROUTES API
═══════════════════════════════════════════════════════════════════ */

/* 9.1 — Health */
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return sendSuccess(res, {
      server: 'En ligne',
      database: 'Connecté',
      version: '2.1.0',
      env: CONFIG.server.env,
      uptime: `${Math.floor(process.uptime())} secondes`,
    }, 'Serveur opérationnel');
  } catch (err) {
    return sendError(res, 503, 'Base de données inaccessible', err.message);
  }
});

/* 9.2 — Login */
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

/* 9.3 — Insert Log */
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
        const result = await pool.query(
            `INSERT INTO downtime_logs 
            (machine, start_time, duration, technician, status, criticite, alert_type, heure_arret_technicien, piece_observation) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
            RETURNING id;`, 
            [machine, start_time, duration.toString(), technician, status, criticite, alert_type, heure_arret_technicien, piece_observation]
        );
        return sendSuccess(res, result.rows[0], 'Log inséré avec succès.', 201);
    } catch (err) {
        console.error('[LOGS] Erreur insertion :', err.message);
        return sendError(res, 500, "Erreur interne lors de l'insertion.", err.message);
    }
});

/* 9.4 — Get All Logs */
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
      pool.query(dataQuery, params),
      pool.query(countQuery, params.slice(0, -2)),
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

/* 9.5 — Get Log by ID */
app.get('/api/logs/:id', async (req, res) => {
  const { id } = req.params;
  if (!isPresent(id)) return sendError(res, 400, 'ID requis.');
  try {
    const result = await pool.query('SELECT * FROM downtime_logs WHERE log_id = $1 LIMIT 1', [sanitizeStr(id)]);
    if (!result.rows.length) return sendError(res, 404, `Log "${id}" introuvable.`);
    return sendSuccess(res, result.rows[0]);
  } catch (err) {
    return sendError(res, 500, 'Erreur recherche log.', err.message);
  }
});

/* 9.6 — Update Log */
app.put('/api/logs/:id', async (req, res) => {
  const { id } = req.params;
  const { status, technician, duration } = req.body;
  if (!isPresent(id)) return sendError(res, 400, 'ID requis.');
  if (!isPresent(status)) return sendError(res, 400, 'Champ "status" obligatoire.');

  try {
    const result = await pool.query(
      `UPDATE downtime_logs SET status = $1, technician = COALESCE($2, technician), duration = COALESCE($3, duration), updated_at = NOW() WHERE log_id = $4 RETURNING *;`,
      [sanitizeStr(status), isPresent(technician) ? sanitizeStr(technician) : null, isPresent(duration) ? sanitizeInt(duration) : null, sanitizeStr(id)]
    );
    if (!result.rows.length) return sendError(res, 404, `Log "${id}" introuvable.`);
    console.log(`✏️ [LOGS] Mis à jour — ID: ${id} | Statut: "${status}"`);
    return sendSuccess(res, result.rows[0], 'Log mis à jour.');
  } catch (err) {
    return sendError(res, 500, 'Erreur mise à jour log.', err.message);
  }
});

/* 9.7 — Historique */
app.get('/api/historique', async (req, res) => {
  const limit  = Math.min(sanitizeInt(req.query.limit, CONFIG.pagination.defaultLimit), CONFIG.pagination.maxLimit);
  const offset = sanitizeInt(req.query.offset, 0);
  try {
    const result = await pool.query('SELECT * FROM downtime_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
    return res.json(result.rows);
  } catch (err) {
    return sendError(res, 500, 'Erreur récupération historique.', err.message);
  }
});

/* 9.8 — Stats */
app.get('/api/stats', async (req, res) => {
  try {
    const [total, byStatus, avgDuration, topMachines, today, weekly] = await Promise.all([
      pool.query('SELECT COUNT(*) AS count FROM downtime_logs'),
      pool.query('SELECT status, COUNT(*) AS count FROM downtime_logs GROUP BY status ORDER BY count DESC'),
      pool.query('SELECT ROUND(AVG(NULLIF(duration, \'\')::NUMERIC), 2) AS avg FROM downtime_logs'),
      pool.query('SELECT machine, COUNT(*) AS pannes FROM downtime_logs GROUP BY machine ORDER BY pannes DESC LIMIT 5'),
      pool.query('SELECT COUNT(*) AS count FROM downtime_logs WHERE DATE(created_at) = CURRENT_DATE'),
      pool.query(`SELECT DATE(created_at) AS jour, COUNT(*) AS total FROM downtime_logs WHERE created_at >= NOW() - INTERVAL '7 days' GROUP BY DATE(created_at) ORDER BY jour ASC`),
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
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* 9.9 — Sessions */
app.get('/api/sessions', async (req, res) => {
  const limit = Math.min(sanitizeInt(req.query.limit, 200), CONFIG.pagination.maxLimit);
  try {
    const result = await pool.query(
      `SELECT log_id AS id, machine AS name, alert_type AS type, status, duration, technician AS service, created_at AS date FROM downtime_logs ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    return sendError(res, 500, 'Erreur récupération sessions.', err.message);
  }
});

/* 9.10 — Intervention */
app.post('/api/intervention', async (req, res) => {
  const idPanne = req.body.idPanne || req.body.id;
  const criticite = req.body.criticiteRaw || req.body.criticite;
  const heureIntervention = req.body.heureIntervention || req.body.heure;
  const { observation } = req.body;

  if (!idPanne || !criticite || !heureIntervention || !observation) {
    return res.status(400).json({ success: false, message: '⚠️ Tous les champs sont obligatoires !' });
  }

  try {
    const result = await pool.query(
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
    return res.status(500).json({ success: false, message: 'Erreur interne serveur.' });
  }
});

/* 9.11 — Update Machine Status */
app.post('/api/machines/update-status', async (req, res) => {
  const { code, status, type_erreur } = req.body;
  if (!isPresent(code) || !isPresent(status)) {
    return sendError(res, 400, 'Les champs "code" et "status" sont obligatoires.');
  }

  try {
    await pool.query(
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
   10. 404 & ERROR HANDLERS
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
   11. DÉMARRAGE SERVEUR + SOCKET.IO
═══════════════════════════════════════════════════════════════════ */
app.set('io', io);

io.on('connection', (socket) => {
  console.log(`🔌 [SOCKET] Client connecté — ID: ${socket.id}`);
  maintenirQuotaDesPannes();

  socket.on('disconnect', () => {
    console.log(`❌ [SOCKET] Client déconnecté — ID: ${socket.id}`);
  });
});

server.listen(CONFIG.server.port, '0.0.0.0', () => {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║     SMI Enterprise — API Server v2.1       ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║  ✅ Serveur démarré sur le port : ${CONFIG.server.port}       ║`);
  console.log(`║  🌍 Environnement : ${CONFIG.server.env.padEnd(22)}║`);
  console.log(`║  🗄️  DB : ${(process.env.DATABASE_URL ? 'Railway Cloud' : 'Local PostgreSQL').padEnd(26)}║`);
  console.log('╠════════════════════════════════════════════╣');
  console.log('║  📡 Endpoints disponibles :                ║');
  console.log('║    GET  /api/health                        ║');
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

/* ═══════════════════════════════════════════════════════════════════
   12. GRACEFUL SHUTDOWN
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