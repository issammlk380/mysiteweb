# 🚀 WOKWI READY - CODE COMPLET POUR COPIER/COLLER

## Version: 2.0 Pro avec fixes STATE management
## Date: 2026-07-17

---

## 📋 INSTRUCTIONS RAPIDES

### Pour Wokwi:
1. Aller sur: https://wokwi.com/projects/new/esp32
2. Copier le code **wifi-scan.ino** ci-dessous dans `sketch.ino`
3. Copier le code **diagram.json** ci-dessous dans `diagram.json`
4. Cliquer ▶️ Start
5. Attendre 5 secondes
6. Cliquer le bouton rouge 🔴
7. Regarder Serial Monitor pour `[DEBUG] ✅ BTN_DOWNTIME pressé!`

---

## ✅ FIXES APPLIQUÉS

### Fix 1: WiFi Échec → STATE_OPERATIONAL (pas STATE_ERROR)
- **Ligne 733**: `currentState = STATE_OPERATIONAL;` après WiFi échec initial
- **Pourquoi**: Permet aux boutons de fonctionner même sans WiFi

### Fix 2: Supprimé `currentState = STATE_RECONNECTING` 
- **Ligne 647**: Commenté `// currentState = STATE_RECONNECTING;`
- **Pourquoi**: Ne bloque plus scanButtons() pendant reconnexion WiFi

### Fix 3: MQTT Connect → STATE_OPERATIONAL
- **Ligne 445**: `currentState = STATE_OPERATIONAL;` après MQTT connexion
- **Pourquoi**: Retour automatique à l'état opérationnel après MQTT OK

---

## 🐛 DEBUG MESSAGES

Le code contient 3 messages debug pour diagnostiquer:

1. **Loop Status** (toutes les 5 secondes):
   ```
   [DEBUG] scanButtons() est en cours...
   ```
   OU
   ```
   [DEBUG] scanButtons() BLOQUÉ! currentState=X
   ```

2. **Function Entry** (toutes les 10 secondes):
   ```
   [DEBUG] scanButtons() - Lecture des 5 boutons...
   ```

3. **Button Press**:
   ```
   [DEBUG] ✅ BTN_DOWNTIME pressé!
   ```

---

## 📊 ÉTATS SYSTÈME (currentState values)

```
0 = STATE_INIT
1 = STATE_WIFI_CONNECT
2 = STATE_MQTT_CONNECT
3 = STATE_OPERATIONAL ✅ (scanButtons active)
4 = STATE_ALERT_ACTIVE ✅ (scanButtons active)
5 = STATE_RECONNECTING ❌ (scanButtons bloqué)
6 = STATE_ERROR ❌ (scanButtons bloqué)
```

**Attendu**: currentState devrait être **3** ou **4** après démarrage

---

## 🎯 COMPORTEMENT ATTENDU

### Au démarrage:
```
════════════════════════════════════════════════════
  🏭 SYSTÈME ANDON KA01 v2.0 Pro
════════════════════════════════════════════════════
[INFO ] 🐕 Watchdog: Géré par Wokwi
[INFO ] 💡 Test LEDs...
[INFO ] 🟢 MODE: OPERATIONAL (LED GREEN ON)
[INFO ] 🔘 Boutons: 5 configurés (pull-up)
[INFO ] 🏷️ RFID: MFRC522 OK
[ERROR] ❌ WiFi: Échec initial
════════════════════════════════════════════════════
  ✅ Système prêt!
  🟢 État: OPERATIONAL (LED GREEN ON)
════════════════════════════════════════════════════
[DEBUG] scanButtons() est en cours...  ← ✅ BON!
```

### Clic bouton rouge:
```
[DEBUG] ✅ BTN_DOWNTIME pressé!
[INFO ] 🔴 PHASE 1: DOWNTIME détecté par opérateur
[INFO ]    → Lifecycle: DETECTED
[INFO ] 🚨 ALERTE ACTIVE: LED PIN=13 | Type=1
```

### LED allumée:
- 🔴 LED rouge s'allume
- 🟢 LED verte s'éteint

---

## 🔌 GPIO PINS (INCHANGÉS)

### LEDs:
- RED = GPIO 13
- BLUE = GPIO 16
- YELLOW = GPIO 17
- ORANGE = GPIO 4
- GREEN = GPIO 2

### Boutons:
- DOWNTIME = GPIO 12 (🔴)
- MAINTENANCE = GPIO 14 (🔵)
- BREAK = GPIO 27 (🟡)
- MATERIAL = GPIO 26 (🟠)
- RESOLVE = GPIO 25 (🟢)

### RFID:
- SS = GPIO 5
- RST = GPIO 22
- SCK = GPIO 18
- MOSI = GPIO 23
- MISO = GPIO 19

---

## 📡 LIFECYCLE 3 PHASES

### Phase 1: DETECTED (Opérateur)
- Appuie sur bouton **🔴 DOWNTIME**
- Backend enregistre: `lifecycle_phase='detected'`, `heure_debut`

### Phase 2: ACKNOWLEDGED (Technicien arrive)
- Appuie sur bouton **🔵 MAINTENANCE**
- Backend enregistre: `lifecycle_phase='acknowledged'`, `heure_acknowledge`
- Backend calcule: **MTTA** = `heure_acknowledge - heure_debut`

### Phase 3: RESOLVED (Réparation terminée)
- Appuie sur bouton **🟢 RESOLVE**
- Backend enregistre: `lifecycle_phase='resolved'`, `heure_fin`
- Backend calcule: 
  - **Temps réparation** = `heure_fin - heure_acknowledge`
  - **MTTR** = `heure_fin - heure_debut` (temps total)

---

## 🗄️ DATABASE SCHEMA

### Table: downtime_logs

Colonnes clés pour lifecycle:
- `lifecycle_phase` VARCHAR: "detected" | "acknowledged" | "resolved"
- `heure_debut` TIMESTAMP: Quand opérateur appuie sur DOWNTIME
- `heure_acknowledge` TIMESTAMP: Quand technicien appuie sur MAINTENANCE
- `heure_fin` TIMESTAMP: Quand technicien appuie sur RESOLVE
- `temps_reaction_minutes` NUMERIC: MTTA (acknowledge - debut)
- `temps_reparation_minutes` NUMERIC: acknowledge - fin
- `temps_total_arret_minutes` NUMERIC: MTTR (fin - debut)

---

## 🚀 BACKEND (Railway)

### mqtt-bridge.js handlers:

1. **insertDowntimeLog()**: 
   - Écoute: `lifecycle_phase='detected'`
   - INSERT nouvelle ligne avec `heure_debut`

2. **acknowledgeTechnician()**:
   - Écoute: `lifecycle_phase='acknowledged'`
   - UPDATE `heure_acknowledge`, calcule `temps_reaction_minutes`

3. **resolveAlert()**:
   - Écoute: `lifecycle_phase='resolved'`
   - UPDATE `heure_fin`, calcule `temps_reparation_minutes`, `temps_total_arret_minutes`

---

## ⚠️ LIMITATIONS WOKWI

### MQTT externe:
- Wokwi n'a **pas** de support fiable pour broker.hivemq.com
- Parfois connecte, parfois loop infini
- **Solution**: Tester boutons/LEDs dans Wokwi, tester MQTT séparément avec MQTT Explorer

### Alternative:
- Utiliser **sketch-simple.ino** (pas de MQTT, seulement boutons/LEDs)
- Tester backend avec MQTT Explorer + messages manuels

---

## 📝 FICHIERS CRÉÉS

1. `wifi-scan.ino` - Code principal ESP32
2. `sketch.ino` - Copie identique pour Wokwi
3. `sketch-simple.ino` - Version simplifiée sans MQTT
4. `diagram.json` - Configuration circuit Wokwi
5. `MQTT_TEST_MESSAGES.md` - Messages test pour MQTT Explorer
6. `WOKWI_TESTING_GUIDE.md` - Guide complet de test
7. `STATE_FIX_SUMMARY.md` - Explication technique du fix
8. `DEBUG_BUTTONS.md` - Guide debugging boutons

---

**Généré**: 2026-07-17 00:18  
**Version**: 2.0 Pro  
**Status**: ✅ Ready for Wokwi Testing
