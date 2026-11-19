// Registre des traitements phytosanitaires / apports d'intrants (étape C « élargissement
// stock »). Journal réglementaire : quelle parcelle a reçu quel produit, à quelle dose,
// quand, par qui. Le DAR (délai avant récolte) est figé à la saisie. Une application peut
// décrémenter le stock du produit (quantite_utilisee) — restitué à la suppression.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { consommerProduit, restituerProduit } from '../utils/stockSync.js';
import { log } from '../utils/journal.js';

const router = express.Router();

const APP_COLUMNS = `
  a.id, a.parcelle_id AS "parcelleId", a.produit_id AS "produitId", a.lot_id AS "lotId",
  a.produit_nom AS "produitNom", a.parcelle_nom AS "parcelleNom",
  to_char(a.date_application, 'YYYY-MM-DD') AS "dateApplication",
  a.dose::float8 AS dose, a.dose_unite AS "doseUnite",
  a.surface_traitee_ha::float8 AS "surfaceTraiteeHa",
  a.quantite_utilisee::float8 AS "quantiteUtilisee",
  a.operateur, a.cible,
  to_char(a.dar_calcule, 'YYYY-MM-DD') AS "darCalcule",
  a.znt_respectee AS "zntRespectee", a.notes, a.created_at AS "createdAt",
  p.nom AS "produitNomActuel", p.dar_jours AS "produitDarJours",
  pc.nom AS "parcelleNomActuel"
`;

const joined = `FROM applications_intrants a
  LEFT JOIN produits p ON p.id = a.produit_id
  LEFT JOIN parcelles pc ON pc.id = a.parcelle_id`;

router.get('/', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${APP_COLUMNS} ${joined}
       WHERE a.entreprise_id = $1
       ORDER BY a.date_application DESC, a.id DESC`,
      [req.user.entrepriseId]
    );
    return res.json({ applications: rows });
  } catch (err) {
    log.error('[GET /applications-intrants]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération du registre.' });
  }
});

router.post('/', authRequired, async (req, res) => {
  const b = req.body;
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const txt = (v) => (v === '' || v == null ? null : String(v).trim() || null);
  const dateApplication = txt(b.dateApplication) || new Date().toISOString().slice(0, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Appartenance : on ne garde parcelle/produit/lot que s'ils sont bien à l'entreprise
    // (sinon null, comme recoltes/devis) ; on capture aussi les noms + le dar_jours du produit.
    let produitId = null;
    let produitNom = null;
    let produitModule = null;
    let produitDarJours = null;
    if (b.produitId) {
      const r = await client.query(
        'SELECT id, nom, module, dar_jours FROM produits WHERE id = $1 AND entreprise_id = $2',
        [b.produitId, req.user.entrepriseId]
      );
      if (r.rows[0]) {
        produitId = r.rows[0].id;
        produitNom = r.rows[0].nom;
        produitModule = r.rows[0].module;
        produitDarJours = r.rows[0].dar_jours;
      }
    }
    let parcelleId = null;
    let parcelleNom = null;
    if (b.parcelleId) {
      const r = await client.query('SELECT id, nom FROM parcelles WHERE id = $1 AND entreprise_id = $2', [b.parcelleId, req.user.entrepriseId]);
      if (r.rows[0]) { parcelleId = r.rows[0].id; parcelleNom = r.rows[0].nom; }
    }
    let lotId = null;
    if (b.lotId) {
      const r = await client.query('SELECT id FROM stock_lots WHERE id = $1 AND entreprise_id = $2', [b.lotId, req.user.entrepriseId]);
      if (r.rows[0]) lotId = r.rows[0].id;
    }

    // DAR calculé = date d'application + dar_jours du produit (figé à la saisie).
    const darCalcule = produitDarJours != null
      ? new Date(new Date(dateApplication + 'T00:00:00Z').getTime() + produitDarJours * 86400000).toISOString().slice(0, 10)
      : null;

    const quantiteUtilisee = num(b.quantiteUtilisee);
    const ins = await client.query(
      `INSERT INTO applications_intrants
        (entreprise_id, user_id, parcelle_id, produit_id, lot_id, produit_nom, parcelle_nom,
         date_application, dose, dose_unite, surface_traitee_ha, quantite_utilisee, operateur,
         cible, dar_calcule, znt_respectee, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [req.user.entrepriseId, req.user.sub, parcelleId, produitId, lotId, produitNom, parcelleNom,
       dateApplication, num(b.dose), txt(b.doseUnite), num(b.surfaceTraiteeHa), quantiteUtilisee, txt(b.operateur),
       txt(b.cible), darCalcule, b.zntRespectee == null ? null : (b.zntRespectee === true || b.zntRespectee === 'true'), txt(b.notes)]
    );

    await client.query('COMMIT');

    // Décrément du stock (hors transaction, comme le reste de stockSync qui écrit sur le pool).
    if (produitId && quantiteUtilisee > 0) {
      await consommerProduit(req.user.entrepriseId, {
        stockId: produitId, produitNom, stockModule: produitModule, quantite: quantiteUtilisee,
      }, { raison: 'application_intrant', documentType: 'application_intrant', documentId: ins.rows[0].id, userId: req.user.sub });
    }

    const { rows } = await pool.query(`SELECT ${APP_COLUMNS} ${joined} WHERE a.id = $1`, [ins.rows[0].id]);
    return res.status(201).json({ application: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    log.error('[POST /applications-intrants]', err);
    return res.status(500).json({ error: "Erreur lors de l'enregistrement de l'application." });
  } finally {
    client.release();
  }
});

// PUT : ne touche que les métadonnées (pas quantite_utilisee ni le produit — pour ré-imputer
// le stock il faut supprimer/recréer). dar_calcule est recalculé si la date change.
router.put('/:id', authRequired, async (req, res) => {
  const b = req.body;
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const txt = (v) => (v === '' || v == null ? null : String(v).trim() || null);
  try {
    const cur = await pool.query(
      `SELECT to_char(a.date_application, 'YYYY-MM-DD') AS date_application, p.dar_jours FROM applications_intrants a
       LEFT JOIN produits p ON p.id = a.produit_id
       WHERE a.id = $1 AND a.entreprise_id = $2`,
      [req.params.id, req.user.entrepriseId]
    );
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Application introuvable.' });
    const dateApplication = txt(b.dateApplication) || cur.rows[0].date_application;
    const darJours = cur.rows[0].dar_jours;
    const darCalcule = darJours != null
      ? new Date(new Date(dateApplication + 'T00:00:00Z').getTime() + darJours * 86400000).toISOString().slice(0, 10)
      : null;
    const result = await pool.query(
      `UPDATE applications_intrants SET
         date_application = $1, dose = $2, dose_unite = $3, surface_traitee_ha = $4,
         operateur = $5, cible = $6, dar_calcule = $7, znt_respectee = $8, notes = $9
       WHERE id = $10 AND entreprise_id = $11 RETURNING id`,
      [dateApplication, num(b.dose), txt(b.doseUnite), num(b.surfaceTraiteeHa), txt(b.operateur),
       txt(b.cible), darCalcule, b.zntRespectee == null ? null : (b.zntRespectee === true || b.zntRespectee === 'true'),
       txt(b.notes), req.params.id, req.user.entrepriseId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Application introuvable.' });
    const { rows } = await pool.query(`SELECT ${APP_COLUMNS} ${joined} WHERE a.id = $1`, [req.params.id]);
    return res.json({ application: rows[0] });
  } catch (err) {
    log.error('[PUT /applications-intrants/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const cur = await pool.query(
      `SELECT a.produit_id, a.produit_nom, a.quantite_utilisee::float8 AS q, p.module
       FROM applications_intrants a LEFT JOIN produits p ON p.id = a.produit_id
       WHERE a.id = $1 AND a.entreprise_id = $2`,
      [req.params.id, req.user.entrepriseId]
    );
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Application introuvable.' });
    await pool.query('DELETE FROM applications_intrants WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    const c = cur.rows[0];
    if (c.produit_id && c.q > 0) {
      await restituerProduit(req.user.entrepriseId, {
        stockId: c.produit_id, produitNom: c.produit_nom, stockModule: c.module, quantite: c.q,
      }, { raison: 'application_intrant_annulee', documentType: 'application_intrant', documentId: Number(req.params.id), userId: req.user.sub });
    }
    return res.json({ success: true });
  } catch (err) {
    log.error('[DELETE /applications-intrants/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

export default router;
