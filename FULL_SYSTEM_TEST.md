# 🧪 TEST COMPLET DU SYSTÈME - Sans Wokwi

## ❌ Problème Wokwi
- MQTT externe (broker.hivemq.com) **PAS FIABLE** dans Wokwi
- Messages n'arrivent pas au backend Railway
- Dashboard ne se met pas à jour

---

## ✅ SOLUTION: Test Manuel du Backend

### 📋 Ce qu'on va tester:
1. ✅ Backend Railway (mqtt-bridge.js)
2. ✅ Base de données PostgreSQL
3. ✅ Dashboard (frontend)
4. ✅ Lifecycle 3 phases (DETECTED → ACKNOWLEDGED → RESOLVED)

---

## 🚀 ÉTAPE 1: Tester avec MQTT Explorer

### 1️⃣ Ouvrir MQTT Explorer
- Tu l'as déjà ouvert (je vois dans ton screenshot)
- Connecté à: `broker.hivemq.com:1883` ✅

### 2️⃣ Envoyer Message PHASE 1 (DOWNTIME Detected)

**Topic**: `factory/ligne1/andon/alert`

**Message** (JSON):
```json
{
  "machine_id": "KA01",
  "zone": "KA",
  "status": "DOWNTIME",
  "type": "Panne machine",
  "lifecycle_phase": "detected",
  "operator": "TEST_OPERATOR",
  "timestamp": 1721178000000,
  "uptime": "0d 00:01:00"
}
```

**Action**: Clique "PUBLISH" ▶️

**Résultat attendu**:
- ✅ Backend Railway reçoit le message
- ✅ INSERT dans `downtime_logs` table
- ✅ Dashboard affiche KA01 en ROUGE 🔴
- ✅ État: "DOWNTIME"

---

### 3️⃣ Envoyer Message PHASE 2 (MAINTENANCE Acknowledged)

**Attends 2-3 minutes** (pour simuler temps de réaction)

**Topic**: `factory/ligne1/andon/alert`

**Message** (JSON):
```json
{
  "machine_id": "KA01",
  "zone": "KA",
  "status": "MAINTENANCE",
  "type": "Maintenance requise",
  "lifecycle_phase": "acknowledged",
  "operator": "TECH_123",
  "timestamp": 1721178180000,
  "uptime": "0d 00:04:00"
}
```

**Action**: Clique "PUBLISH" ▶️

**Résultat attendu**:
- ✅ Backend UPDATE `downtime_logs` avec `heure_acknowledge`
- ✅ Dashboard affiche KA01 en BLEU 🔵
- ✅ État: "MAINTENANCE"
- ✅ Calcul MTTA (temps_reaction_minutes = 3 minutes)

---

### 4️⃣ Envoyer Message PHASE 3 (RESOLVED)

**Attends 2-3 minutes** (pour simuler temps de réparation)

**Topic**: `factory/ligne1/andon/alert`

**Message** (JSON):
```json
{
  "machine_id": "KA01",
  "zone": "KA",
  "status": "OPERATIONAL",
  "type": "Fonctionnement normal",
  "lifecycle_phase": "resolved",
  "operator": "TECH_123",
  "timestamp": 1721178360000,
  "uptime": "0d 00:07:00"
}
```

**Action**: Clique "PUBLISH" ▶️

**Résultat attendu**:
- ✅ Backend UPDATE `downtime_logs` avec `heure_fin`
- ✅ Dashboard affiche KA01 en VERT 🟢
- ✅ État: "OPERATIONAL"
- ✅ Calcul MTTR (temps_total_arret_minutes = 6 minutes)
- ✅ Calcul temps_reparation_minutes = 3 minutes

---

## 🗄️ ÉTAPE 2: Vérifier PostgreSQL

### Connexion à la base de données:

**Railway CLI** (si installé):
```bash
railway connect postgresql
```

**Ou via Railway Dashboard**:
1. Va sur railway.app
2. Ouvre ton projet
3. Clique sur PostgreSQL
4. Onglet "Data"

### Query SQL pour vérifier:

```sql
SELECT 
  id_log,
  machine_id,
  type_arret,
  lifecycle_phase,
  heure_debut,
  heure_acknowledge,
  heure_fin,
  temps_reaction_minutes,
  temps_reparation_minutes,
  temps_total_arret_minutes,
  technicien_id
FROM downtime_logs
WHERE machine_id = 'KA01'
ORDER BY heure_debut DESC
LIMIT 5;
```

### Résultat attendu:

| Colonne | Valeur attendue |
|---------|-----------------|
| `lifecycle_phase` | `"resolved"` |
| `heure_debut` | 2026-07-17 10:00:00 |
| `heure_acknowledge` | 2026-07-17 10:03:00 |
| `heure_fin` | 2026-07-17 10:06:00 |
| `temps_reaction_minutes` | 3 |
| `temps_reparation_minutes` | 3 |
| `temps_total_arret_minutes` | 6 |
| `technicien_id` | `"TECH_123"` |

---

## 🌐 ÉTAPE 3: Vérifier Dashboard

### URL du Dashboard:
```
https://[TON-APP-RAILWAY].up.railway.app/dashboard.html
```

### Ce qu'il faut voir:

**Avant test**:
- KA01: État VERT 🟢 "OPERATIONAL"

**Après PHASE 1** (DOWNTIME):
- KA01: État ROUGE 🔴 "DOWNTIME"
- Alerte apparaît dans l'historique

**Après PHASE 2** (ACKNOWLEDGED):
- KA01: État BLEU 🔵 "MAINTENANCE"
- MTTA calculé et affiché

**Après PHASE 3** (RESOLVED):
- KA01: État VERT 🟢 "OPERATIONAL"
- MTTR calculé et affiché
- Ligne complète dans l'historique

---

## 🐛 ÉTAPE 4: Déboguer si ça marche pas

### ❌ Problème: Dashboard ne se met pas à jour

**Vérifier**:
1. **Backend logs** (Railway Dashboard → mqtt-bridge service → Logs)
2. **Browser Console** (F12 dans le navigateur)
3. **Socket.IO connection** (devrait être connecté)

**Debug Backend**:
```bash
# Dans Railway logs, chercher:
"✅ MQTT message received"
"✅ Downtime log inserted"
"✅ Alert acknowledged"
"✅ Alert resolved"
```

---

### ❌ Problème: MQTT messages n'arrivent pas

**Vérifier MQTT Explorer**:
1. Topic exact: `factory/ligne1/andon/alert` (pas d'espace!)
2. JSON valide (use JSONLint.com pour valider)
3. Broker connecté: `broker.hivemq.com` port `1883`

**Debug MQTT Bridge**:
```javascript
// Dans mqtt-bridge.js, vérifier:
client.on('message', (topic, message) => {
  console.log('📨 Message received:', topic, message.toString());
  // ...
});
```

---

### ❌ Problème: PostgreSQL ne s'update pas

**Vérifier connexion DB**:
```sql
-- Test simple:
SELECT NOW();

-- Vérifier table existe:
SELECT * FROM downtime_logs LIMIT 1;

-- Vérifier colonnes:
\d downtime_logs
```

**Debug INSERT/UPDATE**:
```javascript
// Ajouter logs dans mqtt-bridge.js:
console.log('🔍 SQL Query:', query);
console.log('🔍 SQL Params:', params);
```

---

## 📊 Messages de Test Complets

### Test Cycle Complet (Copy-Paste Ready)

#### 1️⃣ DETECTED (t=0)
```json
{"machine_id":"KA01","zone":"KA","status":"DOWNTIME","type":"Panne machine","lifecycle_phase":"detected","operator":"OP_001","timestamp":1721178000000,"uptime":"0d 00:00:00"}
```

#### 2️⃣ ACKNOWLEDGED (t=5min)
```json
{"machine_id":"KA01","zone":"KA","status":"MAINTENANCE","type":"Maintenance requise","lifecycle_phase":"acknowledged","operator":"TECH_789","timestamp":1721178300000,"uptime":"0d 00:05:00"}
```

#### 3️⃣ RESOLVED (t=12min)
```json
{"machine_id":"KA01","zone":"KA","status":"OPERATIONAL","type":"Fonctionnement normal","lifecycle_phase":"resolved","operator":"TECH_789","timestamp":1721178720000,"uptime":"0d 00:12:00"}
```

**KPIs attendus**:
- MTTA = 5 minutes
- MTTR = 12 minutes
- Temps réparation = 7 minutes

---

## ✅ Checklist Complète

### Backend (Railway)
- [ ] Service `mqtt-bridge.js` running
- [ ] Logs montrent "MQTT connected"
- [ ] PostgreSQL connecté
- [ ] Socket.IO server running

### Database (PostgreSQL)
- [ ] Table `downtime_logs` existe
- [ ] Colonnes `lifecycle_phase`, `temps_reaction_minutes`, etc. existent
- [ ] Peut INSERT/UPDATE avec succès

### Frontend (Dashboard)
- [ ] Page accessible (pas 404)
- [ ] Socket.IO connecté (check browser console)
- [ ] Machines affichées
- [ ] Mises à jour en temps réel fonctionnent

### MQTT (HiveMQ)
- [ ] MQTT Explorer connecté à broker.hivemq.com
- [ ] Topic `factory/ligne1/andon/alert` existe
- [ ] Messages envoyés apparaissent dans "History"
- [ ] Backend reçoit les messages (check Railway logs)

---

## 🎯 Résultat Final Attendu

Après les 3 messages:

**Dashboard**:
```
┌─────────────────────────────────────┐
│ KA01: 🟢 OPERATIONAL               │
│ Dernière alerte: 10:06             │
│ MTTR: 12 min                        │
└─────────────────────────────────────┘

Historique:
┌──────────────────────────────────────────────────┐
│ 10:00 | KA01 | DOWNTIME | OP_001 | 12min        │
│       | MTTA: 5min | MTTR: 12min | ✅ RESOLVED │
└──────────────────────────────────────────────────┘
```

**PostgreSQL**:
```sql
lifecycle_phase = 'resolved'
temps_reaction_minutes = 5
temps_reparation_minutes = 7
temps_total_arret_minutes = 12
```

---

## 📝 Notes Importantes

1. **Timestamps**: Use `Date.now()` pour timestamp actuel
2. **Topic**: Doit être EXACTEMENT `factory/ligne1/andon/alert`
3. **JSON**: Doit être valide (use validator)
4. **Order**: DETECTED → ACKNOWLEDGED → RESOLVED (dans cet ordre!)

---

## 🔗 Liens Utiles

- **MQTT Explorer**: Déjà ouvert chez toi
- **Railway Dashboard**: https://railway.app/dashboard
- **JSONLint**: https://jsonlint.com/ (pour valider JSON)
- **Date.now()**: Console JS → `Date.now()` → Copy timestamp

---

**Date**: 2026-07-17  
**Version**: Test Manuel Backend  
**Status**: ✅ Ready for Testing
