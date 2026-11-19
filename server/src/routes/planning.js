import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { generatePlan } from '../services/planningService.js';
import { pool } from '../db.js';
import { log } from '../utils/journal.js';

const router = express.Router();

/**
 * POST /api/planning
 * Génère un plan d'interventions agricole pour une parcelle (voir cultureService.js :
 * calendrier réel si `parcelle.culture` correspond à une culture connue, sinon repli
 * générique ; dates calculées depuis `parcelle.date_semis` si renseignée, sinon aujourd'hui)
 * et persiste chaque jalon comme une `activites` (ressourceType='parcelle') — réutilise le
 * modèle générique déjà en place pour devis/contact/salarie, visible/gérable ensuite via
 * <ActivitesSection ressourceType="parcelle" ... /> côté frontend.
 * `cultureId` dans le corps désigne en réalité un `parcelles.id` (nom conservé tel quel,
 * voir CLAUDE.md — aucune table `cultures` séparée n'existe dans le modèle réel).
 */
router.post('/', authRequired, async (req, res) => {
    const { cultureId } = req.body;

    if (!cultureId) {
        return res.status(400).json({ message: "Le `cultureId` est obligatoire pour générer un plan." });
    }

    try {
        const entrepriseId = req.user?.entrepriseId;
        if (!entrepriseId) {
            return res.status(401).json({ message: "Authentification requise ou manque d'ID d'entreprise." });
        }

        const planInterventions = await generatePlan(entrepriseId, cultureId);

        if (!planInterventions || planInterventions.length === 0) {
            return res.status(404).json({ message: `Aucun plan d'intervention trouvé ou généré pour la culture ${cultureId}.` });
        }

        // Persistance : une ligne `activites` par jalon. Pas de suppression des jalons d'une
        // génération précédente (voir le plan de ce chantier) — un nouvel appel ajoute
        // simplement de nouvelles tâches, le frontend prévient des doublons via une
        // confirmation avant d'appeler cette route.
        const activitesCreees = [];
        for (const intervention of planInterventions) {
            const result = await pool.query(
                `INSERT INTO activites (entreprise_id, ressource_type, ressource_id, user_id, titre, date_echeance)
                 VALUES ($1, 'parcelle', $2, $3, $4, $5)
                 RETURNING id, ressource_type AS "ressourceType", ressource_id AS "ressourceId",
                           titre, date_echeance AS "dateEcheance", termine, created_at AS "createdAt"`,
                [entrepriseId, cultureId, req.user.sub, intervention.interventionType, intervention.dateString]
            );
            activitesCreees.push(result.rows[0]);
        }

        return res.status(200).json({
            message: `Plan généré avec succès (${activitesCreees.length} tâche(s) planifiée(s)).`,
            plan: planInterventions,
            activitesCreees,
        });

    } catch (error) {
        log.error("[PlanningRoute] Erreur lors de la création du plan:", error);
        res.status(500).json({ message: "Une erreur interne est survenue lors de la génération ou la sauvegarde du plan." });
    }
});

export default router;
