/**
 * ═══════════════════════════════════════════════════════════════════
 * DATA GENERATOR - Realistic Factory Simulation
 * ═══════════════════════════════════════════════════════════════════
 * 
 * Purpose: Generate realistic data for simulated machines (KB, KC, KD)
 *          while keeping KA01 (Wokwi) untouched
 * 
 * Rules:
 * - 5-20 machines non-operational at any time
 * - NO NULL values except rfid_uid, spare_parts_used, piece_observation
 * - Realistic timestamps, durations, operators, technicians
 * - Consistent data (arrival after breakdown, repair after arrival)
 * ═══════════════════════════════════════════════════════════════════
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

// All machines in factory (EXCEPT KA01 which is real Wokwi)
const ALL_MACHINES = [
  // Zone KA (except KA01)
  'KA02', 'KA03', 'KA04', 'KA05', 'KA06', 'KA07', 'KA08', 'KA09', 'KA10',
  // Zone KB
  'KB01', 'KB02', 'KB03', 'KB04', 'KB05', 'KB06', 'KB07', 'KB08', 'KB09', 'KB10',
  // Zone KC
  'KC01', 'KC02', 'KC03', 'KC04', 'KC05', 'KC06', 'KC07', 'KC08', 'KC09', 'KC10',
  // Zone KD
  'KD01', 'KD02', 'KD03', 'KD04', 'KD05', 'KD06', 'KD07', 'KD08', 'KD09', 'KD10',
  // Zone KX
  'KX01', 'KX02', 'KX03', 'KX04', 'KX05'
];

const OPERATORS = [
  'Op_0101', 'Op_0102', 'Op_0103', 'Op_0104', 'Op_0105',
  'Op_0201', 'Op_0202', 'Op_0203', 'Op_0204', 'Op_0205',
  'Op_0301', 'Op_0302', 'Op_0303', 'Op_0304', 'Op_0305'
];

const TECHNICIANS = [
  'Ahmed Benali', 'Karim Fassi', 'Youssef Amrani', 
  'Omar Alami', 'Hassan Idrissi', 'Mehdi Tazi',
  'Rachid Bennani', 'Samir Alaoui', 'Abdellah Brahim'
];

const BREAKDOWN_TYPES = {
  'Électrique': {
    criticite: ['Faible', 'Moderee', 'Majeure'],
    root_causes: [
      'Court-circuit sur capteur proximité',
      'Défaillance carte contrôle axe',
      'Surchauffe moteur électrique',
      'Câblage endommagé',
      'Capteur défectueux'
    ],
    actions: [
      'Remplacement capteur proximité',
      'Changement carte d\'axe',
      'Remplacement moteur',
      'Réparation câblage',
      'Calibration capteur'
    ],
    avg_duration: 45
  },
  'Mécanique': {
    criticite: ['Moderee', 'Majeure', 'Critique'],
    root_causes: [
      'Usure roulement à billes',
      'Désalignement axe principal',
      'Vibrations anormales',
      'Courroie usée',
      'Jeu mécanique excessif'
    ],
    actions: [
      'Remplacement roulement',
      'Réalignement mécanique',
      'Équilibrage rotor',
      'Changement courroie',
      'Ajustement jeu mécanique'
    ],
    avg_duration: 90
  },
  'Hydraulique': {
    criticite: ['Moderee', 'Majeure'],
    root_causes: [
      'Fuite circuit hydraulique',
      'Pression insuffisante',
      'Joint défectueux',
      'Vérin bloqué',
      'Huile contaminée'
    ],
    actions: [
      'Réparation fuite',
      'Ajustement pression',
      'Remplacement joint',
      'Déblocage vérin',
      'Vidange et remplissage huile'
    ],
    avg_duration: 60
  },
  'Pneumatique': {
    criticite: ['Faible', 'Moderee'],
    root_causes: [
      'Fuite air comprimé',
      'Electrovanne défectueuse',
      'Filtre à air colmaté',
      'Pression air instable',
      'Tuyauterie endommagée'
    ],
    actions: [
      'Réparation fuite pneumatique',
      'Remplacement electrovanne',
      'Changement filtre à air',
      'Régulation pression',
      'Remplacement tuyau'
    ],
    avg_duration: 30
  },
  'Lubrification': {
    criticite: ['Faible', 'Moderee'],
    root_causes: [
      'Manque de lubrifiant',
      'Lubrification insuffisante glissières',
      'Pompe lubrification HS',
      'Graisse durcie',
      'Circuit lubrification obstrué'
    ],
    actions: [
      'Appoint lubrifiant',
      'Lubrification complète glissières',
      'Remplacement pompe',
      'Nettoyage et regraissage',
      'Débouchage circuit'
    ],
    avg_duration: 15
  }
};

const STATUS_OPTIONS = ['downtime', 'maintenance', 'break', 'material'];

// ✅ Enhanced: Category labels for better logging
const STATUS_LABELS = {
  'downtime': 'Panne',
  'maintenance': 'Maintenance', 
  'break': 'Break (Micro-arrêt)',
  'material': 'Manque Matériel'
};

// Target: 5-20 machines in non-operational state
const MIN_NON_OPERATIONAL = 5;
const MAX_NON_OPERATIONAL = 20;

let poolRef = null;
let ioRef = null;
let isRunning = false;
let updateInterval = null;

// ═══════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(array) {
  return array[randomInt(0, array.length - 1)];
}

function deriveAtelier(machine) {
  if (!machine) return 'Atelier General';
  const prefix = String(machine).substring(0, 2).toUpperCase();
  const map = { 
    'KA': 'Atelier A', 
    'KB': 'Atelier B', 
    'KC': 'Atelier C', 
    'KD': 'Atelier D', 
    'KX': 'Atelier X' 
  };
  return map[prefix] || 'Atelier General';
}

function deriveZone(machine) {
  return String(machine).substring(0, 2).toUpperCase();
}

// Generate realistic timestamps
function generateBreakdownTimestamps() {
  const now = new Date();
  
  // Breakdown happened 30 min to 8 hours ago
  const minutesAgo = randomInt(30, 480);
  const datePanne = new Date(now.getTime() - minutesAgo * 60000);
  
  // Technician arrived 5-60 minutes after breakdown
  const reactionMinutes = randomInt(5, 60);
  const dateArrivee = new Date(datePanne.getTime() + reactionMinutes * 60000);
  
  // Repair duration: 10-120 minutes
  const repairMinutes = randomInt(10, 120);
  const dateReparation = new Date(dateArrivee.getTime() + repairMinutes * 60000);
  
  // Total downtime
  const totalMinutes = Math.floor((dateReparation - datePanne) / 60000);
  
  return {
    datePanne,
    dateArrivee,
    dateReparation,
    heurePanne: datePanne.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    heureArrivee: dateArrivee.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    heureReparation: dateReparation.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    tempsReaction: reactionMinutes,
    tempsReparation: repairMinutes,
    tempsTotal: totalMinutes,
    tempsIntervention: repairMinutes
  };
}

// Generate realistic breakdown data
function generateBreakdownData(machine, status) {
  const breakdownType = randomChoice(Object.keys(BREAKDOWN_TYPES));
  const typeData = BREAKDOWN_TYPES[breakdownType];
  
  const operator = randomChoice(OPERATORS);
  const technician = randomChoice(TECHNICIANS);
  const criticite = randomChoice(typeData.criticite);
  const rootCause = randomChoice(typeData.root_causes);
  const actionsTaken = randomChoice(typeData.actions);
  
  const timestamps = generateBreakdownTimestamps();
  
  const preventiveActions = [
    'Augmenter fréquence inspection',
    'Mettre en place maintenance préventive',
    'Former équipe sur nouveau protocole',
    'Commander pièces de rechange',
    'Installer système monitoring'
  ];
  
  return {
    machine,
    atelier: deriveAtelier(machine),
    zone: deriveZone(machine),
    operator,
    technician,
    status: mapStatusToDb(status),
    alert_type: breakdownType,
    criticite,
    breakdown_category: breakdownType,
    root_cause: rootCause,
    actions_taken: actionsTaken,
    preventive_actions: randomChoice(preventiveActions),
    resolved_by: technician,
    lifecycle_phase: status === 'downtime' ? 'detected' : 
                     status === 'maintenance' ? 'acknowledged' : 'in_progress',
    ...timestamps
  };
}

function mapStatusToDb(status) {
  const map = {
    'downtime': 'En attente',
    'maintenance': 'En cours',
    'break': 'En cours',
    'material': 'En attente'
  };
  return map[status] || 'En attente';
}

// Map internal status to frontend-compatible status
function mapStatusToFrontend(dbStatus) {
  const normalized = (dbStatus || '').toLowerCase();
  if (normalized === 'en attente') return 'downtime';
  if (normalized === 'en cours') return 'maintenance';
  if (normalized === 'termine' || normalized === 'resolved') return 'operational';
  return 'downtime'; // default
}

// ═══════════════════════════════════════════════════════════════════
// DATABASE OPERATIONS
// ═══════════════════════════════════════════════════════════════════

async function insertRealisticBreakdown(breakdownData) {
  try {
    // Simple INSERT without zone and type (for compatibility)
    const query = `
      INSERT INTO downtime_logs (
        machine, atelier, operator, technician, status, alert_type, criticite,
        breakdown_category, root_cause, actions_taken, preventive_actions, resolved_by,
        date_panne, heure_panne,
        date_arrivee_technicien, heure_arrivee,
        date_reparation, heure_reparation,
        temps_reaction_minutes, temps_reparation_minutes, 
        temps_intervention_minutes, temps_total_arret_minutes,
        duration, lifecycle_phase,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $13, $13
      )
      RETURNING id;
    `;
    
    const params = [
      breakdownData.machine,
      breakdownData.atelier,
      breakdownData.operator,
      breakdownData.technician,
      breakdownData.status,
      breakdownData.alert_type,
      breakdownData.criticite,
      breakdownData.breakdown_category,
      breakdownData.root_cause,
      breakdownData.actions_taken,
      breakdownData.preventive_actions,
      breakdownData.resolved_by,
      breakdownData.datePanne,
      breakdownData.heurePanne,
      breakdownData.dateArrivee,
      breakdownData.heureArrivee,
      breakdownData.dateReparation,
      breakdownData.heureReparation,
      breakdownData.tempsReaction,
      breakdownData.tempsReparation,
      breakdownData.tempsIntervention,
      breakdownData.tempsTotal,
      breakdownData.tempsTotal,
      breakdownData.lifecycle_phase
    ];
    
    const result = await poolRef.query(query, params);
    
    console.log(`[DATA-GEN] ✅ Inserted realistic breakdown - ${breakdownData.machine} | ${breakdownData.alert_type} | ${breakdownData.criticite}`);
    
    // ✅ CRITICAL FIX: Update machine status in machines table (if exists)
    // This ensures Dashboard shows the breakdown visually
    await updateMachineStatus(breakdownData.machine, mapStatusToFrontend(breakdownData.status), breakdownData.alert_type);
    
    return result.rows[0].id;
    
  } catch (err) {
    console.error('[DATA-GEN] ❌ Error inserting breakdown:', err.message);
    console.error('[DATA-GEN] Stack:', err.stack);
    return null;
  }
}

async function updateMachineStatus(machine, status, alertType) {
  try {
    // Skip KA01 (real Wokwi machine)
    if (machine === 'KA01') {
      return;
    }
    
    // Try to check if machines table exists with 'machine' column
    let checkQuery = `SELECT 1 FROM machines WHERE machine = $1 LIMIT 1`;
    let existing;
    
    try {
      existing = await poolRef.query(checkQuery, [machine]);
    } catch (err) {
      // machines table doesn't exist or uses different schema - that's OK
      // Frontend reads from downtime_logs anyway
      console.log(`[DATA-GEN] machines table not available (expected)`);
      return;
    }
    
    if (existing && existing.rows.length > 0) {
      await poolRef.query(
        `UPDATE machines 
         SET status = $1, 
             alert_type = $2,
             last_alert_at = NOW(),
             updated_at = NOW()
         WHERE machine = $3`,
        [status, alertType, machine]
      );
      console.log(`[DATA-GEN] ✅ Machine ${machine} status updated: ${status}`);
    } else {
      await poolRef.query(
        `INSERT INTO machines (machine, status, alert_type, last_alert_at, created_at, updated_at) 
         VALUES ($1, $2, $3, NOW(), NOW(), NOW())
         ON CONFLICT (machine) DO UPDATE
         SET status = EXCLUDED.status, 
             alert_type = EXCLUDED.alert_type, 
             last_alert_at = NOW(),
             updated_at = NOW()`,
        [machine, status, alertType]
      );
      console.log(`[DATA-GEN] ✅ Machine ${machine} created with status: ${status}`);
    }
    
  } catch (err) {
    // Silent fail - machines table is optional since frontend reads from downtime_logs
    console.log(`[DATA-GEN] Could not update machines table (non-critical): ${err.message}`);
  }
}

async function getCurrentNonOperationalCount() {
  try {
    const result = await poolRef.query(`
      SELECT COUNT(DISTINCT machine) as count
      FROM downtime_logs
      WHERE status NOT IN ('Termine', 'Resolved', 'Completed', 'resolved', 'termine', 'completed')
        AND machine != 'KA01'
        AND status IS NOT NULL
        AND date_panne >= NOW() - INTERVAL '24 hours'
    `);
    
    return parseInt(result.rows[0].count) || 0;
    
  } catch (err) {
    console.error('[DATA-GEN] Error getting non-operational count:', err.message);
    return 0;
  }
}

async function getActiveMachines() {
  try {
    const result = await poolRef.query(`
      SELECT DISTINCT machine
      FROM downtime_logs
      WHERE status NOT IN ('Termine', 'Resolved', 'Completed', 'resolved', 'termine', 'completed')
        AND machine != 'KA01'
        AND status IS NOT NULL
        AND date_panne >= NOW() - INTERVAL '24 hours'
    `);
    
    return result.rows.map(r => r.machine);
    
  } catch (err) {
    console.error('[DATA-GEN] Error getting active machines:', err.message);
    return [];
  }
}

async function resolveOldestBreakdown() {
  try {
    const result = await poolRef.query(`
      UPDATE downtime_logs
      SET 
        status = 'Termine',
        lifecycle_phase = 'resolved',
        date_reparation = NOW(),
        heure_reparation = TO_CHAR(NOW(), 'HH24:MI:SS'),
        temps_total_arret_minutes = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - date_panne)) / 60)::INTEGER,
        duration = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - date_panne)) / 60)::INTEGER,
        temps_reparation_minutes = CASE 
          WHEN date_arrivee_technicien IS NOT NULL 
          THEN GREATEST(0, EXTRACT(EPOCH FROM (NOW() - date_arrivee_technicien)) / 60)::INTEGER
          ELSE NULL
        END,
        updated_at = NOW()
      WHERE id = (
        SELECT id FROM downtime_logs
        WHERE status NOT IN ('Termine', 'Resolved', 'Completed', 'resolved', 'termine', 'completed')
          AND machine != 'KA01'
          AND status IS NOT NULL
        ORDER BY date_panne ASC
        LIMIT 1
      )
      RETURNING machine, alert_type;
    `);
    
    if (result.rows.length > 0) {
      const machine = result.rows[0].machine;
      
      // Update machine status to operational
      await updateMachineStatus(machine, 'operational', null);
      
      // Emit Socket.IO event
      if (ioRef) {
        ioRef.emit('machineStatusChanged', {
          machine: machine,
          status: 'operational',
          alert_type: 'Resolved',
          source: 'data_generator'
        });
      }
      
      console.log(`[DATA-GEN] ✅ Resolved breakdown - ${machine}`);
      
      return machine;
    }
    
    return null;
    
  } catch (err) {
    console.error('[DATA-GEN] Error resolving breakdown:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN SIMULATION LOGIC - Enhanced Auto-Balancing with Category Mixing
// ═══════════════════════════════════════════════════════════════════

async function balanceFactory() {
  if (!poolRef) {
    console.warn('[DATA-GEN] Pool not initialized, skipping balance');
    return;
  }
  
  try {
    const currentNonOp = await getCurrentNonOperationalCount();
    const activeMachines = await getActiveMachines();
    
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`[DATA-GEN] 🏭 Factory Status: ${currentNonOp} non-operational machines`);
    console.log(`[DATA-GEN] 🎯 Target range: ${MIN_NON_OPERATIONAL}-${MAX_NON_OPERATIONAL}`);
    console.log(`[DATA-GEN] 📊 Active machines: ${activeMachines.length}`);
    console.log('═══════════════════════════════════════════════════════════════');
    
    // ─────────────────────────────────────────────────────────────────
    // SCENARIO 1: Too few breakdowns (< 5) → Create new ones
    // ─────────────────────────────────────────────────────────────────
    if (currentNonOp < MIN_NON_OPERATIONAL) {
      const needed = randomInt(MIN_NON_OPERATIONAL, MAX_NON_OPERATIONAL) - currentNonOp;
      console.log(`[DATA-GEN] 📈 BALANCING: Need ${needed} more breakdowns (current: ${currentNonOp})`);
      
      // Track category distribution for balanced mixing
      const categoryCount = { downtime: 0, maintenance: 0, break: 0, material: 0 };
      
      for (let i = 0; i < needed; i++) {
        // Pick a machine that is NOT currently broken
        const availableMachines = ALL_MACHINES.filter(m => !activeMachines.includes(m));
        
        if (availableMachines.length === 0) {
          console.log('[DATA-GEN] ⚠️ No available machines to create breakdowns');
          break;
        }
        
        const machine = randomChoice(availableMachines);
        
        // ✅ Enhanced: Smart category selection for balanced distribution
        // Ensure we have a good mix of all 4 categories
        let status;
        const totalCreated = Object.values(categoryCount).reduce((a, b) => a + b, 0);
        
        if (totalCreated === 0) {
          // First breakdown: random
          status = randomChoice(STATUS_OPTIONS);
        } else {
          // Subsequent: prefer underrepresented categories
          const sortedCategories = STATUS_OPTIONS.sort((a, b) => 
            categoryCount[a] - categoryCount[b]
          );
          
          // 70% chance to pick least used, 30% random
          status = Math.random() < 0.7 ? sortedCategories[0] : randomChoice(STATUS_OPTIONS);
        }
        
        categoryCount[status]++;
        
        const breakdownData = generateBreakdownData(machine, status);
        
        // Insert breakdown (this will automatically update machines table)
        await insertRealisticBreakdown(breakdownData);
        
        console.log(`[DATA-GEN] ✅ Created: ${machine} | ${STATUS_LABELS[status]} | ${breakdownData.alert_type} | ${breakdownData.criticite}`);
        
        // Emit Socket.IO event
        if (ioRef) {
          ioRef.emit('machineStatusChanged', {
            machine: machine,
            status: status,
            alert_type: breakdownData.alert_type,
            criticite: breakdownData.criticite,
            source: 'data_generator'
          });
        }
        
        activeMachines.push(machine);
      }
      
      // Log category distribution
      console.log('[DATA-GEN] 📊 Category distribution:');
      Object.entries(categoryCount).forEach(([cat, count]) => {
        if (count > 0) {
          console.log(`[DATA-GEN]    - ${STATUS_LABELS[cat]}: ${count}`);
        }
      });
    }
    
    // ─────────────────────────────────────────────────────────────────
    // SCENARIO 2: Too many breakdowns (> 20) → Resolve oldest
    // ─────────────────────────────────────────────────────────────────
    else if (currentNonOp > MAX_NON_OPERATIONAL) {
      const excess = currentNonOp - MAX_NON_OPERATIONAL;
      console.log(`[DATA-GEN] 📉 BALANCING: Resolving ${excess} oldest breakdowns (current: ${currentNonOp})`);
      
      for (let i = 0; i < excess; i++) {
        const resolved = await resolveOldestBreakdown();
        if (resolved) {
          console.log(`[DATA-GEN] ✅ Resolved: ${resolved}`);
        }
      }
    }
    
    // ─────────────────────────────────────────────────────────────────
    // SCENARIO 3: Balanced (5-20) → Dynamic simulation (30% chance)
    // ─────────────────────────────────────────────────────────────────
    else {
      console.log(`[DATA-GEN] ✅ Factory balanced (${currentNonOp} non-operational)`);
      
      // Randomly resolve 1 breakdown and create a new one (simulate dynamic factory)
      // This keeps the dashboard "alive" without breaking the balance
      if (Math.random() < 0.3 && currentNonOp > MIN_NON_OPERATIONAL) {
        console.log('[DATA-GEN] 🔄 Dynamic simulation: Rotating 1 breakdown');
        
        const resolved = await resolveOldestBreakdown();
        if (resolved) {
          console.log(`[DATA-GEN] ✅ Resolved: ${resolved}`);
        }
        
        // Create a new breakdown to maintain balance
        const availableMachines = ALL_MACHINES.filter(m => !activeMachines.includes(m));
        if (availableMachines.length > 0) {
          const machine = randomChoice(availableMachines);
          const status = randomChoice(STATUS_OPTIONS);
          const breakdownData = generateBreakdownData(machine, status);
          
          await insertRealisticBreakdown(breakdownData);
          
          console.log(`[DATA-GEN] ✅ Created: ${machine} | ${STATUS_LABELS[status]} | ${breakdownData.alert_type}`);
          
          if (ioRef) {
            ioRef.emit('machineStatusChanged', {
              machine: machine,
              status: status,
              alert_type: breakdownData.alert_type,
              criticite: breakdownData.criticite,
              source: 'data_generator'
            });
          }
        }
      }
    }
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    
  } catch (err) {
    console.error('[DATA-GEN] ❌ Error in balanceFactory:', err.message);
    console.error('[DATA-GEN] Stack:', err.stack);
  }
}

// ═══════════════════════════════════════════════════════════════════
// LIFECYCLE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

function init(pool, io) {
  poolRef = pool;
  ioRef = io;
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🏭 DATA GENERATOR INITIALIZED');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Machines: ${ALL_MACHINES.length} (excluding KA01)`);
  console.log(`  Target non-operational: ${MIN_NON_OPERATIONAL}-${MAX_NON_OPERATIONAL}`);
  console.log(`  Update interval: 5 minutes`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  
  // Initial balance
  setTimeout(() => balanceFactory(), 5000);
  
  // Update every 5 minutes
  updateInterval = setInterval(() => balanceFactory(), 5 * 60 * 1000);
  
  isRunning = true;
}

function stop() {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
  isRunning = false;
  console.log('[DATA-GEN] Stopped');
}

// ═══════════════════════════════════════════════════════════════════
// MANUAL TRIGGER (for testing)
// ═══════════════════════════════════════════════════════════════════

async function generateNow() {
  console.log('[DATA-GEN] Manual trigger requested');
  await balanceFactory();
}

async function fillNullValues() {
  if (!poolRef) {
    console.warn('[DATA-GEN] Pool not initialized');
    return;
  }
  
  console.log('[DATA-GEN] 🔧 Filling NULL values in existing records...');
  
  try {
    // Find records with NULL values (only columns that exist in local DB)
    const result = await poolRef.query(`
      SELECT id, machine, status, alert_type
      FROM downtime_logs
      WHERE (
        operator IS NULL OR
        technician IS NULL OR
        atelier IS NULL OR
        breakdown_category IS NULL OR
        root_cause IS NULL OR
        actions_taken IS NULL OR
        preventive_actions IS NULL OR
        resolved_by IS NULL OR
        temps_reaction_minutes IS NULL OR
        temps_reparation_minutes IS NULL OR
        temps_total_arret_minutes IS NULL
      )
      AND machine != 'KA01'
      LIMIT 100
    `);
    
    console.log(`[DATA-GEN] Found ${result.rows.length} records with NULL values`);
    
    for (const row of result.rows) {
      const breakdownType = row.alert_type || randomChoice(Object.keys(BREAKDOWN_TYPES));
      const typeData = BREAKDOWN_TYPES[breakdownType] || BREAKDOWN_TYPES['Électrique'];
      
      const timestamps = generateBreakdownTimestamps();
      
      await poolRef.query(`
        UPDATE downtime_logs
        SET
          operator = COALESCE(operator, $1),
          technician = COALESCE(technician, $2),
          atelier = COALESCE(atelier, $3),
          breakdown_category = COALESCE(breakdown_category, $4),
          root_cause = COALESCE(root_cause, $5),
          actions_taken = COALESCE(actions_taken, $6),
          preventive_actions = COALESCE(preventive_actions, $7),
          resolved_by = COALESCE(resolved_by, $8),
          criticite = COALESCE(criticite, $9),
          alert_type = COALESCE(alert_type, $10),
          date_panne = COALESCE(date_panne, $11),
          heure_panne = COALESCE(heure_panne, $12),
          date_arrivee_technicien = COALESCE(date_arrivee_technicien, $13),
          heure_arrivee = COALESCE(heure_arrivee, $14),
          temps_reaction_minutes = COALESCE(temps_reaction_minutes, $15),
          temps_reparation_minutes = COALESCE(temps_reparation_minutes, $16),
          temps_intervention_minutes = COALESCE(temps_intervention_minutes, $17),
          temps_total_arret_minutes = COALESCE(temps_total_arret_minutes, $18),
          duration = COALESCE(CAST(duration AS INTEGER), $19)
        WHERE id = $20
      `, [
        randomChoice(OPERATORS),
        randomChoice(TECHNICIANS),
        deriveAtelier(row.machine),
        breakdownType,
        randomChoice(typeData.root_causes),
        randomChoice(typeData.actions),
        'Augmenter fréquence inspection',
        randomChoice(TECHNICIANS),
        randomChoice(typeData.criticite),
        breakdownType,
        timestamps.datePanne,
        timestamps.heurePanne,
        timestamps.dateArrivee,
        timestamps.heureArrivee,
        timestamps.tempsReaction,
        timestamps.tempsReparation,
        timestamps.tempsIntervention,
        timestamps.tempsTotal,
        timestamps.tempsTotal,
        row.id
      ]);
    }
    
    console.log(`[DATA-GEN] ✅ Filled NULL values in ${result.rows.length} records`);
    
  } catch (err) {
    console.error('[DATA-GEN] ❌ Error filling NULL values:', err.message);
    console.error('[DATA-GEN] Stack:', err.stack);
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

module.exports = {
  init,
  stop,
  generateNow,
  fillNullValues,
  balanceFactory
};
