import express from "express";
import { pool } from "../db.js";
import { authRequired } from "../middleware/auth.js";
import { log } from "../utils/journal.js";

const router = express.Router();

const OBSERVATION_COLUMNS = `
  id, user_id AS "userId", date_observation AS "dateObservation",
  notes, localisation, created_at AS "createdAt"
`;

/**
 * @route GET /api/observations
 * @description Récupère toutes les observations pour l'entreprise de l'utilisateur connecté.
 * @requires authRequired
 */
router.get("/", authRequired, async (req, res) => {
    const entreprise_id = req.user?.entrepriseId;

    if (!entreprise_id) {
        return res.status(403).json({ error: "Autorisation insuffisante : Company ID manquant dans le token." });
    }

    try {
        const result = await pool.query(
            `SELECT ${OBSERVATION_COLUMNS} FROM observations WHERE entreprise_id = $1 ORDER BY date_observation DESC`,
            [entreprise_id]
        );
        res.status(200).json({ observations: result.rows });
    } catch (err) {
        log.error("[GET /observations]", err);
        res.status(500).json({ error: "Erreur lors de la récupération des observations." });
    }
});

/**
 * @route POST /api/observations
 * @description Crée une nouvelle observation de terrain pour l'entreprise de l'utilisateur connecté.
 * @requires authRequired
 */
router.post("/", authRequired, async (req, res) => {
    const entreprise_id = req.user?.entrepriseId;
    if (!entreprise_id) {
        return res.status(403).json({ error: "Autorisation insuffisante : Company ID manquant dans le token." });
    }

    const { notes, localisation, dateObservation } = req.body;
    if (!notes || !notes.trim()) {
        return res.status(400).json({ error: "Le contenu de l'observation (notes) est requis." });
    }

    try {
        const result = await pool.query(
            `INSERT INTO observations (entreprise_id, user_id, notes, localisation, date_observation)
             VALUES ($1, $2, $3, $4, COALESCE($5, now()))
             RETURNING ${OBSERVATION_COLUMNS}`,
            [entreprise_id, req.user.sub, notes, localisation || null, dateObservation || null]
        );
        res.status(201).json({ observation: result.rows[0] });
    } catch (err) {
        log.error("[POST /observations]", err);
        res.status(500).json({ error: "Erreur lors de la création de l'observation." });
    }
});

/**
 * @route PUT /api/observations/:id
 * @description Met à jour une observation existante de l'entreprise de l'utilisateur connecté.
 * @requires authRequired
 */
router.put("/:id", authRequired, async (req, res) => {
    const entreprise_id = req.user?.entrepriseId;
    if (!entreprise_id) {
        return res.status(403).json({ error: "Autorisation insuffisante : Company ID manquant dans le token." });
    }

    const { notes, localisation, dateObservation } = req.body;

    try {
        const result = await pool.query(
            `UPDATE observations SET
               notes = COALESCE($1, notes),
               localisation = COALESCE($2, localisation),
               date_observation = COALESCE($3, date_observation)
             WHERE id = $4 AND entreprise_id = $5
             RETURNING ${OBSERVATION_COLUMNS}`,
            [notes, localisation, dateObservation, req.params.id, entreprise_id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Observation introuvable." });
        }
        res.status(200).json({ observation: result.rows[0] });
    } catch (err) {
        log.error("[PUT /observations/:id]", err);
        res.status(500).json({ error: "Erreur lors de la mise à jour de l'observation." });
    }
});

/**
 * @route DELETE /api/observations/:id
 * @description Supprime une observation de l'entreprise de l'utilisateur connecté.
 * @requires authRequired
 */
router.delete("/:id", authRequired, async (req, res) => {
    const entreprise_id = req.user?.entrepriseId;
    if (!entreprise_id) {
        return res.status(403).json({ error: "Autorisation insuffisante : Company ID manquant dans le token." });
    }

    try {
        const result = await pool.query(
            "DELETE FROM observations WHERE id = $1 AND entreprise_id = $2",
            [req.params.id, entreprise_id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Observation introuvable." });
        }
        res.status(200).json({ success: true });
    } catch (err) {
        log.error("[DELETE /observations/:id]", err);
        res.status(500).json({ error: "Erreur lors de la suppression de l'observation." });
    }
});

export default router;
