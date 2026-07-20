# 🤖 Data Generator Guide - Realistic Breakdown Simulator

## 🎯 **Objective:**

**Generate 5-20 machines in Downtime/Maintenance status realistically and randomly**

---

## 📋 **How It Works:**

### **1️⃣ Automatic Execution:**

Data Generator runs **automatically every 5 minutes**:

```javascript
// server.js (Line 1670-1690)
setInterval(async () => {
  console.log('[DATA-GEN] Running automatic generation...');
  await dataGenerator.generateRealisticBreakdowns();
}, 5 * 60 * 1000); // Every 5 minutes
```

---

### **2️⃣ Manual Trigger:**

**Via API:**

```powershell
# PowerShell
Invoke-RestMethod -Uri "https://mysiteweb-production.up.railway.app/api/data-generator/trigger" -Method POST
```

**Or in Browser (Console):**

```javascript
fetch('https://mysiteweb-production.up.railway.app/api/data-generator/trigger', {
  method: 'POST'
}).then(r => r.json()).then(console.log);
```

---

### **3️⃣ What Happens?**

**Data Generator performs:**

#### **a. Randomly selects 5-20 machines:**
```javascript
const targetBreakdowns = Math.floor(Math.random() * 16) + 5; // 5-20 machines
```

#### **b. Protects KA01 (real machine from Wokwi):**
```javascript
// ❌ KA01 is protected - Data Generator never touches it!
const protectedMachines = ['KA01'];
const availableMachines = allMachines.filter(m => !protectedMachines.includes(m));
```

#### **c. Generates realistic breakdowns:**

```sql
INSERT INTO downtime_logs (
  machine,              -- Example: KA03, KB05, KC12
  status,               -- "Pending" or "In Progress" or "Resolved"
  breakdown_category,   -- Electrical, Mechanical, Hydraulic, Pneumatic
  root_cause,           -- Faulty sensor, Belt misalignment, Oil leak...
  technician,           -- Youssef Amrani, Ahmed Benali, Karim Fathi...
  criticite,            -- High, Medium, Low
  date_panne,           -- Current timestamp
  heure_panne,          -- Current time
  temps_reaction_minutes,   -- 5-30 minutes
  temps_reparation_minutes, -- 15-120 minutes
  ...
)
```

---

## 🎬 **Scenarios:**

### **Scenario 1: Machine in "Pending" status (waiting for technician)**

```
KA03 → Downtime (Pending)
├─ breakdown_category: "Electrical"
├─ root_cause: "Faulty sensor"
├─ date_panne: "2026-07-17 14:52:00"
├─ heure_panne: "14:52"
├─ date_arrivee_technicien: NULL ← Technician hasn't arrived yet
├─ status: "Pending" ← Blue color in Andon
└─ criticite: "Medium"
```

---

### **Scenario 2: Machine in "In Progress" status (technician working)**

```
KB08 → Downtime (In Progress)
├─ breakdown_category: "Mechanical"
├─ root_cause: "Belt misalignment"
├─ date_panne: "2026-07-17 14:40:00"
├─ heure_panne: "14:40"
├─ date_arrivee_technicien: "2026-07-17 14:52:00" ← Technician arrived
├─ heure_arrivee: "14:52"
├─ temps_reaction_minutes: 12 ← Took 12 minutes to arrive
├─ status: "In Progress" ← Orange color in Andon
└─ technician: "Ahmed Benali"
```

---

### **Scenario 3: Machine repaired "Resolved"**

```
KC12 → Operational (Resolved)
├─ breakdown_category: "Hydraulic"
├─ root_cause: "Oil leak"
├─ date_panne: "2026-07-17 13:30:00"
├─ date_arrivee_technicien: "2026-07-17 13:45:00"
├─ date_reparation: "2026-07-17 14:30:00" ← Repaired
├─ heure_reparation: "14:30"
├─ temps_reaction_minutes: 15
├─ temps_reparation_minutes: 45
├─ temps_total_arret_minutes: 60 ← Total downtime
├─ status: "Resolved" ← Returned to green
└─ actions_taken: "Leak repair and pressure adjustment"
```

---

## 🎯 **Expected Result:**

### **After running Data Generator:**

```
ZONE KA:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ KA01: Downtime (Resolved) ← Real machine
🔴 KA03: Downtime (Pending) ← New
🟠 KA07: Downtime (In Progress) ← New
✅ KA02, KA04-KA06, KA08-KA15: Operational

ZONE KB:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 KB05: Downtime (Pending) ← New
🟠 KB09: Downtime (In Progress) ← New
🔴 KB12: Downtime (Pending) ← New
✅ KB01-KB04, KB06-KB08, KB10-KB11, KB13-KB15: Operational

ZONE KC:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🟠 KC03: Downtime (In Progress) ← New
🔴 KC08: Downtime (Pending) ← New
🔴 KC14: Downtime (Pending) ← New
🟠 KC17: Downtime (In Progress) ← New
✅ Remaining machines: Operational
```

---

## 🔄 **Lifecycle:**

```
1. Operational (Green) → Machine running normally
                ↓
2. Downtime (Pending) (Blue) → Breakdown declared, waiting for technician
                ↓
3. Downtime (In Progress) (Orange) → Technician arrived and working
                ↓
4. Downtime (Resolved) → Repaired, record updated
                ↓
5. Operational (Green) → Back to work
```

---

## 📊 **Affected KPIs:**

### **MTTR (Mean Time To Repair):**
```
Average repair time = (Sum temps_reparation_minutes) / (Number of resolved breakdowns)
```

### **MTBF (Mean Time Between Failures):**
```
Average time between failures = (Total uptime) / (Number of breakdowns)
```

### **Availability:**
```
Availability = ((Total time - Downtime) / Total time) × 100%
```

---

## 🎯 **How to Test Data Generator?**

### **1️⃣ Run it manually:**

```powershell
Invoke-RestMethod -Uri "https://mysiteweb-production.up.railway.app/api/data-generator/trigger" -Method POST
```

### **2️⃣ Wait 30-60 seconds**

### **3️⃣ Open Andon System:**

```
https://mysiteweb-production.up.railway.app/
```

### **4️⃣ Observe changes:**
- ✅ You should see 5-20 machines in **Downtime** status (red/orange/blue colors)
- ✅ KA01 is protected (state only changes from Wokwi)
- ✅ Remaining machines **Operational** (green)

---

## 🔒 **KA01 Protection:**

```javascript
// In data-generator.js:
const PROTECTED_MACHINES = ['KA01']; // ← Real machine from Wokwi

// ❌ Data Generator never touches it!
if (PROTECTED_MACHINES.includes(machine)) {
  console.log(`⚠️ Skipping ${machine} (protected)`);
  continue;
}
```

---

## 📝 **Summary:**

| Feature | Description |
|---------|-------------|
| **Automatic Execution** | Every 5 minutes |
| **Manual Trigger** | Via `/api/data-generator/trigger` |
| **Breakdown Count** | 5-20 machines randomly |
| **KA01 Protection** | ✅ Protected (never touched) |
| **Scenarios** | Pending, In Progress, Resolved |
| **Realism** | 100% (technician names, causes, times) |

---

**Now run Data Generator and watch breakdowns appear in Andon System!** 🚀
