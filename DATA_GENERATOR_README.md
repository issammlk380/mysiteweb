# 🏭 Data Generator - Realistic Factory Simulation

## ✅ Vue d'ensemble

Le **Data Generator** génère automatiquement des données réalistes pour toutes les machines simulées (KB, KC, KD, KX...) **SAUF KA01** qui reste connectée à Wokwi.

---

## 🎯 Objectifs

### ✅ 1. Maintenir 5-20 machines non-opérationnelles
- Le système balance automatiquement le nombre de pannes actives
- Crée de nouvelles pannes si < 5 machines en panne
- Résout des pannes si > 20 machines en panne
- Simule une usine dynamique et réaliste

### ✅ 2. Éliminer les valeurs NULL
- Tous les champs importants sont remplis automatiquement:
  - `atelier`, `zone`, `operator`, `technician`
  - `criticite`, `breakdown_category`, `root_cause`, `actions_taken`
  - `date_panne`, `date_arrivee_technicien`, `date_reparation`
  - `temps_reaction_minutes`, `temps_reparation_minutes`, `temps_total_arret_minutes`
  - `preventive_actions`, `resolved_by`, `lifecycle_phase`

### ✅ 3. Données cohérentes et réalistes
- Timestamps logiques: arrivée > panne, réparation > arrivée
- Durées réalistes basées sur le type de panne
- Opérateurs et techniciens cohérents avec les zones
- Types de pannes réalistes avec causes et actions appropriées

---

## 🔧 Types de pannes supportés

### 1. Électrique
- **Criticité**: Faible, Modérée, Majeure
- **Durée moyenne**: 45 minutes
- **Exemples**: Court-circuit capteur, défaillance carte, surchauffe moteur

### 2. Mécanique
- **Criticité**: Modérée, Majeure, Critique
- **Durée moyenne**: 90 minutes
- **Exemples**: Usure roulement, désalignement axe, vibrations anormales

### 3. Hydraulique
- **Criticité**: Modérée, Majeure
- **Durée moyenne**: 60 minutes
- **Exemples**: Fuite circuit, pression insuffisante, vérin bloqué

### 4. Pneumatique
- **Criticité**: Faible, Modérée
- **Durée moyenne**: 30 minutes
- **Exemples**: Fuite air comprimé, électrovanne défectueuse

### 5. Lubrification
- **Criticité**: Faible, Modérée
- **Durée moyenne**: 15 minutes
- **Exemples**: Manque lubrifiant, pompe HS, circuit obstrué

---

## 🚀 Utilisation

### Démarrage automatique

Le Data Generator démarre automatiquement avec le serveur:

```javascript
// Dans server.js
dataGenerator.init(pool, io);
```

### Endpoints API

#### 1. Vérifier l'état de l'usine
```bash
GET /api/factory/status
```

**Réponse:**
```json
{
  "success": true,
  "data": {
    "total_machines": 45,
    "operational": 30,
    "non_operational": 15,
    "operational_percentage": 67,
    "target_non_operational": "5-20",
    "is_balanced": true,
    "by_status": [
      { "status_category": "downtime", "count": 8 },
      { "status_category": "maintenance", "count": 7 }
    ],
    "by_zone": [
      { "zone": "KA", "count": 3 },
      { "zone": "KB", "count": 5 },
      { "zone": "KC", "count": 4 },
      { "zone": "KD", "count": 3 }
    ]
  }
}
```

#### 2. Générer des données manuellement
```bash
POST /api/data-generator/trigger
```

Force une balance immédiate de l'usine.

#### 3. Remplir les valeurs NULL existantes
```bash
POST /api/data-generator/fill-nulls
```

Remplit automatiquement les valeurs NULL dans les enregistrements existants (jusqu'à 100 à la fois).

---

## ⚙️ Configuration

### Machines simulées (dans `data-generator.js`)

```javascript
const ALL_MACHINES = [
  // Zone KA (sauf KA01 - Wokwi)
  'KA02', 'KA03', 'KA04', 'KA05', 'KA06', 'KA07', 'KA08', 'KA09', 'KA10',
  // Zone KB
  'KB01', 'KB02', 'KB03', 'KB04', 'KB05', 'KB06', 'KB07', 'KB08', 'KB09', 'KB10',
  // Zone KC
  'KC01', 'KC02', 'KC03', 'KC04', 'KC05', 'KC06', 'KC07', 'KC08', 'KC09', 'KC10',
  // Zone KD
  'KD01', 'KD02', 'KD03', 'KD04', 'KD05', 'KD06', 'KD07', 'KD08', 'KD09', 'KD10',
  // Zone KX
  'KX01', 'KX02', 'KX03', 'KX04', 'KX05'
];
```

### Intervalle de mise à jour

Par défaut: **5 minutes**

Pour changer:
```javascript
// Dans data-generator.js - fonction init()
updateInterval = setInterval(() => balanceFactory(), 5 * 60 * 1000); // 5 minutes
```

### Nombre de machines non-opérationnelles

```javascript
const MIN_NON_OPERATIONAL = 5;
const MAX_NON_OPERATIONAL = 20;
```

---

## 📊 KPI Automatiquement calculés

Le Data Generator génère des données qui permettent de calculer:

### 1. MTTR (Mean Time To Repair)
```sql
temps_total_arret_minutes = date_reparation - date_panne
```

### 2. MTTA (Mean Time To Acknowledge)
```sql
temps_reaction_minutes = date_arrivee_technicien - date_panne
```

### 3. Temps de réparation
```sql
temps_reparation_minutes = date_reparation - date_arrivee_technicien
```

### 4. Disponibilité
```sql
availability = ((totalMinutes - totalDowntimeMinutes) / totalMinutes) * 100
```

---

## 🔄 Cycle de vie des pannes

Le Data Generator respecte le cycle de vie complet:

### Phase 1: DETECTED
```javascript
{
  lifecycle_phase: 'detected',
  status: 'En attente',
  date_panne: '2026-07-16 14:30:00',
  operator: 'Op_0102'
}
```

### Phase 2: ACKNOWLEDGED
```javascript
{
  lifecycle_phase: 'acknowledged',
  status: 'En cours',
  date_arrivee_technicien: '2026-07-16 14:45:00',
  temps_reaction_minutes: 15,
  technician: 'Ahmed Benali'
}
```

### Phase 3: RESOLVED
```javascript
{
  lifecycle_phase: 'resolved',
  status: 'Termine',
  date_reparation: '2026-07-16 15:15:00',
  temps_reparation_minutes: 30,
  temps_total_arret_minutes: 45,
  resolved_by: 'Ahmed Benali'
}
```

---

## 🚨 Protection KA01

**IMPORTANT**: Le Data Generator **NE TOUCHE JAMAIS** à KA01.

Toutes les requêtes SQL contiennent:
```sql
WHERE machine != 'KA01'
```

Cela garantit que:
- ✅ KA01 garde ses données réelles de Wokwi
- ✅ Aucune donnée simulée n'affecte KA01
- ✅ KA01 fonctionne indépendamment du Data Generator

---

## 📈 Monitoring

### Logs générés

```
[DATA-GEN] 🏭 Factory Status: 12 non-operational machines
[DATA-GEN] Target range: 5 - 20
[DATA-GEN] ✅ Factory balanced (12 non-operational)
[DATA-GEN] ✅ Inserted realistic breakdown - KB03 | Électrique | Majeure
[DATA-GEN] Machine KB03 status updated: downtime
```

### Événements Socket.IO émis

```javascript
{
  machine: 'KB03',
  status: 'downtime',
  alert_type: 'Électrique',
  criticite: 'Majeure',
  source: 'data_generator'
}
```

---

## 🧪 Tests

### Test 1: Vérifier l'état initial
```bash
curl http://localhost:3000/api/factory/status
```

### Test 2: Forcer une génération
```bash
curl -X POST http://localhost:3000/api/data-generator/trigger
```

### Test 3: Remplir les NULL
```bash
curl -X POST http://localhost:3000/api/data-generator/fill-nulls
```

### Test 4: Vérifier les KPI
```bash
curl http://localhost:3000/api/stats
```

**Résultat attendu:**
- ✅ MTTR != "N/A"
- ✅ MTTA affiché en minutes
- ✅ Availability != "0%"

---

## 🐛 Dépannage

### Le Data Generator ne démarre pas

**Vérifier:**
```javascript
// Dans console au démarrage
✅ MQTT Bridge initialisé avec succès
✅ Data Generator initialisé avec succès

═══════════════════════════════════════════════════════════════
  🏭 DATA GENERATOR INITIALIZED
═══════════════════════════════════════════════════════════════
  Machines: 45 (excluding KA01)
  Target non-operational: 5-20
  Update interval: 5 minutes
═══════════════════════════════════════════════════════════════
```

### Pas assez de pannes générées

**Solutions:**
1. Attendre 5 minutes (intervalle automatique)
2. Forcer manuellement: `POST /api/data-generator/trigger`
3. Vérifier les logs: `[DATA-GEN]`

### Valeurs NULL persistent

**Solutions:**
1. Appeler: `POST /api/data-generator/fill-nulls`
2. Vérifier que les colonnes existent dans la DB
3. Relancer le serveur pour exécuter le cleanup automatique

---

## 📝 Fichiers modifiés

1. ✅ **data-generator.js** (NOUVEAU) - Logic génération données
2. ✅ **server.js** - Intégration Data Generator + nouveaux endpoints
3. ✅ **mqtt-bridge.js** - Lifecycle 3 phases (détecté → acknowledge → résolu)

---

## 🎓 Pour la démonstration PFE

### Ce que le jury verra:

1. ✅ **Dashboard vivant** avec 5-20 machines en panne en temps réel
2. ✅ **KPI réalistes** (MTTR, MTTA, Availability) calculés automatiquement
3. ✅ **Aucune valeur NULL** dans PostgreSQL
4. ✅ **KA01 fonctionnelle** avec Wokwi (boutons réels)
5. ✅ **Données cohérentes** (timestamps, durées, opérateurs)
6. ✅ **Cycle de vie complet** (detected → acknowledged → resolved)

### Message clé:
> "Ce système simule une usine SEWS complète avec 45+ machines. KA01 est la machine réelle connectée à Wokwi, toutes les autres sont simulées avec des données réalistes pour la démonstration."

---

## 📧 Support

Pour toute question:
- Consulter les logs: `[DATA-GEN]`
- Vérifier l'API: `/api/factory/status`
- Tester manuellement: `POST /api/data-generator/trigger`
