// Listes de prix nommées et réutilisables (2026-08-18) — troisième étape de l'alignement
// structurel façon ERP, remplace l'ancienne client_prix (une ligne = un override non réutilisable
// pour un seul client) par un objet nommé assignable à plusieurs contacts à la fois, comme
// le champ "Liste de prix" d'une commande dans un ERP de référence. Voir server/src/db/socle.js:
// migrateClientPrixToListesPrix pour la migration des données existantes. L'assignation
// d'une liste à un contact se fait via routes/contacts.js (POST/PUT, champ listePrixId) —
// ce fichier ne gère que les listes elles-mêmes et leurs lignes.
//
// Étape 4 alignement Odoo produit/stock (2026-09-04) : les lignes deviennent un vrai moteur
// de règles (applied_on/compute_price/quantite_min/dates, voir socle.js) résolu côté serveur
// via utils/pricelistResolver.js — GET /prix-effectif expose cette résolution à un seul
// article, appelée par DevisModule au lieu du calcul purement client d'avant cette étape.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { resoudreRegleListe, appliquerRegleListe } from '../utils/pricelistResolver.js';

const router = express.Router();

const APPLIED_ON = ['global', 'categorie', 'gabarit', 'variante'];
const COMPUTE_PRICE = ['fixe', 'pourcentage', 'formule'];

router.get('/', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT lp.id, lp.nom, lp.created_at AS "createdAt", COUNT(lpl.id)::int AS "nombreLignes"
       FROM listes_prix lp LEFT JOIN listes_prix_lignes lpl ON lpl.liste_prix_id = lp.id
       WHERE lp.entreprise_id = $1
       GROUP BY lp.id
       ORDER BY lp.nom ASC`,
      [req.user.entrepriseId]
    );
    return res.json({ listes: result.rows });
  } catch (err) {
    console.error('[GET /listes-prix]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des listes de prix.' });
  }
});

router.post('/', authRequired, async (req, res) => {
  const { nom } = req.body;
  if (!nom || !nom.trim()) {
    return res.status(400).json({ error: 'Le nom de la liste est requis.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO listes_prix (entreprise_id, nom) VALUES ($1, $2)
       RETURNING id, nom, created_at AS "createdAt", 0 AS "nombreLignes"`,
      [req.user.entrepriseId, nom.trim()]
    );
    return res.status(201).json({ liste: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Une liste avec ce nom existe déjà.' });
    }
    console.error('[POST /listes-prix]', err);
    return res.status(500).json({ error: 'Erreur lors de la création de la liste.' });
  }
});

// Résolution serveur du prix effectif d'un article pour un contact donné, à une quantité et
// une date données. Un contact sans liste assignée, ou dont la liste ne couvre pas cet article
// à cette quantité/date, retombe sur prix_defaut — jamais d'erreur, juste { source: 'defaut' }.
// Déclarée avant /:id pour ne jamais être interceptée par une route paramétrée — mais comme ce
// routeur n'a pas de GET '/:id' générique (seulement '/:id/lignes'), l'ordre n'est pas
// critique ici ; gardé en tête de fichier par lisibilité.
router.get('/prix-effectif', authRequired, async (req, res) => {
  const { stockId, contactId, quantite, date } = req.query;
  if (!stockId) return res.status(400).json({ error: 'stockId est requis.' });
  try {
    const produit = await pool.query(
      `SELECT prix_defaut::float8 AS "prixDefaut", template_id AS "templateId", categorie_id AS "categorieId"
       FROM produits WHERE id = $1 AND entreprise_id = $2`,
      [stockId, req.user.entrepriseId]
    );
    if (produit.rows.length === 0) return res.status(404).json({ error: 'Article introuvable.' });
    const { prixDefaut, templateId, categorieId } = produit.rows[0];

    let listePrixId = null;
    if (contactId) {
      const contact = await pool.query(
        'SELECT liste_prix_id AS "listePrixId" FROM contacts WHERE id = $1 AND entreprise_id = $2',
        [contactId, req.user.entrepriseId]
      );
      listePrixId = contact.rows[0]?.listePrixId || null;
    }

    const regle = listePrixId
      ? await resoudreRegleListe(pool, {
          listePrixId, produitId: Number(stockId), templateId, categorieId,
          quantite: quantite != null ? Number(quantite) : 0, date: date || null,
        })
      : null;

    return res.json({ prix: appliquerRegleListe(regle, prixDefaut), source: regle ? 'liste' : 'defaut', regleId: regle ? regle.id : null });
  } catch (err) {
    console.error('[GET /listes-prix/prix-effectif]', err);
    return res.status(500).json({ error: 'Erreur lors de la résolution du prix.' });
  }
});

// Les contacts assignés à cette liste sont détachés automatiquement (contacts.liste_prix_id
// ON DELETE SET NULL) — pas de blocage à gérer ici, contrairement à la suppression d'un
// contact référencé par un devis.
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM listes_prix WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Liste introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /listes-prix]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

router.get('/:id/lignes', authRequired, async (req, res) => {
  try {
    const liste = await pool.query('SELECT id FROM listes_prix WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    if (liste.rows.length === 0) return res.status(404).json({ error: 'Liste introuvable.' });
    const result = await pool.query(
      `SELECT lpl.id, lpl.applied_on AS "appliedOn", lpl.compute_price AS "computePrice",
              lpl.prix::float8 AS prix, lpl.pourcentage::float8 AS pourcentage,
              lpl.quantite_min::float8 AS "quantiteMin",
              to_char(lpl.date_debut, 'YYYY-MM-DD') AS "dateDebut", to_char(lpl.date_fin, 'YYYY-MM-DD') AS "dateFin",
              lpl.stock_id AS "stockId", p.nom AS "stockNom",
              lpl.template_id AS "templateId", pt.nom AS "templateNom",
              lpl.categorie_id AS "categorieId", pc.nom AS "categorieNom"
       FROM listes_prix_lignes lpl
       LEFT JOIN produits p ON p.id = lpl.stock_id
       LEFT JOIN produit_templates pt ON pt.id = lpl.template_id
       LEFT JOIN produit_categories pc ON pc.id = lpl.categorie_id
       WHERE lpl.liste_prix_id = $1
       ORDER BY
         CASE lpl.applied_on WHEN 'variante' THEN 4 WHEN 'gabarit' THEN 3 WHEN 'categorie' THEN 2 ELSE 1 END DESC,
         lpl.quantite_min DESC, lpl.id ASC`,
      [req.params.id]
    );
    return res.json({ lignes: result.rows });
  } catch (err) {
    console.error('[GET /listes-prix/:id/lignes]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des lignes.' });
  }
});

// { appliedOn, stockId?, templateId?, categorieId?, computePrice, prix?, pourcentage?,
//   quantiteMin?, dateDebut?, dateFin? } — une règle par appel (pas d'upsert automatique : une
// même cible peut désormais porter plusieurs règles à des paliers de quantité différents,
// contrairement à l'ancien ON CONFLICT DO UPDATE qui supposait une seule ligne par variante).
router.post('/:id/lignes', authRequired, async (req, res) => {
  const { appliedOn, stockId, templateId, categorieId, computePrice, prix, pourcentage, quantiteMin, dateDebut, dateFin } = req.body;
  if (!APPLIED_ON.includes(appliedOn)) {
    return res.status(400).json({ error: `appliedOn invalide (attendu : ${APPLIED_ON.join(', ')}).` });
  }
  if (!COMPUTE_PRICE.includes(computePrice)) {
    return res.status(400).json({ error: `computePrice invalide (attendu : ${COMPUTE_PRICE.join(', ')}).` });
  }
  if (computePrice === 'fixe' && (prix == null || prix === '')) {
    return res.status(400).json({ error: 'Un prix fixe est requis pour ce mode de calcul.' });
  }
  if (computePrice !== 'fixe' && (pourcentage == null || pourcentage === '')) {
    return res.status(400).json({ error: 'Un pourcentage est requis pour ce mode de calcul.' });
  }
  try {
    const liste = await pool.query('SELECT id FROM listes_prix WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    if (liste.rows.length === 0) return res.status(404).json({ error: 'Liste introuvable.' });

    let stockIdFinal = null;
    let templateIdFinal = null;
    let categorieIdFinal = null;
    if (appliedOn === 'variante') {
      const produit = await pool.query('SELECT id FROM produits WHERE id = $1 AND entreprise_id = $2', [stockId, req.user.entrepriseId]);
      if (produit.rows.length === 0) return res.status(400).json({ error: 'Article introuvable.' });
      stockIdFinal = produit.rows[0].id;
    } else if (appliedOn === 'gabarit') {
      const tpl = await pool.query('SELECT id FROM produit_templates WHERE id = $1 AND entreprise_id = $2', [templateId, req.user.entrepriseId]);
      if (tpl.rows.length === 0) return res.status(400).json({ error: 'Gabarit introuvable.' });
      templateIdFinal = tpl.rows[0].id;
    } else if (appliedOn === 'categorie') {
      const cat = await pool.query('SELECT id FROM produit_categories WHERE id = $1 AND entreprise_id = $2', [categorieId, req.user.entrepriseId]);
      if (cat.rows.length === 0) return res.status(400).json({ error: 'Catégorie introuvable.' });
      categorieIdFinal = cat.rows[0].id;
    }

    const result = await pool.query(
      `INSERT INTO listes_prix_lignes
         (liste_prix_id, applied_on, stock_id, template_id, categorie_id, compute_price, prix, pourcentage, quantite_min, date_debut, date_fin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        req.params.id, appliedOn, stockIdFinal, templateIdFinal, categorieIdFinal, computePrice,
        computePrice === 'fixe' ? Number(prix) : null,
        computePrice !== 'fixe' ? Number(pourcentage) : null,
        quantiteMin === '' || quantiteMin == null ? 0 : Number(quantiteMin),
        dateDebut || null, dateFin || null,
      ]
    );
    const created = await pool.query(
      `SELECT lpl.id, lpl.applied_on AS "appliedOn", lpl.compute_price AS "computePrice",
              lpl.prix::float8 AS prix, lpl.pourcentage::float8 AS pourcentage,
              lpl.quantite_min::float8 AS "quantiteMin",
              to_char(lpl.date_debut, 'YYYY-MM-DD') AS "dateDebut", to_char(lpl.date_fin, 'YYYY-MM-DD') AS "dateFin",
              lpl.stock_id AS "stockId", p.nom AS "stockNom",
              lpl.template_id AS "templateId", pt.nom AS "templateNom",
              lpl.categorie_id AS "categorieId", pc.nom AS "categorieNom"
       FROM listes_prix_lignes lpl
       LEFT JOIN produits p ON p.id = lpl.stock_id
       LEFT JOIN produit_templates pt ON pt.id = lpl.template_id
       LEFT JOIN produit_categories pc ON pc.id = lpl.categorie_id
       WHERE lpl.id = $1`,
      [result.rows[0].id]
    );
    return res.status(201).json({ ligne: created.rows[0] });
  } catch (err) {
    console.error('[POST /listes-prix/:id/lignes]', err);
    return res.status(500).json({ error: "Erreur lors de l'enregistrement de la ligne." });
  }
});

// Jointure (USING) vers listes_prix pour vérifier le cloisonnement par entreprise en une
// seule requête — listes_prix_lignes n'a pas sa propre colonne entreprise_id, même pattern
// que la suppression d'une intervention de maintenance dans routes/equipements.js.
router.delete('/lignes/:ligneId', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM listes_prix_lignes lpl
       USING listes_prix lp
       WHERE lpl.id = $1 AND lpl.liste_prix_id = lp.id AND lp.entreprise_id = $2`,
      [req.params.ligneId, req.user.entrepriseId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Ligne introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /listes-prix/lignes/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression de la ligne.' });
  }
});

export default router;
