# 🧪 Test Messages pour MQTT Explorer

## 📡 Configuration MQTT Explorer:

```
Host: broker.hivemq.com
Port: 1883
Protocol: mqtt://
```

---

## 📨 Test Message 1: PHASE 1 - DETECTED

**Topic**: `factory/ligne1/andon/alert`

**Message (JSON)**:
```json
{
  "machine_id": "KA01",
  "zone": "KA",
  "status": "DOWNTIME",
  "type": "Panne machine",
  "lifecycle_phase": "detected",
  "operator": "OPERATOR_001",
  "timestamp": 1234567890,
  "uptime": "0d 00:05:30"
}
```

**Résultat attendu**:
- Backend insère dans `downtime_logs`
- `lifecycle_phase = 'detected'`
- `date_panne = NOW()`

---

## 📨 Test Message 2: PHASE 2 - ACKNOWLEDGED

**Topic**: `factory/ligne1/andon/alert`

**Message (JSON)**:
```json
{
  "machine_id": "KA01",
  "zone": "KA",
  "status": "MAINTENANCE",
  "type": "Maintenance requise",
  "lifecycle_phase": "acknowledged",
  "operator": "TECH_AHMED",
  "timestamp": 1234569890,
  "uptime": "0d 00:38:30"
}
```

**Résultat attendu**:
- Backend UPDATE dernier downtime_log
- `lifecycle_phase = 'acknowledged'`
- `date_arrivee_technicien = NOW()`
- `temps_reaction_minutes` = calculé automatiquement (MTTA)

---

## 📨 Test Message 3: PHASE 3 - RESOLVED

**Topic**: `factory/ligne1/andon/alert`

**Message (JSON)**:
```json
{
  "machine_id": "KA01",
  "zone": "KA",
  "status": "OPERATIONAL",
  "type": "Fonctionnement normal",
  "lifecycle_phase": "resolved",
  "operator": "TECH_AHMED",
  "timestamp": 1234573490,
  "uptime": "1d 01:18:10"
}
```

**Résultat attendu**:
- Backend UPDATE dernier downtime_log
- `lifecycle_phase = 'resolved'`
- `date_reparation = NOW()`
- `temps_reparation_minutes` = calculé (temps entre acknowledged et resolved)
- `temps_total_arret_minutes` = calculé (MTTR total)

---

## 🎯 Comment tester dans MQTT Explorer:

### 1. Connecte-toi à broker.hivemq.com

### 2. Va dans la section "Publish" (sur la droite)

### 3. Copie-colle les messages ci-dessus:

#### Test 1 - DETECTED:
```
Topic: factory/ligne1/andon/alert
Message: (copier le JSON de Test Message 1)
```

Attends 30 secondes, puis:

#### Test 2 - ACKNOWLEDGED:
```
Topic: factory/ligne1/andon/alert
Message: (copier le JSON de Test Message 2)
```

Attends 1 minute, puis:

#### Test 3 - RESOLVED:
```
Topic: factory/ligne1/andon/alert
Message: (copier le JSON de Test Message 3)
```

---

## 📊 Vérification dans la Database:

Après avoir envoyé les 3 messages, vérifie:

```sql
SELECT 
  id,
  machine_id,
  lifecycle_phase,
  date_panne,
  date_arrivee_technicien,
  date_reparation,
  temps_reaction_minutes,
  temps_reparation_minutes,
  temps_total_arret_minutes
FROM downtime_logs
WHERE machine_id = 'KA01'
ORDER BY date_panne DESC
LIMIT 1;
```

**Résultat attendu**:
```
lifecycle_phase: 'resolved'
date_panne: 2026-07-16 11:00:00
date_arrivee_technicien: 2026-07-16 11:30:00
date_reparation: 2026-07-16 12:15:00
temps_reaction_minutes: 30.00  (MTTA)
temps_reparation_minutes: 45.00
temps_total_arret_minutes: 75.00  (MTTR)
```

---

## 🎉 Avantages de cette méthode:

✅ Teste le Backend **sans ESP32**
✅ Teste le **3-phase lifecycle** complet
✅ Vérifie les **calculs KPI** automatiques
✅ Prouve que **mqtt-bridge.js** fonctionne
✅ Prouve que **la Database** se met à jour

---

## 📝 Pour le mémoire/présentation:

Tu peux dire:
1. ✅ "J'ai testé les boutons ESP32 avec Wokwi (sketch-simple.ino)"
2. ✅ "J'ai testé le Backend avec MQTT Explorer (messages manuels)"
3. ✅ "Les KPIs (MTTA, MTTR) se calculent automatiquement"
4. ✅ "Le système 3-phase lifecycle fonctionne correctement"

---

## 🚀 Prochaines étapes:

1. **Dans MQTT Explorer**: Envoie les 3 test messages
2. **Vérifie Backend logs** (Railway)
3. **Vérifie Database** (Supabase/PostgreSQL)
4. **Capture screenshots** pour le mémoire

**Maintenant teste avec MQTT Explorer! 📡**
