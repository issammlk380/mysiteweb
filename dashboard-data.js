// DEMO DATA Generator - 120 realistic entries
function generateDemoData() {
    const machines = ['KA01','KA02','KA03','KA04','KA05','KB01','KB02','KB03','KB04','KC01','KC02','KC03','KC04','KD01','KD02','KX01','KX02'];
    const techniciens = ['Ahmed Benali','Karim Fassi','Youssef Amrani','Mohamed El Amrani','Hassan Alaoui','Omar Benjelloun'];
    const statuts = ['Terminé','Terminé','Terminé','Terminé','Terminé','En réparation','Pending'];
    const criticites = ['Faible','Faible','Faible','Modérée','Modérée','Majeure','Critique'];
    const alertTypes = ['Électrique','Mécanique','Hydraulique','Pneumatique','Logiciel','Capteur','Surchauffe'];
    const observations = [
        'Remplacement capteur proximité','Calibration système automatique','Nettoyage filtre à air',
        'Lubrification axes principaux','Serrage connexions électriques','Changement joint étanchéité',
        'Remplacement roulements','Ajustement paramètres pression','Purge circuit hydraulique',
        'Remplacement fusible protection','Changement carte électronique','Réparation vérin hydraulique',
        'Nettoyage système refroidissement','Calibration capteurs température','Remplacement courroie transmission'
    ];
    
    const data = [];
    const now = new Date('2025-07-15');
    
    for (let i = 0; i < 120; i++) {
        const daysAgo = Math.floor(Math.random() * 90);
        const date = new Date(now);
        date.setDate(date.getDate() - daysAgo);
        
        const machine = machines[Math.floor(Math.random() * machines.length)];
        const atelier = machine.startsWith('KA') ? 'Atelier A' : 
                       machine.startsWith('KB') ? 'Atelier B' :
                       machine.startsWith('KC') ? 'Atelier C' :
                       machine.startsWith('KD') ? 'Atelier D' : 'Atelier X';
        
        const status = statuts[Math.floor(Math.random() * statuts.length)];
        const criticite = criticites[Math.floor(Math.random() * criticites.length)];
        const alertType = alertTypes[Math.floor(Math.random() * alertTypes.length)];
        const observation = observations[Math.floor(Math.random() * observations.length)];
        
        const heurePanne = `${String(Math.floor(Math.random() * 16) + 6).padStart(2,'0')}:${String(Math.floor(Math.random() * 60)).padStart(2,'0')}:00`;
        
        let technicien = '—';
        let heureArrivee = null;
        let tempsAttente = 0;
        let tempsReparation = 0;
        
        if (status !== 'Pending') {
            technicien = techniciens[Math.floor(Math.random() * techniciens.length)];
            tempsAttente = Math.floor(Math.random() * 45) + 5;
            
            const [h, m] = heurePanne.split(':').map(Number);
            const arrivalMinutes = (h * 60 + m + tempsAttente) % 1440;
            heureArrivee = `${String(Math.floor(arrivalMinutes / 60)).padStart(2,'0')}:${String(arrivalMinutes % 60).padStart(2,'0')}:00`;
            
            if (status === 'Terminé') {
                const baseRepair = criticite === 'Critique' ? 120 : criticite === 'Majeure' ? 75 : criticite === 'Modérée' ? 45 : 25;
                tempsReparation = baseRepair + Math.floor(Math.random() * 30);
            } else {
                tempsReparation = Math.floor(Math.random() * 60) + 30;
            }
        }
        
        data.push({
            machine, atelier, status, 
            jour: date.toLocaleDateString('fr-FR'),
            start_time: heurePanne,
            heure_arret_technicien: heureArrivee,
            temps_attente: tempsAttente,
            temps_reparation: tempsReparation,
            duration: tempsReparation,
            criticite, technicien,
            piece_observation: observation,
            alert_type: alertType
        });
    }
    
    return data;
}

const DEMO_DATA = generateDemoData();
