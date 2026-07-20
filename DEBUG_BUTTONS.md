# 🐛 DEBUG BUTTONS - Test Guide

## ✅ Debug Logs Added

Added 3 debug messages to diagnose button issues:

### 1. Loop Status (Every 5 seconds)
**If scanButtons() is running**:
```
[DEBUG] scanButtons() est en cours...
```

**If scanButtons() is BLOCKED**:
```
[DEBUG] scanButtons() BLOQUÉ! currentState=X
```
(Where X = current state number)

### 2. Function Entry (Every 10 seconds)
**Inside scanButtons()**:
```
[DEBUG] scanButtons() - Lecture des 5 boutons...
```

### 3. Button Press Detection
**When RED button is pressed**:
```
[DEBUG] ✅ BTN_DOWNTIME pressé!
```

---

## 🧪 TESTING PROCEDURE

### Step 1: Upload to Wokwi
1. Copy `sketch.ino` to Wokwi
2. Start simulation
3. Open Serial Monitor (9600 baud)

### Step 2: Wait for Boot
Wait until you see:
```
✅ Système prêt!
🟢 État: OPERATIONAL (LED GREEN ON)
```

### Step 3: Check Loop Status
**Every 5 seconds, you should see ONE of these**:

✅ **GOOD** (scanButtons is running):
```
[DEBUG] scanButtons() est en cours...
```

❌ **BAD** (scanButtons is blocked):
```
[DEBUG] scanButtons() BLOQUÉ! currentState=6
```

If you see the BAD message → **State management is still broken!**

### Step 4: Check Function Entry
**Every 10 seconds, you should see**:
```
[DEBUG] scanButtons() - Lecture des 5 boutons...
```

If you see this → **Function is executing correctly!**

### Step 5: Click RED Button
1. Click the RED button (GPIO 12) in Wokwi
2. Watch Serial Monitor

**Expected output**:
```
[DEBUG] ✅ BTN_DOWNTIME pressé!
[INFO ] 🔴 PHASE 1: DOWNTIME détecté par opérateur
[INFO ]    → Lifecycle: DETECTED
[INFO ] 🚨 ALERTE ACTIVE: LED PIN=13 | Type=1
[INFO ] 📤 MQTT TX: factory/ligne1/andon/alert
```

---

## 🔍 DIAGNOSIS TABLE

| Serial Monitor Shows | Diagnosis | Solution |
|---------------------|-----------|----------|
| `scanButtons() BLOQUÉ! currentState=6` | State stuck in STATE_ERROR | Check connectMqtt() fix |
| `scanButtons() BLOQUÉ! currentState=2` | State stuck in STATE_MQTT_CONNECT | MQTT never connected |
| `scanButtons() est en cours...` but no button response | Button reading issue | Check circuit connections |
| `scanButtons() - Lecture des 5 boutons...` | Function executing | Check button debounce logic |
| `BTN_DOWNTIME pressé!` | ✅ Button detected! | Everything working! |

---

## 🎯 STATE NUMBERS REFERENCE

```cpp
enum SystemState {
  STATE_INIT = 0,
  STATE_WIFI_CONNECT = 1,
  STATE_MQTT_CONNECT = 2,
  STATE_OPERATIONAL = 3,
  STATE_ALERT_ACTIVE = 4,
  STATE_RECONNECTING = 5,
  STATE_ERROR = 6
};
```

**Expected**: `currentState = 3` (STATE_OPERATIONAL) or `4` (STATE_ALERT_ACTIVE)

**Bad**: `currentState = 6` (STATE_ERROR) or `2` (STATE_MQTT_CONNECT)

---

## 📋 FULL EXPECTED OUTPUT

```
════════════════════════════════════════════════════
  🏭 SYSTÈME ANDON KA01 v2.0 Pro
  📡 ESP32 + MQTT + RFID + FSM + Watchdog
════════════════════════════════════════════════════
[0000001935] [INFO ] 🐕 Watchdog: Géré par Wokwi
[0000001936] [INFO ] 💡 Test LEDs...
[0000002837] [INFO ] 🟢 MODE: OPERATIONAL (LED GREEN ON)
[0000002838] [INFO ] 🔘 Boutons: 5 configurés (pull-up)
[0000002991] [INFO ] 🏷️ RFID: MFRC522 OK
[0000002991] [ERROR] ❌ WiFi: Échec initial
════════════════════════════════════════════════════
  ✅ Système prêt!
  🟢 État: OPERATIONAL (LED GREEN ON)
════════════════════════════════════════════════════

[0000010010] [WARN ] ⚠️ MQTT: Non connecté
[DEBUG] scanButtons() est en cours...          <-- ✅ GOOD!
[DEBUG] scanButtons() - Lecture des 5 boutons... <-- ✅ GOOD!
[0000020022] [WARN ] ⚠️ MQTT: Non connecté
[DEBUG] scanButtons() est en cours...
[0000030010] [WARN ] ⏳ WiFi: Perdu, reconnexion...
[0000033817] [INFO ] ✅ WiFi OK | IP: 10.10.0.2
[0000033819] [INFO ] 🔌 MQTT: Connexion à broker.hivemq.com:1883
[0000034192] [INFO ] ✅ MQTT: Connecté!
[DEBUG] scanButtons() est en cours...
[DEBUG] scanButtons() - Lecture des 5 boutons...

<-- USER CLICKS RED BUTTON -->

[DEBUG] ✅ BTN_DOWNTIME pressé!                <-- ✅ DETECTED!
[0000045123] [INFO ] 🔴 PHASE 1: DOWNTIME détecté par opérateur
[0000045124] [INFO ]    → Lifecycle: DETECTED
[0000045125] [INFO ] 🚨 ALERTE ACTIVE: LED PIN=13 | Type=1
[0000045126] [INFO ] 📤 MQTT TX: factory/ligne1/andon/alert
[0000045127] [INFO ] ✅ Alert Panne machine | Phase: detected
[0000045128] [INFO ]    📍 PHASE 1 envoyée: Panne détectée
```

---

## 🚀 NEXT STEPS

### If Debug Shows "scanButtons() BLOQUÉ!":
1. Check `currentState` value in the error message
2. If `currentState = 6` → State fix didn't apply correctly
3. Re-check lines 443-447 in `connectMqtt()` function

### If Debug Shows "scanButtons() est en cours..." but buttons don't work:
1. Check `diagram.json` circuit connections
2. Verify button GPIO pins match: DOWNTIME=12, MAINT=14, etc.
3. Check button wiring: buttons connect to GND when pressed
4. Check `INPUT_PULLUP` configuration in `setup()`

### If Buttons Work:
1. ✅ Test all 5 buttons
2. ✅ Verify MQTT messages in MQTT Explorer
3. ✅ Check database for lifecycle_phase updates
4. ✅ Remove debug logs (optional)

---

**Created**: 2026-07-16  
**Purpose**: Diagnose button press detection issues  
**Files Modified**: `wifi-scan.ino`, `sketch.ino`
