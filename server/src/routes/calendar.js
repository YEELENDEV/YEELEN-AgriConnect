// Calendrier agricole partagé — backé par la table calendar_events (voir CLAUDE.md,
// section "Calendrier & Récoltes"), remplace l'ancien stockage 100% localStorage qui
// isolait chaque utilisateur au lieu de partager les événements au niveau entreprise.
// Pas de DELETE : aucun besoin exprimé côté UI pour supprimer un événement, seulement
// le corriger (PUT).
import express from "express";
import { pool } from "../db.js";
import { authRequired } from "../middleware/auth.js";
import { log } from "../utils/journal.js";

const router = express.Router();

const EVENT_COLUMNS = `
  id, user_id AS "userId", date, type, title, description, created_at AS "createdAt"
`;

/**
 * @route GET /api/calendar
 * @description Récupère les activités planifiées pour l'entreprise de l'utilisateur connecté.
 * @requires authRequired
 */
router.get("/", authRequired, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT ${EVENT_COLUMNS} FROM calendar_events WHERE entreprise_id = $1 ORDER BY date ASC`,
            [req.user.entrepriseId]
        );
        res.status(200).json({ events: result.rows });
    } catch (err) {
        log.error("[GET /calendar]", err);
        res.status(500).json({ error: "Erreur lors de la récupération du calendrier." });
    }
});

/**
 * @route POST /api/calendar
 * @description Planifie une nouvelle activité pour l'entreprise de l'utilisateur connecté.
 * @requires authRequired
 */
router.post("/", authRequired, async (req, res) => {
    const { date, type, title, description } = req.body;
    if (!date || !type || !title) {
        return res.status(400).json({ error: "La date, le type et le titre sont requis." });
    }

    try {
        const result = await pool.query(
            `INSERT INTO calendar_events (entreprise_id, user_id, date, type, title, description)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING ${EVENT_COLUMNS}`,
            [req.user.entrepriseId, req.user.sub, date, type, title, description || null]
        );
        res.status(201).json({ event: result.rows[0] });
    } catch (err) {
        log.error("[POST /calendar]", err);
        res.status(500).json({ error: "Erreur lors de la création de l'activité." });
    }
});

/**
 * @route PUT /api/calendar/:id
 * @description Modifie une activité existante (correction d'une erreur de saisie), pour l'entreprise de l'utilisateur connecté.
 * @requires authRequired
 */
router.put("/:id", authRequired, async (req, res) => {
    const { date, type, title, description } = req.body;
    try {
        const result = await pool.query(
            `UPDATE calendar_events SET
               date = COALESCE($1, date),
               type = COALESCE($2, type),
               title = COALESCE($3, title),
               description = COALESCE($4, description)
             WHERE id = $5 AND entreprise_id = $6
             RETURNING ${EVENT_COLUMNS}`,
            [date, type, title, description, req.params.id, req.user.entrepriseId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Activité introuvable." });
        }
        res.status(200).json({ event: result.rows[0] });
    } catch (err) {
        log.error("[PUT /calendar]", err);
        res.status(500).json({ error: "Erreur lors de la mise à jour de l'activité." });
    }
});

export default router;
