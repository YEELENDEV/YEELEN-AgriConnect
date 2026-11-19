// Gabarits de produit (product.template) — étape 2 de l'alignement Odoo produit/stock. Un
// gabarit porte le nom/catégorie/description communs à un groupe de variantes (produits.
// template_id) ; lui associer des lignes d'attributs (gabarit_attributs_lignes) génère leurs
// variantes par produit cartésien (utils/variantesGenerator.js), mode "always" uniquement.
// Ouvert à tout rôle authentifié, comme produits/produit_categories.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { regenererVariantes } from '../utils/variantesGenerator.js';

const router = express.Router();

const TEMPLATE_COLUMNS = `
  t.id, t.module, t.nom, t.categorie_id AS "categorieId", pc.nom AS categorie, t.description,
  (SELECT COUNT(*)::int FROM produits p WHERE p.template_id = t.id) AS "nbVariantes"
`;

async function chargerLignesAttributs(templateIds) {
  if (templateIds.length === 0) return new Map();
  const { rows } = await pool.query(
    `SELECT gal.template_id AS "templateId", gal.attribut_id AS "attributId", ap.nom AS "attributNom",
            gal.valeur_id AS "valeurId", apv.valeur
     FROM gabarit_attributs_lignes gal
     JOIN attributs_produit ap ON ap.id = gal.attribut_id
     JOIN attributs_produit_valeurs apv ON apv.id = gal.valeur_id
     WHERE gal.template_id = ANY($1::int[])
     ORDER BY gal.attribut_id ASC, apv.ordre ASC, apv.id ASC`,
    [templateIds]
  );
  const parTemplate = new Map();
  for (const r of rows) {
    if (!parTemplate.has(r.templateId)) parTemplate.set(r.templateId, []);
    parTemplate.get(r.templateId).push(r);
  }
  return parTemplate;
}

// Valide + enregistre les lignes d'attributs d'un gabarit à partir de
// `attributs: [{ attributId, valeurIds: [...] }]` — un attributId/valeurId qui n'appartient
// pas à l'entreprise (ou une valeur qui n'appartient pas à l'attribut donné) est silencieusement
// ignoré plutôt que de faire échouer toute la requête, même posture que resolveUnite ailleurs.
async function enregistrerLignesAttributs(client, entrepriseId, templateId, attributs) {
  if (!Array.isArray(attributs)) return;
  for (const a of attributs) {
    const attributId = Number(a.attributId);
    if (!Number.isInteger(attributId)) continue;
    const owned = await client.query(
      'SELECT id FROM attributs_produit WHERE id = $1 AND entreprise_id = $2',
      [attributId, entrepriseId]
    );
    if (owned.rows.length === 0) continue;
    const valeurIds = Array.isArray(a.valeurIds) ? a.valeurIds.map(Number).filter(Number.isInteger) : [];
    if (valeurIds.length === 0) continue;
    const valides = await client.query(
      'SELECT id FROM attributs_produit_valeurs WHERE id = ANY($1::int[]) AND attribut_id = $2 AND entreprise_id = $3',
      [valeurIds, attributId, entrepriseId]
    );
    for (const v of valides.rows) {
      await client.query(
        `INSERT INTO gabarit_attributs_lignes (entreprise_id, template_id, attribut_id, valeur_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT (template_id, valeur_id) DO NOTHING`,
        [entrepriseId, templateId, attributId, v.id]
      );
    }
  }
}

router.get('/', authRequired, async (req, res) => {
  const { module } = req.query;
  const cond = ['t.entreprise_id = $1'];
  const params = [req.user.entrepriseId];
  if (module) { params.push(module); cond.push(`t.module = $${params.length}`); }
  try {
    const { rows } = await pool.query(
      `SELECT ${TEMPLATE_COLUMNS} FROM produit_templates t
       LEFT JOIN produit_categories pc ON pc.id = t.categorie_id
       WHERE ${cond.join(' AND ')} ORDER BY t.nom ASC`,
      params
    );
    const lignesParTemplate = await chargerLignesAttributs(rows.map((r) => r.id));
    return res.json({ templates: rows.map((t) => ({ ...t, attributLignes: lignesParTemplate.get(t.id) || [] })) });
  } catch (err) {
    console.error('[GET /produit-templates]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des gabarits.' });
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${TEMPLATE_COLUMNS} FROM produit_templates t
       LEFT JOIN produit_categories pc ON pc.id = t.categorie_id
       WHERE t.id = $1 AND t.entreprise_id = $2`,
      [req.params.id, req.user.entrepriseId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Gabarit introuvable.' });
    const lignes = await chargerLignesAttributs([rows[0].id]);
    const { rows: variantes } = await pool.query(
      `SELECT p.id, p.nom, p.quantite::float8 AS quantite, p.prix_defaut::float8 AS "prixDefaut",
              p.cout::float8 AS cout, p.unite,
              (SELECT string_agg(apv.valeur, ', ' ORDER BY apv.id)
               FROM variante_attributs_valeurs vav JOIN attributs_produit_valeurs apv ON apv.id = vav.valeur_id
               WHERE vav.produit_id = p.id) AS "attributsVariante"
       FROM produits p WHERE p.template_id = $1 ORDER BY p.id ASC`,
      [req.params.id]
    );
    return res.json({ template: { ...rows[0], attributLignes: lignes.get(rows[0].id) || [], variantes } });
  } catch (err) {
    console.error('[GET /produit-templates/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération du gabarit.' });
  }
});

// { module, nom, categorieId, description, attributs: [{ attributId, valeurIds: [...] }] } —
// crée le gabarit puis, si des lignes d'attributs sont fournies, génère immédiatement ses
// variantes (produit cartésien, en dehors de la transaction de création : un échec de
// génération ne doit pas faire disparaître le gabarit déjà créé, relançable via
// POST /:id/regenerer-variantes).
router.post('/', authRequired, async (req, res) => {
  const { module, nom, categorieId, description, attributs } = req.body;
  if (!module || !['Cultures', 'Poulailler', 'Pisciculture'].includes(module) || !nom || !categorieId) {
    return res.status(400).json({ error: 'module (Cultures/Poulailler), nom et categorieId sont requis.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const categorie = await client.query(
      'SELECT id FROM produit_categories WHERE id = $1 AND entreprise_id = $2 AND module = $3',
      [categorieId, req.user.entrepriseId, module]
    );
    if (categorie.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'categorieId invalide pour ce module.' });
    }
    const { rows: [tpl] } = await client.query(
      `INSERT INTO produit_templates (entreprise_id, module, nom, categorie_id, description)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.user.entrepriseId, module, nom, categorieId, description || null]
    );
    await enregistrerLignesAttributs(client, req.user.entrepriseId, tpl.id, attributs);
    await client.query('COMMIT');

    if (Array.isArray(attributs) && attributs.length > 0) {
      await regenererVariantes(req.user.entrepriseId, tpl.id);
    }
    const { rows } = await pool.query(
      `SELECT ${TEMPLATE_COLUMNS} FROM produit_templates t LEFT JOIN produit_categories pc ON pc.id = t.categorie_id WHERE t.id = $1`,
      [tpl.id]
    );
    return res.status(201).json({ template: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /produit-templates]', err);
    return res.status(500).json({ error: 'Erreur lors de la création du gabarit.' });
  } finally {
    client.release();
  }
});

router.put('/:id', authRequired, async (req, res) => {
  const { nom, categorieId, description, attributs } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existant = await client.query(
      'SELECT module FROM produit_templates WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (existant.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Gabarit introuvable.' });
    }
    if (categorieId != null) {
      const categorie = await client.query(
        'SELECT id FROM produit_categories WHERE id = $1 AND entreprise_id = $2 AND module = $3',
        [categorieId, req.user.entrepriseId, existant.rows[0].module]
      );
      if (categorie.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'categorieId invalide pour ce module.' });
      }
    }
    await client.query(
      `UPDATE produit_templates SET
         nom = COALESCE($1, nom),
         categorie_id = COALESCE($2, categorie_id),
         description = COALESCE($3, description)
       WHERE id = $4 AND entreprise_id = $5`,
      [nom, categorieId, description, req.params.id, req.user.entrepriseId]
    );
    if (Array.isArray(attributs)) {
      await client.query('DELETE FROM gabarit_attributs_lignes WHERE template_id = $1', [req.params.id]);
      await enregistrerLignesAttributs(client, req.user.entrepriseId, Number(req.params.id), attributs);
    }
    await client.query('COMMIT');

    if (Array.isArray(attributs) && attributs.length > 0) {
      await regenererVariantes(req.user.entrepriseId, Number(req.params.id));
    }
    const { rows } = await pool.query(
      `SELECT ${TEMPLATE_COLUMNS} FROM produit_templates t LEFT JOIN produit_categories pc ON pc.id = t.categorie_id WHERE t.id = $1`,
      [req.params.id]
    );
    return res.json({ template: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PUT /produit-templates/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du gabarit.' });
  } finally {
    client.release();
  }
});

// Relance la génération de variantes sans changer les lignes d'attributs — utile après
// l'ajout d'une nouvelle valeur à un attribut déjà lié à ce gabarit.
router.post('/:id/regenerer-variantes', authRequired, async (req, res) => {
  try {
    const owned = await pool.query(
      'SELECT id FROM produit_templates WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (owned.rows.length === 0) return res.status(404).json({ error: 'Gabarit introuvable.' });
    const { crees, total } = await regenererVariantes(req.user.entrepriseId, Number(req.params.id));
    return res.json({ variantesCreees: crees.length, total });
  } catch (err) {
    const status = err.status || 500;
    console.error('[POST /produit-templates/:id/regenerer-variantes]', err);
    return res.status(status).json({ error: status === 400 ? err.message : 'Erreur lors de la génération des variantes.' });
  }
});

// Supprime le gabarit ET ses variantes (produits.template_id est ON DELETE CASCADE) — même
// posture que DELETE /api/produits/:id, qui ne vérifie déjà aucune référence avant suppression
// (stock_id sur achats_lignes/devis_lignes n'a pas de contrainte FK, voir socle.js).
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM produit_templates WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Gabarit introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /produit-templates/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

export default router;
