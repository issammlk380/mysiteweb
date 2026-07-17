# 🚀 Guide de déploiement - Système Andon Complet

## ✅ Résumé des changements

### 1. Nouveau module: `data-generator.js`
- Génère automatiquement données réalistes pour machines simulées (KB, KC, KD...)
- **NE TOUCHE JAMAIS à KA01** (machine réelle Wokwi)
- Maintient 5-20 machines non-opérationnelles en permanence
- Remplit automatiquement les valeurs NULL
- Cycle de mise à jour: 5 minutes

### 2. Modifications `server.js`
- Intégration Data Generator au démarrage
- Nouveaux endpoints API:
  - `GET /api/factory/status` - État de l'usine
  - `POST /api/data-generator/trigger` - Forcer génération
  - `POST /api/data-generator/fill-nulls` - Remplir NULL
- Cleanup automatique des NULL 10 secondes après démarrage
- Graceful shutdown pour Data Generator

### 3. `mqtt-bridge.js` (déjà existant)
- Cycle de vie 3 phases: detected → acknowledged → resolved
- Gestion MTTA, MTTR, temps de réparation
- Protection contre états dupliqués

---

## 📋 Checklist avant déploiement

### Fichiers à vérifier:
- ✅ `data-generator.js` - NOUVEAU fichier
- ✅ `server.js` - Modifié (Data Generator intégré)
- ✅ `mqtt-bridge.js` - Déjà existant (lifecycle 3 phases)
- ✅ `andon-simple.ino` - Code ESP32 avec lifecycle
- ✅ `package.json` - Déjà à jour

### Base de données PostgreSQL:
- ✅ Table `downtime_logs` avec toutes les colonnes lifecycle
- ✅ Table `machines` pour état actuel
- ✅ Table `technicians` avec RFID UIDs
- ✅ Table `breakdown_categories`
- ✅ Table `kpi_summary`

---

## 🚂 Déploiement sur Railway

### Option 1: Git Push (Recommandé)

```bash
# 1. Vérifier les fichiers modifiés
git status

# 2. Ajouter les nouveaux fichiers
git add data-generator.js
git add DATA_GENERATOR_README.md
git add DEPLOYMENT_GUIDE.md

# 3. Commit
git commit -m "feat: Add realistic data generator for simulated machines

- Generate 5-20 non-operational machines automatically
- Fill NULL values with realistic data
- Maintain lifecycle phases (detected -> acknowledged -> resolved)
- Calculate MTTR, MTTA, repair times automatically
- Protect KA01 (real Wokwi machine) from simulation
- Update every 5 minutes with dynamic factory status"

# 4. Push to Railway
git push origin main
```

### Option 2: Railway CLI

```bash
# 1. Installer Railway CLI (si pas déjà fait)
npm install -g @railway/cli

# 2. Login
railway login

# 3. Link projet
railway link

# 4. Deploy
railway up
```

---

## 🔍 Vérification après déploiement

### 1. Vérifier les logs Railway

Chercher ces messages dans les logs:

```
✅ MQTT Bridge initialisé avec succès
✅ Data Generator initialisé avec succès

═══════════════════════════════════════════════════════════════
  🏭 DATA GENERATOR INITIALIZED
═══════════════════════════════════════════════════════════════
  Machines: 45 (excluding KA01)
  Target non-operational: 5-20
  Update interval: 5 minutes
═══════════════════════════════════════════════════════════════

[DATA-GEN] Starting NULL value cleanup...
[DATA-GEN] 🔧 Filling NULL values in existing records...
[DATA-GEN] Found X records with NULL values
[DATA-GEN] ✅ Filled NULL values in X records

[DATA-GEN] 🏭 Factory Status: X non-operational machines
[DATA-GEN] Target range: 5 - 20
```

### 2. Tester les endpoints

```bash
# Remplacer <your-railway-url> par votre URL Railway
export API_URL=https://<your-railway-url>.up.railway.app

# Test 1: Santé du serveur
curl $API_URL/api/health

# Test 2: État de l'usine
curl $API_URL/api/factory/status

# Test 3: KPI
curl $API_URL/api/stats

# Test 4: Logs actifs
curl "$API_URL/api/logs?limit=10"
```

### 3. Vérifier le Dashboard

1. Ouvrir: `https://<your-railway-url>.up.railway.app/`
2. **Attendre 30 secondes** pour que Data Generator fasse sa première génération
3. Vérifier:
   - ✅ 5-20 machines affichées en état non-opérationnel
   - ✅ KPI affichés (MTTR, MTTA != "N/A")
   - ✅ Availability != "0%"
   - ✅ Machines changent d'état automatiquement

### 4. Tester KA01 (Wokwi)

1. Ouvrir Wokwi avec `andon-simple.ino`
2. Cliquer sur bouton DOWNTIME (rouge)
3. Vérifier Dashboard: KA01 passe en rouge
4. Cliquer sur bouton MAINTENANCE (bleu)
5. Vérifier Dashboard: KA01 passe en bleu
6. Cliquer sur bouton RESOLVE (vert)
7. Vérifier Dashboard: KA01 passe en vert

---

## 🗄️ Vérification PostgreSQL

### Connexion pgAdmin

```
Host: <railway-postgres-host>
Port: <railway-postgres-port>
Database: railway
User: postgres
Password: <railway-postgres-password>
```

### Requêtes de vérification

#### 1. Compter machines non-opérationnelles
```sql
SELECT COUNT(DISTINCT machine) as non_operational
FROM downtime_logs
WHERE status NOT IN ('Termine', 'Resolved', 'Completed')
  AND status IS NOT NULL
  AND date_panne >= NOW() - INTERVAL '24 hours';
```

**Résultat attendu:** Entre 5 et 20

#### 2. Vérifier valeurs NULL
```sql
SELECT 
  COUNT(*) FILTER (WHERE operator IS NULL) as null_operator,
  COUNT(*) FILTER (WHERE technician IS NULL) as null_technician,
  COUNT(*) FILTER (WHERE atelier IS NULL) as null_atelier,
  COUNT(*) FILTER (WHERE breakdown_category IS NULL) as null_category,
  COUNT(*) FILTER (WHERE temps_reaction_minutes IS NULL) as null_reaction,
  COUNT(*) FILTER (WHERE temps_reparation_minutes IS NULL) as null_repair,
  COUNT(*) FILTER (WHERE temps_total_arret_minutes IS NULL) as null_total
FROM downtime_logs
WHERE machine != 'KA01';
```

**Résultat attendu:** Tous à 0 (ou très faible)

#### 3. Vérifier KPI
```sql
SELECT 
  COALESCE(ROUND(AVG(temps_total_arret_minutes), 2), 0) AS mttr_minutes,
  COALESCE(ROUND(AVG(temps_reaction_minutes), 2), 0) AS mtta_minutes,
  COALESCE(ROUND(AVG(temps_reparation_minutes), 2), 0) AS repair_minutes,
  COUNT(*) FILTER (WHERE status IN ('Resolved', 'Termine')) AS resolved_count
FROM downtime_logs 
WHERE date_panne >= NOW() - INTERVAL '30 days';
```

**Résultat attendu:** 
- `mttr_minutes` > 0
- `mtta_minutes` > 0
- `repair_minutes` > 0
- `resolved_count` > 0

#### 4. Vérifier données réalistes
```sql
SELECT 
  machine,
  atelier,
  operator,
  technician,
  alert_type,
  criticite,
  breakdown_category,
  root_cause,
  actions_taken,
  date_panne,
  date_arrivee_technicien,
  date_reparation,
  temps_reaction_minutes,
  temps_reparation_minutes,
  temps_total_arret_minutes,
  lifecycle_phase
FROM downtime_logs
WHERE machine != 'KA01'
ORDER BY date_panne DESC
LIMIT 5;
```

**Vérifier:**
- ✅ Aucune valeur NULL (sauf rfid_uid, spare_parts_used, piece_observation)
- ✅ `date_arrivee_technicien` > `date_panne`
- ✅ `date_reparation` > `date_arrivee_technicien`
- ✅ `temps_total_arret_minutes` = somme des autres temps
- ✅ Opérateurs format: `Op_XXXX`
- ✅ Techniciens: noms réalistes
- ✅ Ateliers: A, B, C, D, X

---

## 🐛 Troubleshooting

### Problème 1: Data Generator ne génère pas de données

**Symptôme:** Aucun log `[DATA-GEN]` dans Railway

**Solutions:**
1. Vérifier logs Railway pour erreurs d'initialisation
2. Vérifier connexion PostgreSQL
3. Relancer: `POST /api/data-generator/trigger`

### Problème 2: KPI affichent "N/A"

**Symptôme:** Dashboard montre MTTR = "N/A"

**Solutions:**
1. Attendre 5-10 minutes que Data Generator génère des données
2. Forcer: `POST /api/data-generator/trigger`
3. Vérifier SQL: `temps_reaction_minutes`, `temps_reparation_minutes` non NULL

### Problème 3: Trop de machines en panne

**Symptôme:** Plus de 20 machines non-opérationnelles

**Solutions:**
- Le Data Generator va automatiquement résoudre l'excès dans les 5 prochaines minutes
- Forcer immédiatement: `POST /api/data-generator/trigger`

### Problème 4: KA01 affectée par simulation

**Symptôme:** KA01 change d'état sans interaction Wokwi

**Solutions:**
1. Vérifier logs: chercher `KA01` dans `[DATA-GEN]`
2. Vérifier code: toutes requêtes doivent avoir `WHERE machine != 'KA01'`
3. Vérifier MQTT: KA01 doit venir uniquement de `mqtt-bridge.js`

---

## 📊 Métriques de succès

### Pour la démo PFE

✅ **Dashboard:**
- 5-20 machines en état non-opérationnel
- KPI affichés correctement (MTTR, MTTA, Availability)
- Machines changent d'état automatiquement (toutes les 5 min)
- KA01 fonctionne indépendamment avec Wokwi

✅ **Base de données:**
- Moins de 5% valeurs NULL (hors colonnes optionnelles)
- Timestamps cohérents
- Données réalistes (noms, durées, types)

✅ **Performance:**
- Data Generator s'exécute sans erreur
- Mises à jour temps réel via Socket.IO
- API répond < 500ms

---

## 📝 Notes importantes

### KA01 Protection

Toutes les fonctions Data Generator ont cette protection:

```sql
WHERE machine != 'KA01'
```

Cela garantit:
- ✅ KA01 données proviennent UNIQUEMENT de Wokwi
- ✅ Aucune simulation n'affecte KA01
- ✅ Tests Wokwi restent fiables

### Intervalle de génération

Par défaut: **5 minutes**

Pour changer (dans `data-generator.js`):
```javascript
updateInterval = setInterval(() => balanceFactory(), 2 * 60 * 1000); // 2 minutes
```

### Nombre de machines simulées

Par défaut: **45 machines** (KA02-KA10, KB01-KB10, KC01-KC10, KD01-KD10, KX01-KX05)

Pour ajouter/supprimer (dans `data-generator.js`):
```javascript
const ALL_MACHINES = [
  // Ajouter ici...
  'KE01', 'KE02', 'KE03'
];
```

---

## ✅ Checklist finale déploiement

- [ ] Code poussé sur Git
- [ ] Railway déploiement réussi
- [ ] Logs montrent Data Generator initialisé
- [ ] `/api/factory/status` retourne 5-20 machines
- [ ] `/api/stats` affiche KPI (MTTR != "N/A")
- [ ] Dashboard affiche machines en temps réel
- [ ] KA01 fonctionne avec Wokwi
- [ ] PostgreSQL: valeurs NULL < 5%
- [ ] Socket.IO événements en temps réel
- [ ] Aucune erreur dans logs Railway

---

## 🎓 Message pour jury PFE

> "Ce système Andon industriel connecte une machine réelle (KA01) via ESP32 et Wokwi, tout en simulant une usine complète de 45+ machines avec des données réalistes générées automatiquement. Le Data Generator maintient en permanence 5 à 20 machines en état non-opérationnel, permettant une démonstration réaliste d'un environnement industriel complet avec calcul automatique des KPI (MTTR, MTTA, disponibilité)."

---

## 📧 Support

Fichiers créés:
- ✅ `data-generator.js` - Module génération données
- ✅ `DATA_GENERATOR_README.md` - Documentation détaillée
- ✅ `DEPLOYMENT_GUIDE.md` - Ce guide

Modifications:
- ✅ `server.js` - Intégration Data Generator
- ✅ `andon-simple.ino` - Code ESP32 lifecycle

Déjà existants:
- ✅ `mqtt-bridge.js` - Cycle de vie MQTT
- ✅ `dashboard.html` - Interface utilisateur
- ✅ `package.json` - Dependencies
