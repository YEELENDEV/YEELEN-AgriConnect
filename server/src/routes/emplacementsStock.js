// Emplacements de stock — CRUD des emplacements INTERNES (2026-09-10).
//
// Jusqu'ici les emplacements étaient seedés à l'inscription et jamais modifiables : une
// entreprise avait exactement un emplacement interne, plus les virtuels. C'est ce qui rendait
// impossible tout transfert — il n'y avait rien entre quoi transférer.
//
// Seuls les internes sont manipulables. Les virtuels (client, fournisseur, perte, production,
// inventaire) sont structurels : stockSync.js les résout par type pour qualifier la source et la
// destination de chaque mouvement, en créer ou en supprimer casserait la traçabilité sans rien
// apporter. Ils restent visibles en lecture, ne serait-ce que pour l'écran de stock.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';

const router = express.Router();

// Gérer les emplacements est de la configuration, pas une opération de terrain — contrairement
// au rebut ou à l'inventaire, ouverts à tout rôle. Même posture que les journaux comptables.
const ecriture = [authRequired];

const COLONNES = `
  e.id, e.nom, e.type, e.par_defaut AS "parDefaut", e.parent_id AS "parentId",
  (SELECT COALESCE(SUM(q.quantite), 0)::float8 FROM stock_quants q WHERE q.emplacement_id = e.id) AS "quantiteTotale",
  (SELECT COUNT(*)::int FROM stock_quants q WHERE q.emplacement_id = e.id AND q.quantite <> 0) AS "nbArticles"
`;

router.get('/', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${COLONNES} FROM emplacements_stock e
        WHERE e.entreprise_id = $1
        ORDER BY (e.type = 'interne') DESC, e.par_defaut DESC, e.nom ASC`,
      [req.user.entrepriseId]
    );
    return res.json({ emplacements: rows });
  } catch (err) {
    console.error('[GET /emplacements-stock]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des emplacements.' });
  }
});

router.post('/', ...ecriture, async (req, res) => {
  const nom = (req.body.nom || '').trim();
  if (!nom) return res.status(400).json({ error: 'Le nom est requis.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO emplacements_stock (entreprise_id, nom, type, par_defaut)
       VALUES ($1, $2, 'interne', FALSE) RETURNING id`,
      [req.user.entrepriseId, nom]
    );
    const complet = await pool.query(`SELECT ${COLONNES} FROM emplacements_stock e WHERE e.id = $1`, [rows[0].id]);
    return res.status(201).json({ emplacement: complet.rows[0] });
  } catch (err) {
    // UNIQUE (entreprise_id, nom) : deux emplacements homonymes rendraient tout écran de stock
    // indéchiffrable, autant le refuser explicitement.
    if (err.code === '23505') return res.status(409).json({ error: 'Un emplacement porte déjà ce nom.' });
    console.error('[POST /emplacements-stock]', err);
    return res.status(500).json({ error: "Erreur lors de la création de l'emplacement." });
  }
});

router.put('/:id', ...ecriture, async (req, res) => {
  const id = Number(req.params.id);
  const nom = req.body.nom === undefined ? undefined : String(req.body.nom).trim();
  if (nom !== undefined && !nom) return res.status(400).json({ error: 'Le nom ne peut pas être vide.' });
  try {
    const existant = await pool.query(
      'SELECT id, type FROM emplacements_stock WHERE id = $1 AND entreprise_id = $2',
      [id, req.user.entrepriseId]
    );
    if (existant.rows.length === 0) return res.status(404).json({ error: 'Emplacement introuvable.' });
    if (existant.rows[0].type !== 'interne') {
      return res.status(400).json({ error: 'Seuls les emplacements internes sont modifiables.' });
    }

    if (nom !== undefined) {
      await pool.query('UPDATE emplacements_stock SET nom = $1 WHERE id = $2', [nom, id]);
    }
    // Un seul défaut par entreprise : l'index unique partiel l'impose en base, donc on retire
    // l'ancien AVANT de poser le nouveau, dans la même transaction implicite d'ordre.
    if (req.body.parDefaut === true) {
      await pool.query(
        'UPDATE emplacements_stock SET par_defaut = FALSE WHERE entreprise_id = $1 AND par_defaut',
        [req.user.entrepriseId]
      );
      await pool.query('UPDATE emplacements_stock SET par_defaut = TRUE WHERE id = $1', [id]);
    }

    const complet = await pool.query(`SELECT ${COLONNES} FROM emplacements_stock e WHERE e.id = $1`, [id]);
    return res.json({ emplacement: complet.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un emplacement porte déjà ce nom.' });
    console.error('[PUT /emplacements-stock/:id]', err);
    return res.status(500).json({ error: "Erreur lors de la modification de l'emplacement." });
  }
});

router.delete('/:id', ...ecriture, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const { rows } = await pool.query(
      `SELECT e.type, e.par_defaut AS "parDefaut",
              (SELECT COALESCE(SUM(q.quantite), 0)::float8 FROM stock_quants q WHERE q.emplacement_id = e.id) AS restant
         FROM emplacements_stock e WHERE e.id = $1 AND e.entreprise_id = $2`,
      [id, req.user.entrepriseId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Emplacement introuvable.' });
    const e = rows[0];
    if (e.type !== 'interne') return res.status(400).json({ error: 'Seuls les emplacements internes sont supprimables.' });
    if (e.parDefaut) return res.status(400).json({ error: "L'emplacement par défaut ne peut pas être supprimé. Désignez-en un autre d'abord." });
    // stock_quants cascade sur l'emplacement : supprimer un emplacement encore garni ferait
    // disparaître la marchandise en silence. On refuse, et on laisse l'utilisateur transférer.
    if (Math.abs(e.restant) > 0.0001) {
      return res.status(400).json({ error: `Cet emplacement contient encore du stock (${e.restant}). Transférez-le avant de le supprimer.` });
    }
    await pool.query('DELETE FROM emplacements_stock WHERE id = $1 AND entreprise_id = $2', [id, req.user.entrepriseId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /emplacements-stock/:id]', err);
    return res.status(500).json({ error: "Erreur lors de la suppression de l'emplacement." });
  }
});

export default router;
