# 🧪 WOKWI TESTING GUIDE - ESP32 Andon System
## Version 2.0 Pro - 3-Phase Lifecycle Testing

---

## ✅ FILES READY FOR TESTING

### Main Files:
1. **`wifi-scan.ino`** - Production code with full 3-phase lifecycle
2. **`sketch.ino`** - Wokwi copy (identical to wifi-scan.ino)
3. **`sketch-simple.ino`** - Simplified version (no MQTT, for button testing only)
4. **`diagram.json`** - Circuit connections for Wokwi

### Support Files:
- **`MQTT_TEST_MESSAGES.md`** - Test messages for MQTT Explorer
- **Backend**: `mqtt-bridge.js` deployed on Railway
- **Database**: PostgreSQL with `downtime_logs` table

---

## 🔧 CRITICAL FIX APPLIED

### Problem:
- Buttons not responding after MQTT connection
- `currentState` stuck in `STATE_ERROR` after initial WiFi failure
- `scanButtons()` only executes when `currentState == STATE_OPERATIONAL || STATE_ALERT_ACTIVE`

### Solution:
Added in `connectMqtt()` function (lines 443-447):
```cpp
// ✅ Retour à l'état OPERATIONAL après connexion MQTT
if (currentState != STATE_ALERT_ACTIVE) {
  currentState = STATE_OPERATIONAL;
}
```

### Why This Works:
1. Initial boot → `currentState = STATE_OPERATIONAL`
2. WiFi fails → `currentState = STATE_ERROR` (blocks scanButtons)
3. WiFi connects later → still `STATE_ERROR` (buttons still blocked) ❌
4. **AFTER FIX**: MQTT connects → `currentState = STATE_OPERATIONAL` ✅
5. Now `scanButtons()` executes every loop!

---

## 🧪 TESTING STRATEGY

### ⚠️ IMPORTANT WOKWI LIMITATION:
Wokwi's external MQTT support is **inconsistent**:
- Sometimes connects to broker.hivemq.com
- Sometimes loops forever trying to connect
- This is a **Wokwi limitation**, not a code issue

### 📋 Test Approach:

#### **Option A: Full Integration Test (If MQTT Works)**
1. Upload `sketch.ino` to Wokwi
2. Open Serial Monitor (9600 baud)
3. Wait for "✅ MQTT: Connecté!"
4. Test buttons (see Button Testing section below)
5. Verify MQTT messages in MQTT Explorer

#### **Option B: Hardware-Only Test (If MQTT Fails)**
1. Upload `sketch-simple.ino` to Wokwi
2. Test buttons and LEDs only
3. Skip MQTT verification
4. Test backend separately with MQTT Explorer

#### **Option C: Manual Backend Test**
1. Open MQTT Explorer → Connect to broker.hivemq.com:1883
2. Send test messages from `MQTT_TEST_MESSAGES.md`
3. Verify backend inserts data into PostgreSQL
4. Check KPI calculations (MTTA, MTTR)

---

## 🔘 BUTTON TESTING PROCEDURE

### Expected Serial Monitor Output:

#### **Test 1: DOWNTIME Button (Operator)**
**Action**: Click BTN_DOWNTIME (GPIO 12)
**Expected Log**:
```
[xxxxxxx] [INFO ] 🔴 ALERTE: DOWNTIME détectée
[xxxxxxx] [INFO ] 🔄 État: OPERATIONAL → ALERT_ACTIVE
[xxxxxxx] [INFO ] 💡 LED RED: ON
[xxxxxxx] [INFO ] 💡 LED GREEN: OFF
[xxxxxxx] [INFO ] 📤 MQTT: Envoi alerte DOWNTIME
```

**Expected MQTT Message** (in MQTT Explorer on `factory/ligne1/andon/alert`):
```json
{
  "type": "DOWNTIME",
  "status": "DOWNTIME",
  "machine": "KA01",
  "timestamp": "2026-07-16T10:30:00Z",
  "lifecycle_phase": "detected",
  "technician_id": null
}
```

---

#### **Test 2: MAINTENANCE Button (Technician Acknowledgement)**
**Action**: Click BTN_MAINTENANCE (GPIO 14) **while RED LED is ON**
**Expected Log**:
```
[xxxxxxx] [INFO ] 🔵 MAINTENANCE: Technicien intervient
[xxxxxxx] [INFO ] 💡 LED BLUE: ON (+ RED reste ON)
[xxxxxxx] [INFO ] 📤 MQTT: Envoi ACKNOWLEDGE
```

**Expected MQTT Message** (on `factory/ligne1/andon/alert`):
```json
{
  "type": "ACKNOWLEDGE",
  "machine": "KA01",
  "timestamp": "2026-07-16T10:35:00Z",
  "lifecycle_phase": "acknowledged",
  "technician_id": "TECH_789ABC"
}
```

---

#### **Test 3: RESOLVE Button (Problem Fixed)**
**Action**: Click BTN_RESOLVE (GPIO 25) **while RED+BLUE LEDs are ON**
**Expected Log**:
```
[xxxxxxx] [INFO ] ✅ RÉSOLUTION: Retour OPERATIONAL
[xxxxxxx] [INFO ] 🔄 État: ALERT_ACTIVE → OPERATIONAL
[xxxxxxx] [INFO ] 💡 LED RED: OFF
[xxxxxxx] [INFO ] 💡 LED BLUE: OFF
[xxxxxxx] [INFO ] 💡 LED GREEN: ON
[xxxxxxx] [INFO ] 📤 MQTT: Envoi RESOLVE
```

**Expected MQTT Message** (on `factory/ligne1/andon/alert`):
```json
{
  "type": "RESOLVE",
  "machine": "KA01",
  "timestamp": "2026-07-16T10:40:00Z",
  "lifecycle_phase": "resolved"
}
```

---

## 🗄️ DATABASE VERIFICATION

### After Full 3-Phase Test Cycle:

Connect to PostgreSQL and run:
```sql
SELECT 
  id_log,
  machine_id,
  type_arret,
  lifecycle_phase,
  temps_reaction_minutes,
  temps_reparation_minutes,
  temps_total_arret_minutes,
  heure_debut,
  heure_acknowledge,
  heure_fin
FROM downtime_logs
WHERE machine_id = 'KA01'
ORDER BY heure_debut DESC
LIMIT 1;
```

### Expected Result:
| Field | Expected Value |
|-------|----------------|
| `lifecycle_phase` | `"resolved"` |
| `temps_reaction_minutes` | `~5` (time from DETECTED → ACKNOWLEDGED) |
| `temps_reparation_minutes` | `~5` (time from ACKNOWLEDGED → RESOLVED) |
| `temps_total_arret_minutes` | `~10` (total downtime) |
| `heure_debut` | Timestamp when BTN_DOWNTIME pressed |
| `heure_acknowledge` | Timestamp when BTN_MAINTENANCE pressed |
| `heure_fin` | Timestamp when BTN_RESOLVE pressed |

---

## 🚨 TROUBLESHOOTING

### ❌ Problem: Buttons Still Not Responding

#### Check 1: Verify Serial Monitor Shows OPERATIONAL State
**Look for**:
```
[xxxxxxx] [INFO ] ✅ MQTT: Connecté!
```
**Then immediately after, state should be OPERATIONAL**

If you see:
```
[xxxxxxx] [ERROR] ❌ WiFi: Échec initial
```
And nothing changes → **WiFi never recovered, buttons blocked**

**Solution**: 
- In Wokwi, WiFi should auto-connect (Wokwi-GUEST has no password)
- If stuck, restart simulation

---

#### Check 2: Verify scanButtons() is Being Called
**Add debug log to `loop()` function** (temporary):
```cpp
void loop() {
  // ...existing code...
  
  if (currentState == STATE_OPERATIONAL || currentState == STATE_ALERT_ACTIVE) {
    Serial.println("[DEBUG] scanButtons() executing..."); // ADD THIS
    scanButtons();
  }
}
```

**Expected**: Should see `[DEBUG] scanButtons() executing...` every loop iteration

**If NOT shown** → `currentState` is still wrong → Re-check `connectMqtt()` fix

---

#### Check 3: Verify Button Pin Configuration
In `setup()`, check:
```cpp
pinMode(PIN_BTN_DOWNTIME, INPUT_PULLUP);   // GPIO 12
pinMode(PIN_BTN_MAINTENANCE, INPUT_PULLUP); // GPIO 14
pinMode(PIN_BTN_BREAK, INPUT_PULLUP);       // GPIO 27
pinMode(PIN_BTN_MATERIAL, INPUT_PULLUP);    // GPIO 26
pinMode(PIN_BTN_RESOLVE, INPUT_PULLUP);     // GPIO 25
```

All should be configured as `INPUT_PULLUP` (buttons connect to GND when pressed)

---

### ❌ Problem: MQTT Won't Connect in Wokwi

**Symptoms**:
```
[xxxxxxx] [INFO ] 🔌 MQTT: Connexion à broker.hivemq.com:1883
[xxxxxxx] [ERROR] ❌ MQTT: Échec connexion (état=-2)
[xxxxxxx] [WARN ] ⏳ MQTT: Réessai dans 5000 ms
```
Loops forever...

**Root Cause**: Wokwi external MQTT support is unreliable

**Solutions**:

1. **Use sketch-simple.ino** (no MQTT, buttons/LEDs only)
2. **Test backend separately** with MQTT Explorer
3. **Deploy to real ESP32 hardware** for full testing

---

### ❌ Problem: Buttons Work But No MQTT Messages

**Check MQTT Explorer**:
- Connected to `broker.hivemq.com:1883`?
- Subscribed to `factory/ligne1/andon/alert`?
- Try sending test message from `MQTT_TEST_MESSAGES.md`

**Check Backend**:
- Railway deployment running?
- Check Railway logs for errors
- Verify PostgreSQL connection string

---

## 🎯 SUCCESS CRITERIA

### ✅ Full System Working When:

1. **Wokwi Simulation**:
   - WiFi connects → "✅ WiFi OK | IP: ..."
   - MQTT connects → "✅ MQTT: Connecté!"
   - Button presses show in Serial Monitor
   - LEDs change correctly (RED → BLUE → GREEN)

2. **MQTT Explorer**:
   - Receives 3 messages per alert cycle:
     - `lifecycle_phase: "detected"`
     - `lifecycle_phase: "acknowledged"`
     - `lifecycle_phase: "resolved"`

3. **PostgreSQL Database**:
   - New row in `downtime_logs` table
   - `lifecycle_phase = "resolved"`
   - KPI fields calculated:
     - `temps_reaction_minutes` > 0
     - `temps_reparation_minutes` > 0
     - `temps_total_arret_minutes` = reaction + reparation

4. **Dashboard (if frontend deployed)**:
   - KA01 status updates from GREEN → RED → BLUE → GREEN
   - MTTA/MTTR metrics update

---

## 📝 NEXT STEPS

### If Buttons Work in Wokwi:
1. ✅ Hardware layer validated
2. Test full MQTT cycle (if MQTT connects)
3. Verify backend with MQTT Explorer
4. Check database KPI calculations

### If MQTT Doesn't Work in Wokwi:
1. ✅ Hardware layer validated with sketch-simple.ino
2. Test backend independently:
   - MQTT Explorer → send test messages
   - Verify database inserts
3. Deploy to **real ESP32 hardware** for full integration test

### Real Hardware Deployment:
1. Flash `wifi-scan.ino` to ESP32
2. Update WiFi credentials in code
3. Connect physical buttons/LEDs per `diagram.json`
4. Monitor Serial output (115200 baud)
5. Full 3-phase testing with real timestamps

---

## 📊 ARCHITECTURE SUMMARY

```
┌─────────────┐      MQTT       ┌──────────────┐     PostgreSQL    ┌──────────┐
│   ESP32     │ ──────────────► │ mqtt-bridge  │ ─────────────────► │ Database │
│   (Wokwi)   │  lifecycle_phase│  (Railway)   │  INSERT/UPDATE    │ (Railway)│
└─────────────┘                 └──────────────┘                    └──────────┘
      │                                │
      │                                ├─► insertDowntimeLog()
      ├─► BTN_DOWNTIME                │    • lifecycle_phase="detected"
      │   "detected"                   │
      │                                │
      ├─► BTN_MAINTENANCE              ├─► acknowledgeTechnician()
      │   "acknowledged"               │    • lifecycle_phase="acknowledged"
      │                                │    • Calculate MTTA
      │                                │
      └─► BTN_RESOLVE                  └─► resolveAlert()
          "resolved"                        • lifecycle_phase="resolved"
                                            • Calculate MTTR, Total
```

---

## 🔗 RELATED DOCUMENTS

- `MQTT_TEST_MESSAGES.md` - Manual testing payloads
- `diagram.json` - Wokwi circuit connections
- `FIXED_COMPILATION.md` - Compilation fixes history
- Backend code: `mqtt-bridge.js` (Railway deployment)

---

**Generated**: 2026-07-16  
**Version**: 2.0 Pro  
**Status**: ✅ Ready for Testing
