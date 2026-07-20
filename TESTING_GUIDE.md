# 🧪 Testing Guide - Andon System

**Date:** 2026-07-17  
**Status:** ✅ **Ready for Testing**

---

## 🎯 **Testing Objectives:**

Verify that:
1. ✅ **Data Generator** creates random breakdowns for simulated machines (KB, KC, KD, KX)
2. ✅ **KA01 is protected** - Data Generator never touches it
3. ✅ **MQTT** receives KA01 data from Wokwi only
4. ✅ **Dashboard** displays correct status for all machines

---

## 📝 **Testing Steps:**

### **Step 1: Trigger Data Generator Manually**

```bash
# Use Postman, curl, or PowerShell:
POST https://mysiteweb-production.up.railway.app/api/data-generator/trigger

# Expected result:
{
  "success": true,
  "message": "Data generation triggered successfully"
}
```

**Or from PowerShell:**
```powershell
Invoke-RestMethod -Uri "https://mysiteweb-production.up.railway.app/api/data-generator/trigger" -Method POST
```

---

### **Step 2: Wait 10 Seconds**

Data Generator needs a few seconds to:
- Check current number of broken machines
- Create 5-20 new breakdowns
- Register them in PostgreSQL
- Send Socket.IO events

```bash
# Wait...
⏳ 10 seconds
```

---

### **Step 3: Check Database**

#### **a) Check active breakdowns (unresolved):**

```sql
-- In pgAdmin or via API
SELECT 
  machine, 
  status, 
  alert_type,
  breakdown_category,
  criticite,
  technician,
  created_at
FROM downtime_logs
WHERE status NOT IN ('Termine', 'Resolved', 'Completed', 'resolved', 'termine', 'completed')
  AND machine != 'KA01'
  AND date_panne >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 30;
```

**Expected result:**
- ✅ Should find **5-20 rows** from simulated machines (KB, KC, KD, KX)
- ✅ **No KA01** in the list
- ✅ `status` should be `'Pending'` or `'In Progress'`
- ✅ `breakdown_category` filled (Electrical, Mechanical, Hydraulic...)
- ✅ `technician` filled (Ahmed Benali, Karim Fassi...)

#### **b) Check machines table:**

```sql
SELECT 
  machine, 
  status, 
  alert_type,
  last_alert_at,
  updated_at
FROM machines
WHERE machine != 'KA01'
  AND status != 'operational'
ORDER BY updated_at DESC
LIMIT 20;
```

**Expected result:**
- ✅ Same machines from previous query
- ✅ `status` = 'downtime' or 'maintenance'
- ✅ `alert_type` filled

---

### **Step 4: Open Dashboard**

Open browser and navigate to:
```
https://mysiteweb-production.up.railway.app/
```

#### **What you should see:**

**A) Machine Cards:**

```
┌───────────────────┐
│  KA01             │  ✅ Green (Operational) unless Wokwi sends downtime status
│  Operational      │
│  ⚪ 00:00         │
└───────────────────┘

┌───────────────────┐
│  KB03             │  ✅ Red (Downtime)
│  Downtime         │
│  (Electrical)     │
│  🔴 05:32         │  ← Timer running!
└───────────────────┘

┌───────────────────┐
│  KC07             │  ✅ Blue (Maintenance)
│  Maintenance      │
│  (Hydraulic)      │
│  🔵 02:15         │
└───────────────────┘

┌───────────────────┐
│  KD05             │  ✅ Orange (Material)
│  Material         │
│  (Material Wait)  │
│  🟠 00:45         │
└───────────────────┘
```

**B) KPIs:**
- ✅ **Total Machines**: 61 (or number of existing machines)
- ✅ **Non-Operational**: 5-20 (number of active breakdowns)
- ✅ **Operational %**: 55-88% (depending on count)
- ✅ **MTTR**: Average repair time in minutes
- ✅ **MTTA**: Average response time

**C) Auto-refresh:**
- ✅ Dashboard refreshes every **5 seconds** automatically
- ✅ Timer on each machine card increments (00:00 → 00:01 → 00:02...)
- ✅ Socket.IO sends immediate updates when changes occur

---

### **Step 5: Test KA01 (Wokwi)**

#### **a) Open Wokwi Simulator:**
```
https://wokwi.com/projects/<your-project-id>
```

#### **b) Send Downtime status:**
```cpp
// In sketch.ino:
// Press Button (GPIO 12)
// ESP32 will send:
mqtt.publish("factory/ligne1/andon/alert", {
  "machine_id": "KA01",
  "status": "DOWNTIME",
  "type": "Electrical",
  "lifecycle_phase": "detected"
});
```

#### **c) Watch Dashboard:**
```
After 1-2 seconds:

┌───────────────────┐
│  KA01             │  ✅ Turned red!
│  Downtime         │
│  (Electrical)     │
│  🔴 00:05         │  ← Timer started!
└───────────────────┘
```

#### **d) Resolve breakdown:**
```cpp
// Press Button again (or send Resolved)
mqtt.publish("factory/ligne1/andon/alert", {
  "machine_id": "KA01",
  "status": "RESOLVED",
  "lifecycle_phase": "resolved"
});
```

#### **e) Watch Dashboard:**
```
After 1-2 seconds:

┌───────────────────┐
│  KA01             │  ✅ Back to green!
│  Operational      │
│  ⚪ 00:00         │
└───────────────────┘
```

---

### **Step 6: Verify KA01 is Protected**

#### **a) Check database:**

```sql
-- Verify Data Generator didn't create breakdowns for KA01
SELECT * 
FROM downtime_logs 
WHERE machine = 'KA01' 
  AND breakdown_category IN ('Electrical', 'Mechanical', 'Hydraulic', 'Pneumatic', 'Lubrication')
  AND created_at >= NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

**Expected result:**
- ✅ **0 rows** - no records from Data Generator for KA01
- Or only old records from Wokwi (before 1 hour ago)

#### **b) Check Log Files (Railway):**

```bash
# In Railway Dashboard -> Logs
# Search for:
[DATA-GEN] ✅ Inserted realistic breakdown - KB03 | Electrical | High
[DATA-GEN] ✅ Inserted realistic breakdown - KC07 | Hydraulic | Medium
[DATA-GEN] ✅ Inserted realistic breakdown - KD05 | Pneumatic | Low

# Make sure you DON'T find:
[DATA-GEN] ✅ Inserted realistic breakdown - KA01 | ...  ← ❌ Should NOT exist!
```

---

## 🔧 **Advanced Tests:**

### **Test 1: Data Generator Every 5 Minutes**

Data Generator runs automatically every **5 minutes**. To test:

1. Open Dashboard at **14:00**
2. Note active breakdown count: e.g., **12 machines**
3. Wait until **14:05**
4. **F5** (Refresh Dashboard)
5. Count should change: e.g., **8 machines** (4 resolved, 0 new created)

---

### **Test 2: Auto-balance (5-20 machines)**

Data Generator maintains **5-20 broken machines** at any time:

```sql
-- Run this query every 5 minutes:
SELECT COUNT(DISTINCT machine) as non_operational
FROM downtime_logs
WHERE status NOT IN ('Termine', 'Resolved', 'Completed')
  AND machine != 'KA01'
  AND date_panne >= NOW() - INTERVAL '24 hours';
```

**Expected result:**
- ✅ Count should always be **between 5 and 20**
- If < 5 → Data Generator creates new breakdowns
- If > 20 → Data Generator resolves oldest breakdowns

---

### **Test 3: Socket.IO Real-time**

Open **Console** in browser (F12):

```javascript
// You should see:
[Socket.IO] Connected to server
[Socket.IO] Received: machineStatusChanged {
  machine: "KB03",
  status: "downtime",
  alert_type: "Electrical",
  source: "data_generator"  ← ✅ From Data Generator
}

// When changing KA01 from Wokwi:
[Socket.IO] Received: machineStatusChanged {
  machine: "KA01",
  status: "downtime",
  alert_type: "Electrical",
  source: "mqtt_bridge"  ← ✅ From MQTT Bridge
}
```

---

## ✅ **Success Criteria:**

| **Criterion** | **Status** | **How to Verify** |
|--------------|-----------|-------------------|
| Data Generator creates breakdowns for simulated machines | ✅ | SQL: `SELECT COUNT(*) FROM downtime_logs WHERE machine LIKE 'K%' AND machine != 'KA01'` ≥ 5 |
| KA01 not in Data Generator | ✅ | SQL: `SELECT * FROM downtime_logs WHERE machine='KA01' AND breakdown_category IS NOT NULL` = 0 |
| MQTT logs KA01 data | ✅ | Change Wokwi status → Dashboard updates immediately |
| Dashboard shows 5-20 broken machines | ✅ | Open `/` → count red/blue/orange cards |
| Timer works on each card | ✅ | Watch cards → timer increments every second |
| Socket.IO sends immediate updates | ✅ | F12 Console → `[Socket.IO] Received: machineStatusChanged` |

---

## 🐛 **Troubleshooting:**

### **Issue 1: Dashboard shows all machines green**

**Possible cause:**
- Data Generator hasn't created breakdowns yet (first 5 minutes)
- Or old breakdowns were resolved automatically

**Solution:**
```bash
# Trigger Data Generator manually:
POST /api/data-generator/trigger

# Wait 10 seconds then Refresh Dashboard
```

---

### **Issue 2: KA01 appears in generated breakdowns list**

**Possible cause:**
- Code error (should not happen!)

**Verification:**
```sql
SELECT machine, breakdown_category, created_at
FROM downtime_logs
WHERE machine = 'KA01'
  AND breakdown_category IN ('Electrical', 'Mechanical', 'Hydraulic')
ORDER BY created_at DESC;
```

**If results found:**
```bash
# Check data-generator.js line 26
# Make sure ALL_MACHINES doesn't contain 'KA01'
```

---

### **Issue 3: MQTT doesn't log KA01 data**

**Possible cause:**
- Wokwi didn't send MQTT messages
- MQTT Bridge not connected

**Verification:**
```bash
# In Railway Logs:
# Search for:
✅ MQTT BRIDGE CONNECTED
✅ Subscribed: factory/ligne1/andon/alert (QoS 1)

# If not found:
# Check MQTT_URL in Environment Variables
```

---

### **Issue 4: Dashboard doesn't auto-refresh**

**Possible cause:**
- Socket.IO not connected
- Or JavaScript error in Console

**Verification:**
```javascript
// F12 Console:
// Should see:
[Socket.IO] Connected to server

// If not found:
// Check server.js → Socket.IO initialization
```

---

## 📊 **Summary:**

**System works correctly if:**

1. ✅ Data Generator creates 5-20 breakdowns every 5 minutes
2. ✅ KA01 **is never touched** by Data Generator
3. ✅ MQTT receives KA01 data from Wokwi immediately
4. ✅ Dashboard displays real status for all machines
5. ✅ Socket.IO sends immediate updates
6. ✅ Timer works on each machine card

---

**Last Updated:** 2026-07-17  
**Status:** ✅ **Ready for Testing**  
**Prepared by:** Professional Development Team
