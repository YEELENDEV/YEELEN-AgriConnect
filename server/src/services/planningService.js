// Utilisé uniquement par routes/planning.js (POST /api/planning). Orchestre
// cultureService.js:getCulturePlanDetails (calendrier réel par culture + date de semis,
// voir ce fichier) — pas de logique de saisonnalité/disponibilité de ressources au-delà de
// ça, volontairement hors périmètre pour l'instant.
import { getCulturePlanDetails } from './cultureService.js';
import { log } from '../utils/journal.js';
/**
 * @typedef {Object} PlanIntervention
 * @property {string} dateString - La date de l'intervention (YYYY-MM-DD).
 * @property {string} interventionType - Ex: 'Semis', 'Fertilisation', 'PestControl'.
 * @property {number} dureeJours - Durée estimée en jours.
 */

/**
 * Génère un plan d'intervention agricole pour une culture spécifique sur une parcelle donnée.
 * @param {string} entrepriseId L'ID de l'entreprise propriétaire des données agricoles.
 * @param {string} cultureId L'ID de la culture à planifier.
 * @returns {Promise<Array<PlanIntervention>>} Un tableau représentant les interventions planifiées, ou un tableau vide en cas d'échec critique.
 */
export async function generatePlan(entrepriseId, cultureId) {
    log.info(`[PlanningService] Démarrage de la génération du plan pour l'entreprise ${entrepriseId} et culture ${cultureId}...`);

    try {
        const requiredDetails = await getCulturePlanDetails(cultureId, entrepriseId);

        if (!requiredDetails || !requiredDetails.scheduleMilestones) {
            log.error("[PlanningService] Échec critique : Impossible de récupérer les étapes agronomiques pour cette culture.");
            return [];
        }

        const planInterventions = requiredDetails.scheduleMilestones.map((milestone) => ({
            dateString: milestone.targetDate,
            interventionType: milestone.name,
            dureeJours: milestone.durationDays || 3,
        }));

        planInterventions.sort((a, b) => new Date(a.dateString) - new Date(b.dateString));

        return planInterventions;

    } catch (error) {
        log.error(`[PlanningService] ERREUR lors de la génération du plan pour ${cultureId}:`, error);
        return [];
    }
}
