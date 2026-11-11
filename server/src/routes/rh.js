// Données de référence RH par entreprise : départements, postes, jours fériés,
// types de congés. Séparé de salaries.js (qui porte tout ce qui est rattaché à
// UN salarié) : ici ce sont des ressources au niveau entreprise, même posture
// CRUD que produit_categories / contact_tags / listes_prix.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';

const router = express.Router();

// ═══════════════ Départements ═══════════════
router.get('/departements', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.nom, d.responsable_id AS "responsableId",
              (r.prenom || ' ' || r.nom) AS "responsableNom",
              (SELECT COUNT(*) FROM salaries s WHERE s.departement_id = d.id AND s.statut <> 'Inactif')::int AS "effectif"
       FROM departements d
       LEFT JOIN salaries r ON r.id = d.responsable_id
       WHERE d.entreprise_id = $1
       ORDER BY d.nom`,
      [req.user.entrepriseId]
    );
    res.json({ departements: rows });
  } catch (err) {
    console.error('[GET /rh/departements]', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des départements.' });
  }
});

router.post('/departements', authRequired, async (req, res) => {
  const { nom, responsableId } = req.body;
  if (!nom || !nom.trim()) return res.status(400).json({ error: 'Nom requis.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO departements (entreprise_id, nom, responsable_id)
       VALUES ($1, $2, $3)
       RETURNING id, nom, responsable_id AS "responsableId"`,
      [req.user.entrepriseId, nom.trim(), responsableId || null]
    );
    res.status(201).json({ departement: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un département porte déjà ce nom.' });
    console.error('[POST /rh/departements]', err);
    res.status(500).json({ error: 'Erreur lors de la création du département.' });
  }
});

router.put('/departements/:id', authRequired, async (req, res) => {
  const { nom, responsableId } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE departements SET nom = COALESCE($1, nom), responsable_id = $2
       WHERE id = $3 AND entreprise_id = $4
       RETURNING id, nom, responsable_id AS "responsableId"`,
      [nom ? nom.trim() : null, responsableId ?? null, req.params.id, req.user.entrepriseId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Département introuvable.' });
    res.json({ departement: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un département porte déjà ce nom.' });
    console.error('[PUT /rh/departements/:id]', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

router.delete('/departements/:id', authRequired, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM departements WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Département introuvable.' });
    res.json({ success: true }); // les salaries.departement_id / postes.departement_id passent à NULL (ON DELETE SET NULL)
  } catch (err) {
    console.error('[DELETE /rh/departements/:id]', err);
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

// ═══════════════ Postes ═══════════════
router.get('/postes', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.intitule, p.departement_id AS "departementId", d.nom AS "departementNom",
              (SELECT COUNT(*) FROM salaries s WHERE s.poste_id = p.id AND s.statut <> 'Inactif')::int AS "effectif"
       FROM postes p
       LEFT JOIN departements d ON d.id = p.departement_id
       WHERE p.entreprise_id = $1
       ORDER BY p.intitule`,
      [req.user.entrepriseId]
    );
    res.json({ postes: rows });
  } catch (err) {
    console.error('[GET /rh/postes]', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des postes.' });
  }
});

router.post('/postes', authRequired, async (req, res) => {
  const { intitule, departementId } = req.body;
  if (!intitule || !intitule.trim()) return res.status(400).json({ error: 'Intitulé requis.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO postes (entreprise_id, intitule, departement_id)
       VALUES ($1, $2, $3)
       RETURNING id, intitule, departement_id AS "departementId"`,
      [req.user.entrepriseId, intitule.trim(), departementId || null]
    );
    res.status(201).json({ poste: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un poste porte déjà cet intitulé.' });
    console.error('[POST /rh/postes]', err);
    res.status(500).json({ error: 'Erreur lors de la création du poste.' });
  }
});

router.put('/postes/:id', authRequired, async (req, res) => {
  const { intitule, departementId } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE postes SET intitule = COALESCE($1, intitule), departement_id = $2
       WHERE id = $3 AND entreprise_id = $4
       RETURNING id, intitule, departement_id AS "departementId"`,
      [intitule ? intitule.trim() : null, departementId ?? null, req.params.id, req.user.entrepriseId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Poste introuvable.' });
    res.json({ poste: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un poste porte déjà cet intitulé.' });
    console.error('[PUT /rh/postes/:id]', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

router.delete('/postes/:id', authRequired, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM postes WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Poste introuvable.' });
    res.json({ success: true }); // salaries.poste_id => NULL (ON DELETE SET NULL) ; salaries.poste (texte) inchangé
  } catch (err) {
    console.error('[DELETE /rh/postes/:id]', err);
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

// ═══════════════ Jours fériés ═══════════════
router.get('/jours-feries', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, date, nom FROM jours_feries WHERE entreprise_id = $1 ORDER BY date`,
      [req.user.entrepriseId]
    );
    res.json({ joursFeries: rows });
  } catch (err) {
    console.error('[GET /rh/jours-feries]', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des jours fériés.' });
  }
});

router.post('/jours-feries', authRequired, async (req, res) => {
  const { date, nom } = req.body;
  if (!date) return res.status(400).json({ error: 'Date requise.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO jours_feries (entreprise_id, date, nom)
       VALUES ($1, $2, $3)
       ON CONFLICT (entreprise_id, date) DO UPDATE SET nom = EXCLUDED.nom
       RETURNING id, date, nom`,
      [req.user.entrepriseId, date, nom || null]
    );
    res.status(201).json({ jourFerie: rows[0] });
  } catch (err) {
    console.error('[POST /rh/jours-feries]', err);
    res.status(500).json({ error: 'Erreur lors de la création du jour férié.' });
  }
});

router.delete('/jours-feries/:id', authRequired, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM jours_feries WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Jour férié introuvable.' });
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /rh/jours-feries/:id]', err);
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

// ═══════════════ Types de congés ═══════════════
router.get('/conges-types', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nom, paye, justificatif_requis AS "justificatifRequis", couleur, ordre
       FROM conges_types WHERE entreprise_id = $1 ORDER BY ordre, nom`,
      [req.user.entrepriseId]
    );
    res.json({ congesTypes: rows });
  } catch (err) {
    console.error('[GET /rh/conges-types]', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des types de congés.' });
  }
});

router.post('/conges-types', authRequired, async (req, res) => {
  const { nom, paye = true, justificatifRequis = false, couleur, ordre = 0 } = req.body;
  if (!nom || !nom.trim()) return res.status(400).json({ error: 'Nom requis.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO conges_types (entreprise_id, nom, paye, justificatif_requis, couleur, ordre)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, nom, paye, justificatif_requis AS "justificatifRequis", couleur, ordre`,
      [req.user.entrepriseId, nom.trim(), !!paye, !!justificatifRequis, couleur || null, Number(ordre) || 0]
    );
    res.status(201).json({ congeType: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un type de congé porte déjà ce nom.' });
    console.error('[POST /rh/conges-types]', err);
    res.status(500).json({ error: 'Erreur lors de la création du type de congé.' });
  }
});

router.put('/conges-types/:id', authRequired, async (req, res) => {
  const { nom, paye, justificatifRequis, couleur, ordre } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE conges_types SET
         nom = COALESCE($1, nom),
         paye = COALESCE($2, paye),
         justificatif_requis = COALESCE($3, justificatif_requis),
         couleur = COALESCE($4, couleur),
         ordre = COALESCE($5, ordre)
       WHERE id = $6 AND entreprise_id = $7
       RETURNING id, nom, paye, justificatif_requis AS "justificatifRequis", couleur, ordre`,
      [
        nom ? nom.trim() : null,
        typeof paye === 'boolean' ? paye : null,
        typeof justificatifRequis === 'boolean' ? justificatifRequis : null,
        couleur ?? null,
        ordre ?? null,
        req.params.id, req.user.entrepriseId,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Type de congé introuvable.' });
    res.json({ congeType: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un type de congé porte déjà ce nom.' });
    console.error('[PUT /rh/conges-types/:id]', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

router.delete('/conges-types/:id', authRequired, async (req, res) => {
  try {
    const used = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM salaries_conges WHERE type_id = $1)::int AS demandes,
         (SELECT COUNT(*) FROM conges_droits WHERE type_id = $1)::int AS droits`,
      [req.params.id]
    );
    if (used.rows[0].demandes > 0 || used.rows[0].droits > 0) {
      return res.status(409).json({ error: 'Ce type de congé est utilisé par des demandes ou des droits — retirez-les d\'abord.' });
    }
    const { rowCount } = await pool.query(
      'DELETE FROM conges_types WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Type de congé introuvable.' });
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /rh/conges-types/:id]', err);
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

export default router;
