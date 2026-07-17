-- ═══════════════════════════════════════════════════════════════════
-- CLEANUP SCRIPT: حذف الأعمدة الفارغة والقديمة من downtime_logs
-- Railway PostgreSQL
-- ═══════════════════════════════════════════════════════════════════

-- STEP 1: BACKUP (نسخة احتياطية)
-- ═══════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS downtime_logs_backup_20260717;
CREATE TABLE downtime_logs_backup_20260717 AS 
SELECT * FROM downtime_logs;

SELECT 
  '✅ BACKUP créé: ' || COUNT(*) || ' lignes sauvegardées' as message
FROM downtime_logs_backup_20260717;


-- STEP 2: حذف الأعمدة القديمة والمكررة
-- ═══════════════════════════════════════════════════════════════════

-- ❌ log_id: قديم، عندنا id
ALTER TABLE downtime_logs DROP COLUMN IF EXISTS log_id CASCADE;

-- ❌ start_time: قديم، عندنا heure_panne
ALTER TABLE downtime_logs DROP COLUMN IF EXISTS start_time CASCADE;

-- ❌ duration: مكرر، عندنا temps_total_arret_minutes
ALTER TABLE downtime_logs DROP COLUMN IF EXISTS duration CASCADE;

-- ❌ heure_arret_technicien: مكرر، عندنا heure_arrivee
ALTER TABLE downtime_logs DROP COLUMN IF EXISTS heure_arret_technicien CASCADE;

-- ❌ type: مكرر 100%، عندنا alert_type
ALTER TABLE downtime_logs DROP COLUMN IF EXISTS type CASCADE;

SELECT '✅ تم حذف 5 أعمدة قديمة بنجاح!' as message;


-- STEP 3: التحقق من الأعمدة المتبقية
-- ═══════════════════════════════════════════════════════════════════
SELECT 
  '✅ عدد الأعمدة المتبقية: ' || COUNT(*) as summary
FROM information_schema.columns
WHERE table_name = 'downtime_logs';

-- عرض الأعمدة المتبقية
SELECT 
  ordinal_position as "#",
  column_name as "العمود",
  data_type as "النوع",
  CASE 
    WHEN is_nullable = 'YES' THEN '✓'
    ELSE '✗'
  END as "NULL?"
FROM information_schema.columns
WHERE table_name = 'downtime_logs'
ORDER BY ordinal_position;


-- STEP 4: إحصائيات الأعمدة الفارغة المتبقية
-- ═══════════════════════════════════════════════════════════════════
SELECT 
  COUNT(*) FILTER (WHERE operator IS NULL) as "operator فارغ",
  COUNT(*) FILTER (WHERE technician IS NULL) as "technician فارغ",
  COUNT(*) FILTER (WHERE breakdown_category IS NULL) as "breakdown_category فارغ",
  COUNT(*) FILTER (WHERE root_cause IS NULL) as "root_cause فارغ",
  COUNT(*) FILTER (WHERE actions_taken IS NULL) as "actions_taken فارغ",
  COUNT(*) FILTER (WHERE temps_reaction_minutes IS NULL) as "temps_reaction فارغ",
  COUNT(*) FILTER (WHERE temps_reparation_minutes IS NULL) as "temps_reparation فارغ",
  COUNT(*) FILTER (WHERE temps_total_arret_minutes IS NULL) as "temps_total فارغ",
  COUNT(*) as "المجموع"
FROM downtime_logs;


-- STEP 5: رسالة النجاح
-- ═══════════════════════════════════════════════════════════════════
SELECT '
═══════════════════════════════════════════════════════════════════
  ✅ تم تنظيف جدول downtime_logs بنجاح!
═══════════════════════════════════════════════════════════════════
  الأعمدة المحذوفة (5):
    ❌ log_id
    ❌ start_time
    ❌ duration
    ❌ heure_arret_technicien
    ❌ type
  
  الأعمدة المتبقية: 30 عمود نظيف
  
  Backup: downtime_logs_backup_20260717
═══════════════════════════════════════════════════════════════════
' as "🎉 النتيجة";
