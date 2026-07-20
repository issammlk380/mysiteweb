-- ═══════════════════════════════════════════════════════════════════
-- FINAL VERIFICATION: Final Data Verification
-- Railway PostgreSQL → Dashboard
-- ═══════════════════════════════════════════════════════════════════

-- STEP 1: Display 10 complete records for verification
-- ═══════════════════════════════════════════════════════════════════
SELECT 
  id,
  machine,
  status,
  breakdown_category,      -- ✅ Should appear in Dashboard → BREAKDOWN TYPE
  root_cause,              -- ✅ Details
  technician,              -- ✅ Should appear in Dashboard → TECHNICIAN
  date_panne,              -- ✅ Breakdown date
  heure_panne,             -- ✅ Breakdown time
  date_arrivee_technicien, -- ✅ Technician arrival date
  heure_arrivee,           -- ✅ Should appear in Dashboard → ARR.TECH
  date_reparation,         -- ✅ Repair completion date
  heure_reparation,        -- ✅ Repair completion time
  temps_reaction_minutes,  -- ✅ Should appear in Dashboard → WAIT TIME
  temps_reparation_minutes,-- ✅ Should appear in Dashboard → REPAIR TIME
  temps_total_arret_minutes,-- ✅ Total downtime
  criticite,               -- ✅ Should appear in Dashboard → CRITICALITY
  actions_taken,           -- ✅ Actions taken
  spare_parts_used         -- ✅ Spare parts used
FROM downtime_logs
WHERE status = 'Résolu'
ORDER BY id DESC
LIMIT 10;


-- STEP 2: Quick statistics
-- ═══════════════════════════════════════════════════════════════════
SELECT 
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE status = 'Résolu') as resolved,
  COUNT(*) FILTER (WHERE status = 'En attente') as pending,
  COUNT(*) FILTER (WHERE breakdown_category IS NOT NULL AND breakdown_category != '') as has_breakdown,
  COUNT(*) FILTER (WHERE root_cause IS NOT NULL AND root_cause != '') as has_root_cause,
  COUNT(*) FILTER (WHERE technician IS NOT NULL AND technician != '') as has_technician,
  COUNT(*) FILTER (WHERE heure_arrivee IS NOT NULL AND heure_arrivee != '') as has_heure_arrivee,
  COUNT(*) FILTER (WHERE temps_reaction_minutes IS NOT NULL AND temps_reaction_minutes > 0) as has_temps_reaction,
  COUNT(*) FILTER (WHERE temps_reparation_minutes IS NOT NULL AND temps_reparation_minutes > 0) as has_temps_reparation
FROM downtime_logs;


-- STEP 3: Check empty fields
-- ═══════════════════════════════════════════════════════════════════
SELECT 
  COUNT(*) FILTER (WHERE breakdown_category IS NULL OR breakdown_category = '') as null_breakdown,
  COUNT(*) FILTER (WHERE root_cause IS NULL OR root_cause = '') as null_root_cause,
  COUNT(*) FILTER (WHERE technician IS NULL OR technician = '') as null_technician,
  COUNT(*) FILTER (WHERE heure_panne IS NULL OR heure_panne = '') as null_heure_panne,
  COUNT(*) FILTER (WHERE heure_arrivee IS NULL OR heure_arrivee = '') as null_heure_arrivee,
  COUNT(*) FILTER (WHERE heure_reparation IS NULL OR heure_reparation = '') as null_heure_reparation,
  COUNT(*) FILTER (WHERE temps_reaction_minutes IS NULL) as null_temps_reaction,
  COUNT(*) FILTER (WHERE temps_reparation_minutes IS NULL) as null_temps_reparation,
  COUNT(*) as total
FROM downtime_logs;


-- STEP 4: Display one example per machine
-- ═══════════════════════════════════════════════════════════════════
SELECT DISTINCT ON (machine)
  machine,
  breakdown_category,
  root_cause,
  technician,
  heure_arrivee,
  temps_reaction_minutes,
  temps_reparation_minutes
FROM downtime_logs
WHERE status = 'Résolu'
ORDER BY machine, id DESC;


-- ═══════════════════════════════════════════════════════════════════
-- RÉSUMÉ
-- ═══════════════════════════════════════════════════════════════════
SELECT '
✅ SUMMARY:
   - If "has_breakdown" = total → breakdown_category 100% filled
   - If "has_heure_arrivee" = total → heure_arrivee 100% filled
   - If "has_temps_reaction" = total → temps_reaction_minutes 100% filled
   - If "has_temps_reparation" = total → temps_reparation_minutes 100% filled
   
🎯 Expected result:
   - All records should be filled (null_* = 0)
   - Dashboard will display data completely
   
🚀 Next step:
   - Open Dashboard: https://mysiteweb-production.up.railway.app/dashboard.html
   - Press F5 (Refresh)
   - View data in table
' as message;
