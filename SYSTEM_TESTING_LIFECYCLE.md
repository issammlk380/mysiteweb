# 🧪 System Testing Guide - 3 Lifecycle Phases

## ✅ All Compilation Errors Fixed

The following issues have been resolved:
- ❌ **Error 1**: `MQTT_KEEPALIVE` conflict with PubSubClient library
  - ✅ **Solution**: Renamed to `MQTT_KEEPALIVE_SEC`
  
- ❌ **Error 2**: Error in string concatenation `F() + String()`
  - ✅ **Solution**: Separated all concatenations into individual String variables

---

## 📋 System Summary

### 🎯 Goal
Andon system with **3 automatic phases** to track breakdowns:

1. **🔴 DETECTED** → Operator discovers the breakdown
2. **🔵 ACKNOWLEDGED** → Technician arrives on site
3. **🟢 RESOLVED** → Repair completed

---

## 🔧 Buttons and Functions

| Button | PIN | Color | Function | Phase |
|--------|-----|-------|----------|-------|
| **BTN_DOWNTIME** | 12 | 🔴 Red | Operator: Signal breakdown | DETECTED |
| **BTN_MAINTENANCE** | 14 | 🔵 Blue | Technician: Arrived on site | ACKNOWLEDGED |
| **BTN_BREAK** | 27 | 🟡 Yellow | Operator: Break | - |
| **BTN_MATERIAL** | 26 | 🟠 Orange | Operator: Material shortage | - |
| **BTN_RESOLVE** | 25 | 🟢 Green | Technician: Repair complete | RESOLVED |

---

## 📊 KPI Calculation

### Backend calculates automatically:

```sql
-- 🕒 MTTA (Mean Time To Acknowledge) = response time
temps_reaction_minutes = date_arrivee_technicien - date_panne

-- 🔧 MTTR (Mean Time To Repair) = total time
temps_total_arret_minutes = date_reparation - date_panne

-- ⚙️ Actual repair time
temps_reparation_minutes = date_reparation - date_arrivee_technicien
```

---

## 🧪 Testing Steps on Wokwi

### **Step 1️⃣: Upload Code to Wokwi**

1. Open [https://wokwi.com/](https://wokwi.com/)
2. Create new project: **ESP32**
3. Copy entire contents of `wifi-scan.ino`
4. Paste in editor
5. **Important**: Also upload `diagram.json` file (electrical connections)

---

### **Step 2️⃣: Install Libraries**

In Wokwi, add `libraries.txt` file with this content:

```
PubSubClient
MFRC522
```

---

### **Step 3️⃣: Start Simulation**

1. Click **▶️ Start Simulation**
2. Open **Serial Monitor** (terminal)
3. You should see:

```
════════════════════════════════════════════════════
  🏭 ANDON SYSTEM KA01 v2.0 Pro
  📡 ESP32 + MQTT + RFID + FSM + Watchdog
════════════════════════════════════════════════════
[0000000500] [INFO ] 🐕 Watchdog: 30s
[0000000600] [INFO ] 💡 Test LEDs...
[0000001200] [INFO ] 🟢 MODE: OPERATIONAL (LED GREEN ON)
[0000001250] [INFO ] 🔘 Buttons: 5 configured (pull-up)
[0000001300] [INFO ] 🏷️ RFID: MFRC522 OK
[0000001400] [INFO ] 🔌 WiFi: Connecting...
[0000003500] [INFO ] ✅ WiFi OK | IP: 192.168.1.100
[0000003600] [INFO ] 🔌 MQTT: Connecting to broker.hivemq.com:1883
[0000004200] [INFO ] ✅ MQTT: Connected!
════════════════════════════════════════════════════
  ✅ System ready!
  🟢 State: OPERATIONAL (LED GREEN ON)
════════════════════════════════════════════════════
```

---

### **Step 4️⃣: Test Phase 1 - DETECTED (Breakdown)**

#### 🔴 **Scenario**: Operator discovers machine breakdown

1. Click **BTN_DOWNTIME** (PIN 12)
2. Expected:
   - ✅ Red LED lights up (PIN 13)
   - ✅ All other LEDs turn off
   - ✅ Message in Serial Monitor:

```
[0000012340] [INFO ] 🔴 PHASE 1: DOWNTIME detected by operator
[0000012341] [INFO ]    → Lifecycle: DETECTED
[0000012350] [WARN ] 🚨 ACTIVE ALERT: LED PIN=13 | Type=0
[0000012380] [INFO ] ✅ Alert Machine breakdown | Phase: detected
[0000012381] [INFO ]    📍 PHASE 1 sent: Breakdown detected
[0000012400] [DEBUG] 📤 MQTT TX: factory/ligne1/andon/alert
```

3. Check **Backend Logs** (Railway):
   - Should see: `✅ Phase DETECTED: Downtime log created`
   - Check database:

```sql
SELECT * FROM downtime_logs ORDER BY id DESC LIMIT 1;
-- lifecycle_phase = 'detected'
-- date_panne = NOW()
-- date_arrivee_technicien = NULL
-- date_reparation = NULL
```

---

### **Step 5️⃣: Test Phase 2 - ACKNOWLEDGED (Technician Arrival)**

#### 🔵 **Scenario**: Technician arrives on site

1. Click **BTN_MAINTENANCE** (PIN 14)
2. Expected:
   - ✅ Blue LED lights up (PIN 16)
   - ✅ Red LED turns off
   - ✅ Message in Serial Monitor:

```
[0000045670] [INFO ] 🔵 PHASE 2: Technician ARRIVED on site
[0000045671] [INFO ]    → Lifecycle: ACKNOWLEDGED
[0000045672] [INFO ]    → Backend will calculate MTTA (response time)
[0000045680] [WARN ] 🚨 ACTIVE ALERT: LED PIN=16 | Type=1
[0000045710] [INFO ] ✅ Alert Maintenance required | Phase: acknowledged
[0000045711] [INFO ]    📍 PHASE 2 sent: Technician arrived
```

3. Check **Backend Logs**:
   - `✅ Phase ACKNOWLEDGED: Technician arrival recorded`
   - `⏱️ MTTA calculated: 33.55 minutes`

4. Check database:

```sql
SELECT 
  lifecycle_phase,
  date_panne,
  date_arrivee_technicien,
  temps_reaction_minutes
FROM downtime_logs 
ORDER BY id DESC LIMIT 1;

-- lifecycle_phase = 'acknowledged'
-- date_arrivee_technicien = NOW()
-- temps_reaction_minutes = automatic calculation (e.g., 33.55)
```

---

### **Step 6️⃣: Test Phase 3 - RESOLVED (Repair Complete)**

#### 🟢 **Scenario**: Technician completes repair

1. Click **BTN_RESOLVE** (PIN 25)
2. Expected:
   - ✅ Green LED lights up (PIN 2)
   - ✅ All other LEDs turn off
   - ✅ Message in Serial Monitor:

```
[0000089120] [INFO ] 🟢 PHASE 3: Repair COMPLETED
[0000089121] [INFO ]    → Lifecycle: RESOLVED
[0000089122] [INFO ]    → Backend will calculate MTTR (total time)
[0000089130] [INFO ] 🟢 MODE: OPERATIONAL (LED GREEN ON)
[0000089160] [INFO ] ✅ Alert Normal operation | Phase: resolved
[0000089161] [INFO ]    📍 PHASE 3 sent: Repair completed
```

3. Check **Backend Logs**:
   - `✅ Phase RESOLVED: Repair completed`
   - `⏱️ Repair time: 43.45 minutes`
   - `⏱️ MTTR (total downtime): 77.00 minutes`

4. Check database:

```sql
SELECT 
  lifecycle_phase,
  date_panne,
  date_arrivee_technicien,
  date_reparation,
  temps_reaction_minutes,
  temps_reparation_minutes,
  temps_total_arret_minutes
FROM downtime_logs 
ORDER BY id DESC LIMIT 1;

-- lifecycle_phase = 'resolved'
-- date_reparation = NOW()
-- temps_reaction_minutes = 33.55 (example)
-- temps_reparation_minutes = 43.45 (example)
-- temps_total_arret_minutes = 77.00 (MTTR)
```

---

## 🧪 Test Other Buttons (Optional)

### 🟡 BREAK Button
```
Press BTN_BREAK (PIN 27)
→ Yellow LED lights up (PIN 17)
→ Backend: lifecycle_phase = 'detected' (not full lifecycle)
```

### 🟠 MATERIAL Button
```
Press BTN_MATERIAL (PIN 26)
→ Orange LED lights up (PIN 4)
→ Backend: lifecycle_phase = 'detected'
```

---

## 📊 Verify KPIs in Dashboard

### Open `dashboard.html`:

1. Navigate to **📊 KPIs** section
2. You should see:

```
📊 Key Performance Indicators (KPIs)

🕒 MTTA (Mean Response Time)
   33.55 minutes

🔧 MTTR (Mean Repair Time)
   77.00 minutes

⚡ Availability Rate
   94.5%
```

---

## 🎯 Success Criteria

### ✅ Successful test if:

1. **Compilation**: No errors in Wokwi
2. **WiFi**: Successful connection (IP address shown)
3. **MQTT**: Successful connection (broker.hivemq.com)
4. **Phase 1**: Red button → Red LED + MQTT message
5. **Phase 2**: Blue button → Blue LED + MTTA calculation
6. **Phase 3**: Green button → Green LED + MTTR calculation
7. **Database**: All fields saved correctly
8. **Logs**: Clear messages in Serial Monitor

---

## 🐛 Troubleshooting

### Problem: "Error: MQTT_KEEPALIVE redefinition"
**Solution**: ✅ Fixed! We use `MQTT_KEEPALIVE_SEC` instead of `MQTT_KEEPALIVE`

### Problem: "Conversion from __FlashStringHelper*"
**Solution**: ✅ Fixed! We separated all string concatenations

### Problem: WiFi won't connect
**Solution**: In Wokwi, WiFi works automatically with `Wokwi-GUEST`

### Problem: MQTT won't connect
**Solution**: Check:
- Is `broker.hivemq.com` available?
- Is Port 1883 open?

### Problem: Buttons don't work
**Solution**: Check:
- Was `diagram.json` uploaded?
- Are connections correct in simulation?

---

## 📁 Required Files

### In Wokwi:
```
wifi-scan.ino         → Complete ESP32 code
diagram.json          → Circuit connections
libraries.txt         → PubSubClient, MFRC522
```

### On Railway (Backend):
```
mqtt-bridge.js        → 3 handlers (DETECTED, ACKNOWLEDGED, RESOLVED)
server.js             → REST API
```

### Database (PostgreSQL):
```sql
Table: downtime_logs
Columns:
  - lifecycle_phase VARCHAR (detected/acknowledged/resolved)
  - date_panne TIMESTAMP
  - date_arrivee_technicien TIMESTAMP
  - date_reparation TIMESTAMP
  - temps_reaction_minutes DECIMAL
  - temps_reparation_minutes DECIMAL
  - temps_total_arret_minutes DECIMAL
```

---

## 🎓 Important Notes

### Why 3 buttons instead of manual forms?
- ✅ **Higher accuracy**: automatic timestamp on button press
- ✅ **Easier**: no need for manual data entry
- ✅ **Reliable**: no network delay or human error

### Can I use `technicien.html` form?
- ❌ **Not recommended**: manual input less accurate
- ✅ **Alternative**: Use buttons + RFID to identify technician

### How are KPIs calculated?
- Backend calculates **automatically** using SQL `EXTRACT(EPOCH FROM (...))`
- No need for client-side calculations
- Results stored in database

---

## 🚀 Next Steps

1. ✅ **Test on Wokwi** (simulation)
2. ⏳ **Test on real ESP32** (hardware)
3. ⏳ **Integrate with RFID** (identify operator/technician)
4. ⏳ **Add dashboard** (charts in dashboard.html)
5. ⏳ **Export reports** (Excel/PDF)

---

## 📞 For Help

If you encounter any issues:
1. Check **Serial Monitor** in Wokwi
2. Review **Backend Logs** on Railway
3. Check **Database** using SQL queries above

---

## ✅ Final Result

Complete Andon system with:
- ✅ 3 automatic lifecycle phases
- ✅ Automatic MTTA and MTTR calculation
- ✅ No compilation errors
- ✅ GPIO pins unchanged (100% compatible)
- ✅ Professional code with FSM and Watchdog

**🎉 Ready for testing!**
