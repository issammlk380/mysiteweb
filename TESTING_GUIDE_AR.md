# 🧪 دليل الاختبار - Andon System

**تاريخ:** 2026-07-17  
**الحالة:** ✅ **جاهز للاختبار**

---

## 🎯 **الهدف من الاختبار:**

التأكد من أن:
1. ✅ **Data Generator** ينشئ أعطال عشوائية للماكينات المُحاكية (KB, KC, KD, KX)
2. ✅ **KA01 محمية** - لا يلمسها Data Generator أبداً
3. ✅ **MQTT** يستقبل بيانات KA01 من Wokwi فقط
4. ✅ **Dashboard** يعرض الحالة الصحيحة لجميع الماكينات

---

## 📝 **خطوات الاختبار:**

### **الخطوة 1: تفعيل Data Generator يدوياً**

```bash
# استخدم Postman أو curl أو PowerShell:
POST https://mysiteweb-production.up.railway.app/api/data-generator/trigger

# النتيجة المتوقعة:
{
  "success": true,
  "message": "Génération de données déclenchée avec succès"
}
```

**أو من PowerShell:**
```powershell
Invoke-RestMethod -Uri "https://mysiteweb-production.up.railway.app/api/data-generator/trigger" -Method POST
```

---

### **الخطوة 2: انتظر 10 ثوانٍ**

Data Generator يحتاج بضع ثوانٍ لـ:
- فحص عدد الماكينات المعطلة الحالي
- إنشاء 5-20 عطل جديد
- تسجيلها في PostgreSQL
- إرسال Socket.IO events

```bash
# انتظر...
⏳ 10 ثوانٍ
```

---

### **الخطوة 3: فحص قاعدة البيانات**

#### **أ) فحص عدد الأعطال النشطة (غير المحلولة):**

```sql
-- في pgAdmin أو من API
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

**النتيجة المتوقعة:**
- ✅ يجب أن تجد **5-20 سطر** من الماكينات المحاكية (KB, KC, KD, KX)
- ✅ **لا يوجد KA01** في القائمة
- ✅ `status` يجب أن يكون `'En attente'` أو `'En cours'`
- ✅ `breakdown_category` ممتلئ (Électrique, Mécanique, Hydraulique...)
- ✅ `technician` ممتلئ (Ahmed Benali, Karim Fassi...)

#### **ب) فحص جدول machines:**

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

**النتيجة المتوقعة:**
- ✅ نفس الماكينات من الاستعلام السابق
- ✅ `status` = 'downtime' أو 'maintenance'
- ✅ `alert_type` ممتلئ

---

### **الخطوة 4: فتح Dashboard**

افتح المتصفح واذهب إلى:
```
https://mysiteweb-production.up.railway.app/issam.html
```

#### **ما الذي يجب أن تراه:**

**A) بطاقات الماكينات (Machine Cards):**

```
┌───────────────────┐
│  KA01             │  ✅ أخضر (Operational) إلا إذا أرسل Wokwi حالة downtime
│  Operational      │
│  ⚪ 00:00         │
└───────────────────┘

┌───────────────────┐
│  KB03             │  ✅ أحمر (Downtime)
│  Downtime         │
│  (Électrique)     │
│  🔴 05:32         │  ← Timer يعمل!
└───────────────────┘

┌───────────────────┐
│  KC07             │  ✅ أزرق (Maintenance)
│  Maintenance      │
│  (Hydraulique)    │
│  🔵 02:15         │
└───────────────────┘

┌───────────────────┐
│  KD05             │  ✅ برتقالي (Material)
│  Material         │
│  (Manque Matériel)│
│  🟠 00:45         │
└───────────────────┘
```

**B) الـ KPIs:**
- ✅ **Total Machines**: 45 (أو عدد الماكينات الموجودة)
- ✅ **Non-Operational**: 5-20 (عدد الأعطال النشطة)
- ✅ **Operational %**: 55-88% (حسب العدد)
- ✅ **MTTR**: متوسط وقت الإصلاح بالدقائق
- ✅ **MTTA**: متوسط وقت الاستجابة

**C) التحديث التلقائي:**
- ✅ Dashboard يُحدّث كل **5 ثوانٍ** تلقائياً
- ✅ Timer على كل بطاقة ماكينة يزيد (00:00 → 00:01 → 00:02...)
- ✅ Socket.IO يُرسل تحديثات فورية عند حدوث تغييرات

---

### **الخطوة 5: اختبار KA01 (Wokwi)**

#### **أ) افتح Wokwi Simulator:**
```
https://wokwi.com/projects/<your-project-id>
```

#### **ب) أرسل حالة Downtime:**
```cpp
// في sketch.ino:
// اضغط على Button (GPIO 12)
// ESP32 سيُرسل:
mqtt.publish("factory/ligne1/andon/alert", {
  "machine_id": "KA01",
  "status": "DOWNTIME",
  "type": "Electrical",
  "lifecycle_phase": "detected"
});
```

#### **ج) راقب Dashboard:**
```
بعد 1-2 ثانية:

┌───────────────────┐
│  KA01             │  ✅ تحول إلى أحمر!
│  Downtime         │
│  (Electrical)     │
│  🔴 00:05         │  ← Timer يبدأ العد!
└───────────────────┘
```

#### **د) حل العطل:**
```cpp
// اضغط على Button مرة أخرى (أو أرسل Resolved)
mqtt.publish("factory/ligne1/andon/alert", {
  "machine_id": "KA01",
  "status": "RESOLVED",
  "lifecycle_phase": "resolved"
});
```

#### **هـ) راقب Dashboard:**
```
بعد 1-2 ثانية:

┌───────────────────┐
│  KA01             │  ✅ عاد إلى أخضر!
│  Operational      │
│  ⚪ 00:00         │
└───────────────────┘
```

---

### **الخطوة 6: التحقق من أن KA01 محمية**

#### **أ) فحص قاعدة البيانات:**

```sql
-- تأكد أن Data Generator لم يُنشئ أعطال لـ KA01
SELECT * 
FROM downtime_logs 
WHERE machine = 'KA01' 
  AND breakdown_category IN ('Électrique', 'Mécanique', 'Hydraulique', 'Pneumatique', 'Lubrification')
  AND created_at >= NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

**النتيجة المتوقعة:**
- ✅ **0 rows** - لا يوجد أي سجل من Data Generator لـ KA01
- أو سجلات قديمة فقط من Wokwi (قبل ساعة)

#### **ب) فحص الـ Log Files (Railway):**

```bash
# في Railway Dashboard -> Logs
# ابحث عن:
[DATA-GEN] ✅ Inserted realistic breakdown - KB03 | Électrique | Majeure
[DATA-GEN] ✅ Inserted realistic breakdown - KC07 | Hydraulique | Moderee
[DATA-GEN] ✅ Inserted realistic breakdown - KD05 | Pneumatique | Faible

# تأكد أنه لا يوجد:
[DATA-GEN] ✅ Inserted realistic breakdown - KA01 | ...  ← ❌ يجب ألا تجد هذا!
```

---

## 🔧 **الاختبارات المتقدمة:**

### **اختبار 1: Data Generator كل 5 دقائق**

Data Generator يعمل تلقائياً كل **5 دقائق**. لاختباره:

1. افتح Dashboard في **14:00**
2. لاحظ عدد الأعطال النشطة: مثلاً **12 ماكينة**
3. انتظر حتى **14:05**
4. **F5** (Refresh Dashboard)
5. العدد يجب أن يتغير: مثلاً **8 ماكينات** (حُلّت 4، أُنشئت 0 جديدة)

---

### **اختبار 2: التوازن التلقائي (5-20 machines)**

Data Generator يحافظ على **5-20 ماكينة معطلة** في أي وقت:

```sql
-- تشغيل هذا الاستعلام كل 5 دقائق:
SELECT COUNT(DISTINCT machine) as non_operational
FROM downtime_logs
WHERE status NOT IN ('Termine', 'Resolved', 'Completed')
  AND machine != 'KA01'
  AND date_panne >= NOW() - INTERVAL '24 hours';
```

**النتيجة المتوقعة:**
- ✅ العدد يجب أن يكون دائماً **بين 5 و 20**
- إذا < 5 → Data Generator يُنشئ أعطال جديدة
- إذا > 20 → Data Generator يحل الأعطال الأقدم

---

### **اختبار 3: Socket.IO Real-time**

افتح **Console** في المتصفح (F12):

```javascript
// يجب أن ترى:
[Socket.IO] Connected to server
[Socket.IO] Received: machineStatusChanged {
  machine: "KB03",
  status: "downtime",
  alert_type: "Électrique",
  source: "data_generator"  ← ✅ من Data Generator
}

// عند تغيير KA01 من Wokwi:
[Socket.IO] Received: machineStatusChanged {
  machine: "KA01",
  status: "downtime",
  alert_type: "Electrical",
  source: "mqtt_bridge"  ← ✅ من MQTT Bridge
}
```

---

## ✅ **معايير النجاح:**

| **المعيار** | **الحالة** | **كيفية التحقق** |
|------------|-----------|-----------------|
| Data Generator يُنشئ أعطال للماكينات المحاكية | ✅ | SQL: `SELECT COUNT(*) FROM downtime_logs WHERE machine LIKE 'K%' AND machine != 'KA01'` ≥ 5 |
| KA01 غير موجودة في Data Generator | ✅ | SQL: `SELECT * FROM downtime_logs WHERE machine='KA01' AND breakdown_category IS NOT NULL` = 0 |
| MQTT يُسجّل بيانات KA01 | ✅ | تغيير حالة Wokwi → Dashboard يتحدث فوراً |
| Dashboard يعرض 5-20 ماكينة معطلة | ✅ | فتح `/issam.html` → عدّ البطاقات الحمراء/الزرقاء/البرتقالية |
| Timer يعمل على كل بطاقة | ✅ | مراقبة البطاقات → Timer يزيد كل ثانية |
| Socket.IO يُرسل تحديثات فورية | ✅ | F12 Console → `[Socket.IO] Received: machineStatusChanged` |

---

## 🐛 **حل المشاكل (Troubleshooting):**

### **مشكلة 1: Dashboard يعرض كل الماكينات خضراء**

**السبب المحتمل:**
- Data Generator لم يُنشئ أعطال بعد (أول 5 دقائق)
- أو الأعطال القديمة تم حلها تلقائياً

**الحل:**
```bash
# فعّل Data Generator يدوياً:
POST /api/data-generator/trigger

# انتظر 10 ثوانٍ ثم Refresh Dashboard
```

---

### **مشكلة 2: KA01 تظهر في قائمة الأعطال المُولدة**

**السبب المحتمل:**
- خطأ في الكود (يجب ألا يحدث!)

**التحقق:**
```sql
SELECT machine, breakdown_category, created_at
FROM downtime_logs
WHERE machine = 'KA01'
  AND breakdown_category IN ('Électrique', 'Mécanique', 'Hydraulique')
ORDER BY created_at DESC;
```

**إذا وجدت نتائج:**
```bash
# راجع ملف data-generator.js السطر 26
# تأكد أن ALL_MACHINES لا تحتوي على 'KA01'
```

---

### **مشكلة 3: MQTT لا يُسجّل بيانات KA01**

**السبب المحتمل:**
- Wokwi لم يُرسل رسائل MQTT
- MQTT Bridge غير متصل

**التحقق:**
```bash
# في Railway Logs:
# ابحث عن:
✅ MQTT BRIDGE CONNECTÉ
✅ Subscribed: factory/ligne1/andon/alert (QoS 1)

# إذا لم تجد:
# تحقق من MQTT_URL في Environment Variables
```

---

### **مشكلة 4: Dashboard لا يتحدث تلقائياً**

**السبب المحتمل:**
- Socket.IO غير متصل
- أو JavaScript error في Console

**التحقق:**
```javascript
// F12 Console:
// يجب أن ترى:
[Socket.IO] Connected to server

// إذا لم تجد:
// تحقق من server.js → Socket.IO initialization
```

---

## 📊 **الخلاصة:**

**النظام يعمل بالشكل الصحيح إذا:**

1. ✅ Data Generator يُنشئ 5-20 عطل كل 5 دقائق
2. ✅ KA01 **لا تُمَس أبداً** من Data Generator
3. ✅ MQTT يستقبل بيانات KA01 من Wokwi فوراً
4. ✅ Dashboard يعرض الحالة الحقيقية لكل الماكينات
5. ✅ Socket.IO يُرسل تحديثات فورية
6. ✅ Timer يعمل على كل بطاقة ماكينة

---

**تاريخ آخر تحديث:** 2026-07-17  
**الحالة:** ✅ **Ready for Testing**  
**المُعَد بواسطة:** Kiro AI Assistant
