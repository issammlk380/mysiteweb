import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import pg from 'npm:pg';

const { Pool } = pg;
const app = new Hono();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

app.options('*', (c) => c.text('', 204));

const pool = new Pool({
  connectionString: Deno.env.get('DATABASE_URL'),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

function sendError(c: any, status: number, msg: string, detail: any = null) {
  c.status(status);
  return c.json({ success: false, message: msg, detail });
}

function sendSuccess(c: any, data: any, msg = 'Opération réussie', status = 200) {
  c.status(status);
  return c.json({ success: true, message: msg, timestamp: new Date().toISOString(), data });
}

function isPresent(value: any) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function sanitizeStr(value: any, fallback = '') {
  if (!isPresent(value)) return fallback;
  return String(value).trim().slice(0, 500);
}

function sanitizeInt(value: any, fallback = 0) {
  const n = parseInt(value, 10);
  return isNaN(n) || n < 0 ? fallback : n;
}

// --- LOGIQUE DES HANDLERS ---
const handleHealth = async (c: any) => {
  try {
    await pool.query('SELECT 1');
    return sendSuccess(c, { server: 'En ligne', database: 'Connecté' });
  } catch (err: any) {
    return sendError(c, 503, 'DB inaccessible', err.message);
  }
};

const handleLogin = async (c: any) => {
  const body = await c.req.json();
  const { username, password } = body;
  if (!isPresent(username) || !isPresent(password)) return sendError(c, 400, 'Champs obligatoires.');
  if (username.trim() === 'admin' && password === 'admin123') return sendSuccess(c, { username: username.trim(), role: 'admin' }, 'Connexion réussie');
  return sendError(c, 401, 'Identifiants incorrects.');
};

const handlePostLogs = async (c: any) => {
  const body = await c.req.json();
  const machine = sanitizeStr(body.machine || body.machineID, 'Machine-01');
  const alert_type = sanitizeStr(body.alertType || body.alert_type, 'N/A');
  const start_time = sanitizeStr(body.startTime || body.start_time, new Date().toLocaleTimeString('fr-FR'));
  const duration = sanitizeInt(body.duration, 0);
  const technician = sanitizeStr(body.technician || body.technicianName, 'Opérateur');
  const status = sanitizeStr(body.status, 'En attente');
  try {
    const query = `INSERT INTO downtime_logs (machine, start_time, duration, technician, status) VALUES ($1, $2, $3, $4, $5) RETURNING log_id AS id;`;
    const result = await pool.query(query, [machine, start_time, duration.toString(), technician, status]);
    return sendSuccess(c, result.rows[0], 'Log inséré avec succès.', 201);
  } catch (err: any) {
    return sendError(c, 500, "Erreur interne", err.message);
  }
};

const handleGetLogs = async (c: any) => {
  const limit = Math.min(sanitizeInt(c.req.query('limit'), 100), 500);
  const offset = sanitizeInt(c.req.query('offset'), 0);
  try {
    const query = `SELECT * FROM downtime_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2;`;
    const result = await pool.query(query, [limit, offset]);
    return c.json(result.rows);
  } catch (err: any) {
    return c.json([], 500);
  }
};

const handleIntervention = async (c: any) => {
  const body = await c.req.json();
  const id = body.id || body.idPanne;
  const criticite = body.criticite || body.criticiteRaw;
  const heure = body.heure || body.heureIntervention;
  const observation = body.observation || body.piece_observation;

  if (!id || !criticite || !heure || !observation) {
    return c.json({ success: false, message: "⚠️ Champs obligatoires !" }, 400);
  }
  try {
    const query = `UPDATE downtime_logs SET criticite = $1, heure_arret_technicien = $2, piece_observation = $3 WHERE log_id = $4`;
    const result = await pool.query(query, [criticite, heure, observation, id]);
    if (result.rowCount === 0) {
      return c.json({ success: false, message: "❌ Aucun enregistrement trouvé avec cet ID !" }, 404);
    }
    return c.json({ success: true, message: "✅ L'intervention a été enregistrée avec succès !" });
  } catch (err: any) {
    return c.json({ success: false, message: "Erreur interne", detail: err.message }, 500);
  }
};

const handleStats = async (c: any) => {
  try {
    const total = await pool.query('SELECT COUNT(*) AS count FROM downtime_logs');
    return c.json({ downtime: parseInt(total.rows[0].count, 10) || 0 });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
};

// 🗺️ --- الروت الذكي والشامل دقة واحدة ---
// كيفما صيفط الفرونتند الرابط، السيرفر غايلقطو بـ هاد الفيلتر الحامي

app.post('*', async (c) => {
  const p = c.req.path.replace(/\/$/, '');
  if (p.endsWith('/login')) return handleLogin(c);
  if (p.endsWith('/logs')) return handlePostLogs(c);
  if (p.endsWith('/intervention')) return handleIntervention(c);
  return c.json({ success: false, message: `Route POST 404: ${c.req.path}` }, 404);
});

app.get('*', async (c) => {
  const p = c.req.path.replace(/\/$/, '');
  if (p.endsWith('/health')) return handleHealth(c);
  if (p.endsWith('/logs') || p.endsWith('/historique')) return handleGetLogs(c);
  if (p.endsWith('/stats')) return handleStats(c);
  return c.json({ success: false, message: `Route GET 404: ${c.req.path}` }, 404);
});
// --- ROUTES ---
app.post('/intervention', handleIntervention);

// 🆕 Nouvelle route pour fournir les données au Dashboard
app.get('/logs', async (c) => {
  try {
    // Récupération de toutes les interventions, triées par ordre décroissant (les plus récentes d'abord)
    const result = await pool.query('SELECT * FROM downtime_logs ORDER BY log_id DESC');
    return c.json({ success: true, data: result.rows });
  } catch (err: any) {
    return c.json({ 
        success: false, 
        message: "Erreur lors de la récupération des logs", 
        detail: err.message 
    }, 500);
  }
});

app.get('/health', (c) => c.json({ status: 'OK' }));

Deno.serve(app.fetch);