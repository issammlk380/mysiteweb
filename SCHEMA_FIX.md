# 🔧 Schema Fix - Column Names Correction

## ⚠️ Problème identifié

Le schema PostgreSQL Railway utilise des **column names différents** que ceux dans le code `server.js`.

---

## 📊 Différences trouvées:

### **Table `downtime_logs`:**

| Code attendait | Database a | Fix appliqué |
|---------------|-----------|--------------|
| ✅ Colonnes existantes communes | ✅ | Pas de changement |
| ❌ `machine` manquait | ✅ `machine` existe | ✅ Ajouté dans INSERT |
| ❌ `type` manquait | ✅ `type` existe | ✅ Ajouté dans INSERT |
| ❌ `zone` manquait | ✅ `zone` existe | ✅ Ajouté dans INSERT |

### **Table `machines`:**

| Code attendait | Database a | Fix appliqué |
|---------------|-----------|--------------|
| ❌ `code` | ✅ `machine_id` | ✅ Changé vers `machine_id` |
| ❌ `type_erreur` | ❌ N'existe pas | ✅ Supprimé du code |
| ✅ `status` | ✅ `status` | Pas de changement |
| - | ✅ `last_update` | ✅ Utilisé maintenant |

---

## ✅ Corrections appliquées:

### 1. **`insertRealisticBreakdown()`**
- ✅ Ajouté `zone` dans INSERT
- ✅ Ajouté `type` dans INSERT (duplique `alert_type`)
- ✅ Ordre des paramètres corrigé
- ✅ Error logging amélioré

### 2. **`updateMachineStatus()`**
- ✅ Changé `code` → `machine_id`
- ✅ Supprimé `type_erreur` (colonne inexistante)
- ✅ Ajouté `last_update = NOW()`
- ✅ Ajouté `zone` dans INSERT

### 3. **`fillNullValues()`**
- ✅ Ajouté `zone` dans UPDATE
- ✅ Ajouté `type` dans UPDATE
- ✅ Ajouté `alert_type` dans UPDATE
- ✅ SELECT vérifie aussi `type` column
- ✅ Error stack trace logging

---

## 🧪 Test après correction:

### **Test 1: Insert fonctionne**
```sql
SELECT machine, zone, type, alert_type, operator, technician 
FROM downtime_logs 
WHERE machine != 'KA01' 
ORDER BY date_panne DESC 
LIMIT 5;
```

**Attendu:** Voir données avec tous les champs remplis

---

### **Test 2: Machines table fonctionne**
```sql
SELECT machine_id, zone, status, last_update 
FROM machines 
ORDER BY last_update DESC 
LIMIT 10;
```

**Attendu:** Voir machines avec `machine_id` (pas `code`)

---

### **Test 3: NULL fill fonctionne**
```bash
curl -X POST http://localhost:3000/api/data-generator/fill-nulls
```

**Attendu:** Log success sans erreurs SQL

---

## 📝 Colonnes finales utilisées:

### **`downtime_logs` INSERT:**
```
machine, zone, atelier, operator, technician, status, 
alert_type, type, criticite, breakdown_category, 
root_cause, actions_taken, preventive_actions, resolved_by,
date_panne, heure_panne, date_arrivee_technicien, heure_arrivee,
date_reparation, heure_reparation, temps_reaction_minutes, 
temps_reparation_minutes, temps_intervention_minutes, 
temps_total_arret_minutes, duration, lifecycle_phase,
created_at, updated_at
```

### **`machines` INSERT/UPDATE:**
```
machine_id, zone, status, last_update
```

---

## ✅ Prêt pour déploiement

Toutes les corrections appliquées dans:
- `data-generator.js` (3 fonctions modifiées)

Aucune modification nécessaire dans:
- `server.js` (déjà compatible)
- `mqtt-bridge.js` (utilise `machine` correctement)

---

## 🚀 Prochaines étapes:

1. Test local: `npm start`
2. Vérifier logs: `[DATA-GEN]` sans erreurs SQL
3. Push sur Railway
4. Vérifier Database remplie

---

## 📧 Note technique:

La différence entre `machine` et `machine_id` était le problème principal. 
Le code `server.js` utilise `machine`, mais la table `machines` utilise `machine_id`.

Solution: Data Generator utilise maintenant `machine_id` pour la table `machines`, 
mais continue d'utiliser `machine` pour `downtime_logs` (qui a cette colonne).
