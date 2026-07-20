-- ═══════════════════════════════════════════════════════════════════
-- CLEANUP SCRIPT: Remove empty and old columns from downtime_logs
-- Railway PostgreSQL
-- ═══════════════════════════════════════════════════════════════════

-- STEP 1: BACKUP (Create backup copy)
-- ═══════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS downtime_logs_backup_20260717;
CREATE TABLE downtime_logs_backup_20260717 AS 
SELECT * FROM downtime_logs;

SELECT 
  '✅ BACKUP créé: ' || COUNT(*) || ' lignes sauvegardées' as message
FROM downtime_logs_backup_20260717;


-- STEP 2: Delete old and duplicate columns
-- ═══════════════════════════════════════════════════════════════════

-- ❌ log_id: Old, we have id
ALTER TABLE downtime_logs DROP COLUMN IF EXISTS log_id CASCADE;

-- ❌ start_time: Old, we have heure_panne
ALTER TABLE downtime_logs DROP COLUMN IF EXISTS start_time CASCADE;

-- ❌ duration: Duplicate, we have temps_total_arret_minutes
ALTER TABLE downtime_logs DROP COLUMN IF EXISTS duration CASCADE;

-- ❌ heure_arret_technicien: Duplicate, we have heure_arrivee
ALTER TABLE downtime_logs DROP COLUMN IF EXISTS heure_arret_technicien CASCADE;

-- ❌ type: 100% duplicate, we have alert_type
ALTER TABLE downtime_logs DROP COLUMN IF EXISTS type CASCADE;

SELECT '✅ Successfully deleted 5 old columns!' as message;


-- STEP 3: Verify remaining columns
-- ═══════════════════════════════════════════════════════════════════
SELECT 
  '✅ Remaining columns count: ' || COUNT(*) as summary
FROM information_schema.columns
WHERE table_name = 'downtime_logs';

-- Display remaining columns
SELECT 
  ordinal_position as "#",
  column_name as "Column",
  data_type as "Type",
  CASE 
    WHEN is_nullable = 'YES' THEN '✓'
    ELSE '✗'
  END as "NULL?"
FROM information_schema.columns
WHERE table_name = 'downtime_logs'
ORDER BY ordinal_position;


-- STEP 4: Statistics for remaining empty columns
-- ═══════════════════════════════════════════════════════════════════
SELECT 
  COUNT(*) FILTER (WHERE operator IS NULL) as "operator_empty",
  COUNT(*) FILTER (WHERE technician IS NULL) as "technician_empty",
  COUNT(*) FILTER (WHERE breakdown_category IS NULL) as "breakdown_category_empty",
  COUNT(*) FILTER (WHERE root_cause IS NULL) as "root_cause_empty",
  COUNT(*) FILTER (WHERE actions_taken IS NULL) as "actions_taken_empty",
  COUNT(*) FILTER (WHERE temps_reaction_minutes IS NULL) as "temps_reaction_empty",
  COUNT(*) FILTER (WHERE temps_reparation_minutes IS NULL) as "temps_reparation_empty",
  COUNT(*) FILTER (WHERE temps_total_arret_minutes IS NULL) as "temps_total_empty",
  COUNT(*) as "total"
FROM downtime_logs;


-- STEP 5: Success message
-- ═══════════════════════════════════════════════════════════════════
SELECT '
═══════════════════════════════════════════════════════════════════
  ✅ Successfully cleaned downtime_logs table!
═══════════════════════════════════════════════════════════════════
  Deleted columns (5):
    ❌ log_id
    ❌ start_time
    ❌ duration
    ❌ heure_arret_technicien
    ❌ type
  
  Remaining columns: 30 clean columns
  
  Backup: downtime_logs_backup_20260717
═══════════════════════════════════════════════════════════════════
' as "🎉 Result";
