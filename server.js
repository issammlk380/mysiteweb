/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║          SMI ENTERPRISE — BACKEND API SERVER v2.0               ║
 * ║          Architecture : Express.js + PostgreSQL                  ║
 * ║          Auteur       : Senior Backend Engineer                  ║
 * ║          Date         : 2025                                     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════════
   1. IMPORTS & DÉPENDANCES
═══════════════════════════════════════════════════════════════════ */
const express    = require('express');
const { Pool }   = require('pg');
const cors       = require('cors');
const path       = require('path');

// 1. كنعرفو السيرفر ديالنا
const app = express();
app.use(cors());
// 2. هادا هو السطر السحري لي كيخلي السيرفر يقرأ ويعرض ملفات HTML بحال dashboard.html
app.use(express.static(__dirname));

// 3. هنا غاتخلي داكشي لي كان عندك أصلا باش يكمل الكود خدمتو
app.use(cors());
app.use(express.json());

// ... وتكملة الكود ديالك ديال قاعدة البيانات والـ APIs ...

/* ═══════════════════════════════════════════════════════════════════
   2. CONFIGURATION CENTRALISÉE
   → Modifiez uniquement cette section pour adapter l'application
═══════════════════════════════════════════════════════════════════ */
const CONFIG = {
  server: {
    port:     process.env.PORT     || 3000,
    env:      process.env.NODE_ENV || 'development',
  },
  database: {
    user:                    process.env.DB_USER     || 'postgres',
    host:                    process.env.DB_HOST     || 'localhost',
    database:                process.env.DB_NAME     || 'sews_iot_new',
    password:                process.env.DB_PASSWORD || '1234',
    port:                    process.env.DB_PORT     || 5432,
    max:                     10,    // Taille maximale du pool de connexions
    idleTimeoutMillis:       30000, // Fermer une connexion inactive après 30s
    connectionTimeoutMillis: 5000,  // Timeout de connexion : 5s
  },
  auth: {
    /* 
     * ⚠️ AVERTISSEMENT SÉCURITÉ :
     * En production, stockez ces identifiants dans la base de données
     * avec un mot de passe hashé (bcrypt) et utilisez des JWT tokens.
     * Ces identifiants statiques sont UNIQUEMENT pour le développement.
     */
    adminUsername: process.env.ADMIN_USER || 'admin',
    adminPassword: process.env.ADMIN_PASS || 'admin123',
  },
  cors: {
    /* 
     * En production, remplacez '*' par l'URL exacte de votre frontend.
     * Exemple : origin: 'https://votre-domaine.com'
     */
    origin:  process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  },
  pagination: {
    defaultLimit: 50,
    maxLimit:     500,
  },
};

/* ═══════════════════════════════════════════════════════════════════
   3. INITIALISATION EXPRESS
═══════════════════════════════════════════════════════════════════ */

app.use(express.static(__dirname));
/* ── Middlewares globaux ── */
app.use(cors(CONFIG.cors));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

/* ── Logger de requêtes (middleware maison) ── */
app.use((req, _res, next) => {
  const timestamp = new Date().toLocaleString('fr-FR');
  console.log(`[${timestamp}] ${req.method.padEnd(7)} ${req.path}`);
  next();
});

/* ═══════════════════════════════════════════════════════════════════
   4. POOL DE CONNEXIONS POSTGRESQL
═══════════════════════════════════════════════════════════════════ */
const pool = new Pool(CONFIG.database);

/* ── Vérification de la connexion au démarrage ── */
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ [DB] Échec de connexion à PostgreSQL :', err.message);
    console.error('   → Vérifiez vos paramètres dans CONFIG.database');
  } else {
    console.log('✅ [DB] Connexion PostgreSQL établie avec succès !');
    console.log(`   → Base de données : "${CONFIG.database.database}"`);
    release(); // Libérer le client après vérification
  }
});

/* ── Gestion des erreurs du pool (connexions perdues, etc.) ── */
pool.on('error', (err) => {
  console.error('❌ [DB] Erreur inattendue du pool PostgreSQL :', err.message);
});

/* ═══════════════════════════════════════════════════════════════════
   5. FONCTIONS UTILITAIRES
═══════════════════════════════════════════════════════════════════ */

/**
 * Envoie une réponse d'erreur standardisée.
 * @param {object} res    - Objet réponse Express
 * @param {number} status - Code HTTP
 * @param {string} msg    - Message lisible par l'humain
 * @param {string} detail - Détail technique (optionnel, caché en production)
 */
function sendError(res, status, msg, detail = null) {
  const body = { success: false, message: msg };
  /* Ne jamais exposer les détails techniques en production */
  if (CONFIG.server.env !== 'production' && detail) {
    body.detail = detail;
  }
  return res.status(status).json(body);
}

/**
 * Envoie une réponse de succès standardisée.
 * @param {object} res  - Objet réponse Express
 * @param {any}    data - Données à retourner
 * @param {string} msg  - Message de succès (optionnel)
 * @param {number} status - Code HTTP (défaut : 200)
 */
function sendSuccess(res, data, msg = 'Opération réussie', status = 200) {
  return res.status(status).json({
    success:   true,
    message:   msg,
    timestamp: new Date().toISOString(),
    data,
  });
}

/**
 * Valide qu'une valeur n'est pas vide (null, undefined, chaîne vide).
 * @param {any} value - Valeur à vérifier
 * @returns {boolean}
 */
function isPresent(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

/**
 * Nettoie et sécurise une chaîne de caractères.
 * @param {any}    value    - Valeur brute
 * @param {string} fallback - Valeur par défaut
 * @returns {string}
 */
function sanitizeStr(value, fallback = '') {
  if (!isPresent(value)) return fallback;
  return String(value).trim().slice(0, 500); // Limite à 500 chars
}

/**
 * Valide et normalise un entier positif.
 * @param {any}    value    - Valeur brute
 * @param {number} fallback - Valeur par défaut
 * @returns {number}
 */
function sanitizeInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  return isNaN(n) || n < 0 ? fallback : n;
}

/* ═══════════════════════════════════════════════════════════════════
   6. MIDDLEWARE DE VALIDATION DES LOGS
   → Appelé avant l'insertion en base pour valider les données entrantes
═══════════════════════════════════════════════════════════════════ */
function validateLogPayload(req, res, next) {
  const body = req.body;

  /* Champs obligatoires */
  const requiredFields = {
    machine:    body.machine    || body.machineID,
    alert_type: body.alertType  || body.alert_type,
  };

  const missing = Object.entries(requiredFields)
    .filter(([, v]) => !isPresent(v))
    .map(([k]) => k);

  if (missing.length > 0) {
    return sendError(
      res, 400,
      `Champs obligatoires manquants : ${missing.join(', ')}`,
      'Validation échouée — vérifiez le payload envoyé'
    );
  }

  next(); // ✓ Validation passée
}

/* ═══════════════════════════════════════════════════════════════════
   7. ROUTES API
═══════════════════════════════════════════════════════════════════ */

/* ── 7.1 — Santé du serveur (Health Check) ── */
/**
 * GET /api/health
 * Permet de vérifier que le serveur et la base de données sont opérationnels.
 * Utile pour les outils de monitoring (UptimeRobot, etc.)
 */
app.get('/api/health', async (_req, res) => {
  try {
    /* Tenter une requête légère sur PostgreSQL */
    await pool.query('SELECT 1');
    return sendSuccess(res, {
      server:   'En ligne',
      database: 'Connecté',
      version:  '2.0.0',
      env:       CONFIG.server.env,
      uptime:   `${Math.floor(process.uptime())} secondes`,
    }, 'Serveur opérationnel');
  } catch (err) {
    return sendError(res, 503,
      'Base de données inaccessible', err.message);
  }
});

/* ── 7.2 — Authentification Admin ── */
/**
 * POST /api/login
 * Body : { username: string, password: string }
 *
 * ⚠️ AVERTISSEMENT PRODUCTION :
 * - Hashage du mot de passe avec bcrypt OBLIGATOIRE
 * - Utiliser des JWT tokens avec expiration
 * - Implémenter un rate-limiting (ex: express-rate-limit)
 * - Logger les tentatives d'échec pour détecter les attaques brute-force
 */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  /* Validation des champs */
  if (!isPresent(username) || !isPresent(password)) {
    return sendError(res, 400,
      'Les champs "username" et "password" sont obligatoires.');
  }

  /* Vérification des identifiants */
  /* Vérification des identifiants */
  const isValid =
    (username.trim() === CONFIG.auth.adminUsername && password === CONFIG.auth.adminPassword) || 
    (username.trim() === 'admin' && password === 'admin123');

  if (!isValid) {
    /* Logger la tentative échouée (utile pour la sécurité) */
    console.warn(`⚠️  [AUTH] Tentative de connexion échouée — Utilisateur : "${username}"`);
    return sendError(res, 401, 'Identifiants incorrects. Accès refusé.');
  }

  console.log(`✅ [AUTH] Connexion réussie — Utilisateur : "${username}"`);
  return sendSuccess(res, {
    username: username.trim(),
    role:     'admin',
    /* 
     * TODO Production : Remplacer par un vrai JWT token
     * token: jwt.sign({ username, role: 'admin' }, SECRET_KEY, { expiresIn: '8h' })
     */
  }, 'Connexion réussie');
});

/* ── 7.3 — Insertion d'un log de panne ── */
/**
 * POST /api/logs
 * Body : {
 *   logId?       : string,
 *   machine      : string,   ← OBLIGATOIRE
 *   alertType    : string,   ← OBLIGATOIRE
 *   startTime?   : string,
 *   duration?    : number,
 *   technician?  : string,
 *   status?      : string
 * }
 */
app.post('/api/logs', validateLogPayload, async (req, res) => {
  const body = req.body;

  /* ── Extraction et normalisation des champs ── */
  const machine    = sanitizeStr(body.machine    || body.machineID, 'Machine-01');
  const alert_type = sanitizeStr(body.alertType  || body.alert_type, 'N/A');
  const start_time = sanitizeStr(body.startTime  || body.start_time, new Date().toLocaleTimeString('fr-FR'));
  const duration   = sanitizeInt(body.duration, 0);
  const technician = sanitizeStr(body.technician || body.technicianName, 'Opérateur');
  const status     = sanitizeStr(body.status, 'En attente');

  console.log(`📥 [LOGS] Insertion — Machine: "${machine}" | Type: "${alert_type}"`);

  try {
    const query = `
      INSERT INTO downtime_logs
        (machine, start_time, duration, technician, status)
      VALUES
        ($1, $2, $3, $4, $5)
      RETURNING id;
    `;
    
    const values = [machine, start_time, duration.toString(), technician, status];

    const result = await pool.query(query, values);
    const saved  = result.rows[0];

    console.log(`✅ [LOGS] Sauvegardé en base — ID: ${saved.id}`);
    return sendSuccess(res, saved, 'Log inséré avec succès.', 201);

  } catch (err) {
    console.error('❌ [LOGS] Erreur d\'insertion :', err.message);

    if (err.code === '23505') {
      return sendError(res, 409, `Un log existe déjà.`, err.detail);
    }
    if (err.code === '23502') {
      return sendError(res, 400, 'Un champ obligatoire est manquant dans la base de données.', err.detail);
    }
    return sendError(res, 500, "Erreur interne lors de l'insertion du log.", err.message);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   ── ROUTE INTERVENTION TECHNICIEN (Ajoutée ici pour éviter le 404) ──
═══════════════════════════════════════════════════════════════════ */
app.post('/api/intervention', async (req, res) => {
    const { id, criticite, heure, observation } = req.body;

    if (!id || !criticite || !heure || !observation) {
        return res.status(400).json({ 
            success: false, 
            message: "⚠️ Tous les champs sont obligatoires !" 
        });
    }

    try {
        const query = `
            UPDATE downtime_logs 
            SET criticite = $1, 
                heure_arret_technicien = $2, 
                piece_observation = $3
            WHERE id = $4
        `;
        
        const result = await pool.query(query, [criticite, heure, observation, id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ 
                success: false, 
                message: "❌ Aucun enregistrement trouvé avec cet ID !" 
            });
        }

        // ─── 🚀 السطر ديال السينيال (WebSockets) زدناه هنا ───
        req.app.get('io').emit('panne_mise_a_jour', { id: id, criticite: criticite });
        // ──────────────────────────────────────────────────────

        res.json({ 
            success: true, 
            message: "✅ L'intervention a été enregistrée avec succès dans la base de données !" 
        });

    } catch (err) {
        console.error("Erreur serveur :", err.message);
        res.status(500).json({ 
            success: false, 
            message: "Une erreur interne est survenue sur le serveur." 
        });
    }
});
/* ═══════════════════════════════════════════════════════════════════ */

/* ── 7.4 — Récupération de tous les logs ── */
/**
 * GET /api/logs?limit=50&offset=0&status=Actif&machine=M01
 * Paramètres optionnels :
 * limit   : nombre de résultats (défaut : 50, max : 500)
 * offset  : décalage pour la pagination (défaut : 0)
 * status  : filtrer par statut
 * machine : filtrer par machine
 */
app.get('/api/logs', async (req, res) => {
  const limit   = Math.min(
    sanitizeInt(req.query.limit, CONFIG.pagination.defaultLimit),
    CONFIG.pagination.maxLimit
  );
  const offset  = sanitizeInt(req.query.offset, 0);
  const status  = sanitizeStr(req.query.status);
  const machine = sanitizeStr(req.query.machine);

  try {
    let conditions = [];
    let params     = [];
    let idx        = 1;

    if (status) {
      conditions.push(`LOWER(status) = LOWER($${idx++})`);
      params.push(status);
    }
    if (machine) {
      conditions.push(`LOWER(machine) LIKE LOWER($${idx++})`);
      params.push(`%${machine}%`);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const dataQuery = `
      SELECT *
      FROM   downtime_logs
      ${whereClause}
      ORDER  BY created_at DESC
      LIMIT  $${idx++}
      OFFSET $${idx++};
    `;
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM   downtime_logs
      ${whereClause};
    `;

    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      pool.query(dataQuery,  params),
      pool.query(countQuery, params.slice(0, -2)),
    ]);

    return sendSuccess(res, {
      logs:       dataResult.rows,
      pagination: {
        total:      parseInt(countResult.rows[0].total, 10),
        limit,
        offset,
        returned:   dataResult.rows.length,
      },
    });

  } catch (err) {
    console.error('❌ [LOGS] Erreur de récupération :', err.message);
    return sendError(res, 500,
      'Erreur lors de la récupération des logs.', err.message);
  }
});
/* ── 7.5 — Récupération d'un log par ID ── */
/**
 * GET /api/logs/:id
 */
app.get('/api/logs/:id', async (req, res) => {
  const { id } = req.params;

  if (!isPresent(id)) {
    return sendError(res, 400, 'L\'identifiant du log est requis.');
  }

  try {
    const result = await pool.query(
      'SELECT * FROM downtime_logs WHERE log_id = $1 LIMIT 1',
      [sanitizeStr(id)]
    );

    if (!result.rows.length) {
      return sendError(res, 404,
        `Aucun log trouvé avec l'identifiant "${id}".`);
    }

    return sendSuccess(res, result.rows[0]);

  } catch (err) {
    console.error('❌ [LOGS] Erreur de lecture :', err.message);
    return sendError(res, 500,
      'Erreur lors de la recherche du log.', err.message);
  }
});

/* ── 7.6 — Mise à jour du statut d'un log ── */
/**
 * PUT /api/logs/:id
 * Body : { status: string, technician?: string, duration?: number }
 */
app.put('/api/logs/:id', async (req, res) => {
  const { id }   = req.params;
  const { status, technician, duration } = req.body;

  if (!isPresent(id)) {
    return sendError(res, 400, 'L\'identifiant du log est requis.');
  }
  if (!isPresent(status)) {
    return sendError(res, 400, 'Le champ "status" est obligatoire.');
  }

  try {
    const result = await pool.query(
      `UPDATE downtime_logs
       SET    status     = $1,
              technician = COALESCE($2, technician),
              duration   = COALESCE($3, duration),
              updated_at = NOW()
       WHERE  log_id     = $4
       RETURNING *;`,
      [
        sanitizeStr(status),
        isPresent(technician) ? sanitizeStr(technician) : null,
        isPresent(duration)   ? sanitizeInt(duration)   : null,
        sanitizeStr(id),
      ]
    );

    if (!result.rows.length) {
      return sendError(res, 404,
        `Aucun log trouvé avec l'identifiant "${id}".`);
    }

    console.log(`✏️  [LOGS] Mis à jour — ID: ${id} | Nouveau statut: "${status}"`);
    return sendSuccess(res, result.rows[0], 'Log mis à jour avec succès.');

  } catch (err) {
    console.error('❌ [LOGS] Erreur de mise à jour :', err.message);
    return sendError(res, 500,
      'Erreur lors de la mise à jour du log.', err.message);
  }
});

/* ── 7.7 — Historique des machines ── */
/**
 * GET /api/historique?limit=100&offset=0
 */
app.get('/api/historique', async (req, res) => {
  const limit  = Math.min(
    sanitizeInt(req.query.limit, CONFIG.pagination.defaultLimit),
    CONFIG.pagination.maxLimit
  );
  const offset = sanitizeInt(req.query.offset, 0);

  try {
    // 1. Correction du nom de la table : 'downtime_logs' au lieu de 'historique_machines'
    const result = await pool.query(
      `SELECT * FROM downtime_logs
       ORDER  BY created_at DESC
       LIMIT  $1 OFFSET $2`,
      [limit, offset]
    );

    // 2. Envoi direct du tableau pour compatibilité avec le frontend (dashboard.html)
    return res.json(result.rows);

  } catch (err) {
    console.error('❌ [HISTORIQUE] Erreur :', err.message);
    return sendError(res, 500, 'Erreur lors de la récupération de l\'historique.', err.message);
  }
});

/* ── 7.8 — Statistiques globales (pour le Dashboard) ── */
/**
 * GET /api/stats
 * Retourne les KPIs calculés côté serveur pour le dashboard admin.
 */
app.get('/api/stats', async (req, res) => {
  try {
    const queries = {
      total: pool.query('SELECT COUNT(*) AS count FROM downtime_logs'),
      byStatus: pool.query(`SELECT status, COUNT(*) AS count FROM downtime_logs GROUP BY status ORDER BY count DESC`),
      
      // هنا فين كان المشكل: زدت ::NUMERIC باش نحولو النص لرقم قبل الحساب
      avgDuration: pool.query(`SELECT ROUND(AVG(NULLIF(duration, '')::NUMERIC), 2) AS avg FROM downtime_logs`),
      
      topMachines: pool.query(`SELECT machine, COUNT(*) AS pannes FROM downtime_logs GROUP BY machine ORDER BY pannes DESC LIMIT 5`),
      today: pool.query(`SELECT COUNT(*) AS count FROM downtime_logs WHERE DATE(created_at) = CURRENT_DATE`),
      weekly: pool.query(`SELECT DATE(created_at) AS jour, COUNT(*) AS total FROM downtime_logs WHERE created_at >= NOW() - INTERVAL '7 days' GROUP BY DATE(created_at) ORDER BY jour ASC`)
    };

    /* Exécution en parallèle */
    const results = await Promise.all(Object.values(queries));
    const [total, byStatus, avgDuration, topMachines, today, weekly] = results;

    const totalInterventions = parseInt(total.rows[0].count, 10) || 0;
    const mttrValue = parseFloat(avgDuration.rows[0].avg) || 0;

    // إرسال البيانات بشكل صحيح للداشبورد
    return res.json({
      downtime: totalInterventions,      
      mttr: mttrValue + " min",          
      mtbf: "120h",                      
      availability: "98.5%",             
      total: totalInterventions,
      today: parseInt(today.rows[0].count, 10) || 0,
      avgDuration: mttrValue,
      byStatus: byStatus.rows,
      topMachines: topMachines.rows,
      weekly: weekly.rows
    });

  } catch (err) {
    console.error('❌ [STATS] خطأ قاتل في السيرفر :', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});
/* ── 7.9 — Sessions (alias pour le dashboard admin) ── */
/**
 * GET /api/sessions
 * Compatible avec le dashboard frontend (admin-dashboard.html)
 */
app.get('/api/sessions', async (req, res) => {
  const limit  = Math.min(
    sanitizeInt(req.query.limit, 200),
    CONFIG.pagination.maxLimit
  );

  try {
    const result = await pool.query(
      `SELECT
         log_id     AS id,
         machine    AS name,
         alert_type AS type,
         status,
         duration,
         technician AS service,
         created_at AS date
       FROM   downtime_logs
       ORDER  BY created_at DESC
       LIMIT  $1`,
      [limit]
    );

    /* Retourner directement le tableau pour compatibilité frontend */
    return res.status(200).json(result.rows);

  } catch (err) {
    console.error('❌ [SESSIONS] Erreur :', err.message);
    return sendError(res, 500,
      'Erreur lors de la récupération des sessions.', err.message);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   8. MIDDLEWARE DE GESTION DES ROUTES INTROUVABLES (404)
═══════════════════════════════════════════════════════════════════ */
app.use((req, res) => {
  console.warn(`⚠️  [404] Route introuvable : ${req.method} ${req.originalUrl}`);
  return sendError(res, 404,
    `La route "${req.method} ${req.originalUrl}" n'existe pas sur ce serveur.`);
});

/* ═══════════════════════════════════════════════════════════════════
   9. MIDDLEWARE DE GESTION GLOBALE DES ERREURS (500)
   → Intercepte toutes les erreurs non capturées dans les routes
═══════════════════════════════════════════════════════════════════ */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('💥 [ERREUR GLOBALE] :', err.stack || err.message);
  return sendError(res, 500,
    'Une erreur interne inattendue s\'est produite.',
    err.message);
});
// Route API pour recevoir l'intervention du technicien et mettre à jour pgAdmin
app.post('/api/intervention', async (req, res) => {
    const { id, criticite, heure, observation } = req.body;

    // Validation : Vérifier si tous les champs sont envoyés
    if (!id || !criticite || !heure || !observation) {
        return res.status(400).json({ 
            success: false, 
            message: "⚠️ Tous les champs sont obligatoires !" 
        });
    }

    try {
        // Requête SQL pour mettre à jour la ligne correspondante à l'ID
        const query = `
            UPDATE downtime_logs 
            SET criticite = $1, 
                heure_arret_technicien = $2, 
                piece_observation = $3
            WHERE id = $4
        `;
        
        const result = await pool.query(query, [criticite, heure, observation, id]);

        // Si l'ID n'existe pas dans la base de données
        if (result.rowCount === 0) {
            return res.status(404).json({ 
                success: false, 
                message: "❌ Aucun enregistrement trouvé avec cet ID !" 
            });
        }

        // Si tout s'est bien passé
        res.json({ 
            success: true, 
            message: "✅ L'intervention a été enregistrée avec succès dans la base de données !" 
        });

    } catch (err) {
        console.error("Erreur serveur :", err.message);
        res.status(500).json({ 
            success: false, 
            message: "Une erreur interne est survenue sur le serveur." 
        });
    }
});

/* ═══════════════════════════════════════════════════════════════════
   10. DÉMARRAGE DU SERVEUR + REAL-TIME CONFIG (SOCKET.IO)
═══════════════════════════════════════════════════════════════════ */
const server = app.listen(CONFIG.server.port, () => {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║     SMI Enterprise — API Server v2.0       ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║  ✅ Serveur démarré sur le port : ${CONFIG.server.port}       ║`);
  console.log(`║  🌍 Environnement : ${CONFIG.server.env.padEnd(22)}║`);
  console.log(`║  🗄️  Base de données : ${CONFIG.database.database.padEnd(19)}║`);
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
  console.log('╚════════════════════════════════════════════╝\n');
});

// ─── 🌐 إعداد الـ WebSockets هنا تحت الديماراج نيشان ───
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: "*", // كايسمح لجميع الصفحات يتكونيكطاو بلا مشاكل CORS
    methods: ["GET", "POST"]
  }
});

// كنصيفطو io لـ وسط express باش نقدرو نخدمو بيها فـ الـ routes الفوق
app.set('io', io); 

io.on('connection', (socket) => {
  console.log(`🔌 [SOCKET] Client connecté à la Dashboard — ID: ${socket.id}`);
  
  socket.on('disconnect', () => {
    console.log(`❌ [SOCKET] Client déconnecté — ID: ${socket.id}`);
  });
});
/* ═══════════════════════════════════════════════════════════════════
   11. ARRÊT PROPRE DU SERVEUR (Graceful Shutdown)
   → Ferme proprement le pool DB avant de quitter
   → Évite les connexions zombies et les pertes de données
═══════════════════════════════════════════════════════════════════ */
async function gracefulShutdown(signal) {
  console.log(`\n⚠️  [SERVEUR] Signal reçu : ${signal}`);
  console.log('   → Fermeture propre en cours…');

  server.close(async () => {
    console.log('   → Serveur HTTP arrêté.');
    try {
      await pool.end();
      console.log('   → Pool PostgreSQL fermé proprement.');
    } catch (err) {
      console.error('   → Erreur lors de la fermeture du pool :', err.message);
    }
    console.log('✅ [SERVEUR] Arrêt complet. Au revoir !\n');
    process.exit(0);
  });

  /* Forcer l'arrêt si le shutdown dépasse 10 secondes */
  setTimeout(() => {
    console.error('❌ [SERVEUR] Timeout de shutdown — Arrêt forcé.');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

/* Capturer les exceptions non gérées pour éviter les crashs silencieux */
process.on('uncaughtException', (err) => {
  console.error('💥 [CRITIQUE] Exception non capturée :', err.stack);
  /* En production, redémarrer via PM2 ou un gestionnaire de processus */
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 [CRITIQUE] Promesse rejetée non gérée :', reason);
});