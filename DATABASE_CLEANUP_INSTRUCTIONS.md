# 🎯 Database Cleanup Instructions - Railway PostgreSQL

## ✅ Completed Automatically

✅ Created SQL cleanup script: `cleanup-columns.sql`  
✅ Updated `server.js` (removed old columns from Migrations)  
✅ Git commit and push  
✅ Complete documentation in `DATABASE_CLEANUP_SUMMARY.md`  

---

## 🚀 Final Step: Execute Script on Railway

### Method 1️⃣: Railway Dashboard (Easy)

1. **Open Railway Dashboard:**
   ```
   https://railway.app/
   ```

2. **Go to your project → PostgreSQL Plugin**

3. **Click "Connect" → Select "pgAdmin"**

4. **In pgAdmin:**
   - Right-click on the database
   - Select "Query Tool"
   
5. **Copy file contents:**
   ```
   C:\Users\aissa\OneDrive\Desktop\PFE_AISSAM\mysiteweb\cleanup-columns.sql
   ```

6. **Paste in Query Tool and click ⚡ Execute**

7. **Wait for message:**
   ```
   ✅ Successfully deleted 5 old columns!
   ✅ Remaining columns: 30
   ```

---

### Method 2️⃣: Railway CLI (Advanced)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link project
railway link

# Connect to PostgreSQL
railway connect postgres

# Execute script
\i cleanup-columns.sql

# Exit
\q
```

---

## 📊 Verify Success

After executing the script, run this in Query Tool:

```sql
-- Column count (should be 30)
SELECT COUNT(*) as total_columns 
FROM information_schema.columns 
WHERE table_name = 'downtime_logs';

-- Display remaining columns
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'downtime_logs'
ORDER BY ordinal_position;
```

**Expected result:**
```
total_columns
--------------
30
```

---

## ✅ Columns to be Deleted

| # | Column | Reason |
|---|--------|--------|
| 1 | `log_id` | Old, unused, we have `id` |
| 2 | `start_time` | Old, we have `heure_panne` |
| 3 | `duration` | Duplicate, we have `temps_total_arret_minutes` |
| 4 | `heure_arret_technicien` | Duplicate, we have `heure_arrivee` |
| 5 | `type` | 100% duplicate, we have `alert_type` |

---

## ✅ Columns that will Remain (30 columns)

### Important for Thesis:
✅ `id`, `machine`, `atelier`, `zone`  
✅ `operator`, `technician`, `resolved_by`  
✅ `status`, `alert_type`, `criticite`, `lifecycle_phase`  
✅ `date_panne`, `date_arrivee_technicien`, `date_reparation`  
✅ `temps_reaction_minutes` (MTTA)  
✅ `temps_reparation_minutes`  
✅ `temps_total_arret_minutes` (MTTR)  
✅ `breakdown_category`, `root_cause`, `actions_taken`  

---

## 🔄 Rollback (In Case of Issues)

The script automatically saves a backup in:
```
downtime_logs_backup_20260717
```

To restore data:
```sql
DROP TABLE downtime_logs;
ALTER TABLE downtime_logs_backup_20260717 RENAME TO downtime_logs;
```

---

## 🎯 After Execution

### What to do:

1. ✅ **Update Dashboard:**
   - Open: `https://mysiteweb-production.up.railway.app/dashboard`
   - Verify everything works
   - KPIs display (MTTR, MTTA)

2. ✅ **Test API:**
   ```bash
   curl https://mysiteweb-production.up.railway.app/api/stats
   ```
   - Should return MTTR ≠ "N/A"

3. ✅ **Test Data Generator:**
   ```bash
   curl https://mysiteweb-production.up.railway.app/api/factory/status
   ```
   - Should show 5-20 non-operational

---

## 📱 What NOT to Do

❌ **Do not delete** the Backup (`downtime_logs_backup_20260717`)  
❌ **Do not modify** remaining columns manually  
❌ **Do not execute** twice (causes errors)  

---

## ✅ Summary

After executing the script:
- ✅ 30 clean columns (instead of 35)
- ✅ No duplicate columns
- ✅ Dashboard operates more efficiently
- ✅ Accurate KPIs (MTTR/MTTA)
- ✅ Ready for Master's thesis 🎓

---

## 🆘 Support

If any issues occur:
1. Verify backup exists
2. Restore data (Rollback)
3. Review `DATABASE_CLEANUP_SUMMARY.md`

**Status:** Ready to execute ✅
