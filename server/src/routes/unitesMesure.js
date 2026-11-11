// Unités de mesure — calqué sur uom.uom d'un ERP de référence. Voir server/src/db/migrate.js
// pour la convention de « facteur » (combien d'unités de référence de sa catégorie pour 1
// unité de cette ligne) utilisée par la conversion dans server/src/utils/stockSync.js.
// Écritures réservées admin/directeur (même posture que /api/taxes, /api/accounts).
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';

const router = express.Router();
const ecriture = [authRequired];

const COLUMNS = `
  u.id, u.entreprise_id AS "entrepriseId", u.categorie_id AS "categorieId", c.nom AS "categorieNom",
  u.nom, u.symbole, u.facteur, u.est_reference AS "estReference"
`;

function normUnite(body, { partial = false } = {}) {
  const out = {};
  if (body.categorieId !== undefined || !partial) {
    if (!body.categorieId) return { error: 'categorieId est requis.' };
    out.categorieId = Number(body.categorieId);
  }
  if (body.nom !== undefined || !partial) {
    if (!body.nom || !String(body.nom).trim()) return { error: 'Le nom est requis.' };
    out.nom = String(body.nom).trim();
  }
  if (body.symbole !== undefined) out.symbole = body.symbole ? String(body.symbole).trim() : null;
  if (body.facteur !== undefined) {
    const f = Number(body.facteur);
    if (!(f > 0)) return { error: 'Le facteur doit être un nombre positif.' };
    out.facteur = f;
  } else if (!partial) {
    out.facteur = 1;
  }
  if (body.estReference !== undefined) out.estReference = Boolean(body.estReference);
  else if (!partial) out.estReference = false;
  return { value: out };
}

// ─── GET /api/unites-mesure?categorieId= ───
router.get('/', authRequired, async (req, res) => {
  const { categorieId } = req.query;
  try {
    const { rows } = categorieId
      ? await pool.query(
          `SELECT ${COLUMNS} FROM unites_mesure u JOIN unites_mesure_categories c ON c.id = u.categorie_id
           WHERE u.entreprise_id = $1 AND u.categorie_id = $2 ORDER BY c.nom ASC, u.nom ASC`,
          [req.user.entrepriseId, categorieId]
        )
      : await pool.query(
          `SELECT ${COLUMNS} FROM unites_mesure u JOIN unites_mesure_categories c ON c.id = u.categorie_id
           WHERE u.entreprise_id = $1 ORDER BY c.nom ASC, u.nom ASC`,
          [req.user.entrepriseId]
        );
    return res.json({ unites: rows });
  } catch (err) {
    console.error('[GET /unites-mesure]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des unités de mesure.' });
  }
});

// ─── POST /api/unites-mesure ───
router.post('/', ...ecriture, async (req, res) => {
  const { error, value } = normUnite(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const categorie = await pool.query(
      'SELECT id FROM unites_mesure_categories WHERE id = $1 AND entreprise_id = $2',
      [value.categorieId, req.user.entrepriseId]
    );
    if (categorie.rows.length === 0) return res.status(400).json({ error: 'Catégorie d\'unités introuvable.' });

    const { rows } = await pool.query(
      `INSERT INTO unites_mesure (entreprise_id, categorie_id, nom, symbole, facteur, est_reference)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [req.user.entrepriseId, value.categorieId, value.nom, value.symbole ?? null, value.facteur, value.estReference]
    );
    const created = await pool.query(
      `SELECT ${COLUMNS} FROM unites_mesure u JOIN unites_mesure_categories c ON c.id = u.categorie_id WHERE u.id = $1`,
      [rows[0].id]
    );
    return res.status(201).json({ unite: created.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Cette unité existe déjà dans cette catégorie.' });
    console.error('[POST /unites-mesure]', err);
    return res.status(500).json({ error: 'Erreur lors de la création de l\'unité.' });
  }
});

// ─── PUT /api/unites-mesure/:id ───
router.put('/:id', ...ecriture, async (req, res) => {
  const { error, value } = normUnite(req.body, { partial: true });
  if (error) return res.status(400).json({ error });
  if (value.categorieId !== undefined) {
    const categorie = await pool.query(
      'SELECT id FROM unites_mesure_categories WHERE id = $1 AND entreprise_id = $2',
      [value.categorieId, req.user.entrepriseId]
    );
    if (categorie.rows.length === 0) return res.status(400).json({ error: 'Catégorie d\'unités introuvable.' });
  }
  const champs = Object.keys(value);
  if (champs.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });

  const colonnes = { categorieId: 'categorie_id', nom: 'nom', symbole: 'symbole', facteur: 'facteur', estReference: 'est_reference' };
  const set = champs.map((c, i) => `${colonnes[c]} = $${i + 1}`).join(', ');
  const params = champs.map((c) => value[c]);
  params.push(req.params.id, req.user.entrepriseId);
  try {
    const result = await pool.query(
      `UPDATE unites_mesure SET ${set} WHERE id = $${params.length - 1} AND entreprise_id = $${params.length}`,
      params
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Unité introuvable.' });
    const updated = await pool.query(
      `SELECT ${COLUMNS} FROM unites_mesure u JOIN unites_mesure_categories c ON c.id = u.categorie_id WHERE u.id = $1`,
      [req.params.id]
    );
    return res.json({ unite: updated.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Cette unité existe déjà dans cette catégorie.' });
    console.error('[PUT /unites-mesure/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour de l\'unité.' });
  }
});

// ─── DELETE /api/unites-mesure/:id ───
// produits.unite_id et achats_lignes/devis_lignes.uom_id sont tous ON DELETE SET NULL —
// supprimer une unité utilisée ne bloque rien, les références retombent simplement à NULL.
router.delete('/:id', ...ecriture, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM unites_mesure WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Unité introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /unites-mesure/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

export default router;
