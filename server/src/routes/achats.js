import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { syncAchatDocumentFinance, removeFinanceEntry } from '../utils/financeSync.js';
import { applyAchatLignesToStock, reverseAchatLignesFromStock } from '../utils/stockSync.js';
import { log } from '../utils/journal.js';

const router = express.Router();

// Sans préfixe d'alias : réutilisée telle quelle dans un INSERT ... RETURNING
// (POST) et un SELECT ... FROM achats_documents sans alias (GET liste), en plus
// getDocumentComplete (dont l'alias "ad" a été retiré, voir plus bas) — un préfixe "ad." cassait
// les deux premières (colonne introuvable, "ad" hors de portée).
// `date` est une colonne DATE : renvoyée brute, node-postgres la transforme en Date JS
// interprétée dans le fuseau du serveur, ce qui décale l'affichage d'un jour côté client.
// to_char la fige en jour civil, même correctif que validity_date/date_echeance ailleurs.
const DOCUMENT_COLUMNS = `
  id, numero, module, to_char(date, 'YYYY-MM-DD') AS date, fournisseur_id AS "fournisseurId",
  fournisseur_nom AS "fournisseurNom", notes, total::float8 AS total, statut,
  etat_reception AS "etatReception",
  date_reception AS "dateReception", created_at AS "createdAt",
  -- Acheteur : même résolution que le vendeur d'un devis. Sous-requête obligatoire ici —
  -- DOCUMENT_COLUMNS sert aussi dans un INSERT ... RETURNING et dans un SELECT aliasé "ad",
  -- et n'est pas qualifiée : une jointure rendrait "id" et "entreprise_id" ambigus.
  (SELECT COALESCE(NULLIF(btrim(s.prenom || ' ' || s.nom), ''), u.email)
     FROM users u
     LEFT JOIN salaries s ON s.user_id = u.id AND s.entreprise_id = achats_documents.entreprise_id
    WHERE u.id = achats_documents.user_id) AS "acheteurNom"
`;

// Référence lisible d'un achat (ACH-2026-0007). Contrairement à genererNumero() dans
// routes/devis.js, le numéro ne se déduit pas des lignes existantes : ni un COUNT ni un MAX ne
// conviennent, tous deux réattribuent au suivant la référence d'un achat supprimé — deux pièces
// distinctes portant alors le même numéro dans l'historique d'un fournisseur. Le compteur
// achats_numero_sequence n'est jamais décrémenté : une suppression laisse un trou, ce qui est
// le comportement attendu d'une numérotation de pièces.
//
// L'UPSERT est atomique — pas de verrou explicite, pas de fenêtre de course entre deux
// créations simultanées. L'année vient de date_entreprise() et non de l'horloge serveur, pour
// rester cohérente avec le fuseau de l'entreprise.
async function genererNumeroAchat(client, entrepriseId) {
  const { rows } = await client.query(
    `WITH annee_courante AS (SELECT EXTRACT(YEAR FROM date_entreprise($1))::INT AS annee)
     INSERT INTO achats_numero_sequence (entreprise_id, annee, dernier)
     SELECT $1, annee, 1 FROM annee_courante
     ON CONFLICT (entreprise_id, annee)
     DO UPDATE SET dernier = achats_numero_sequence.dernier + 1
     RETURNING annee, dernier`,
    [entrepriseId]
  );
  const { annee, dernier } = rows[0];
  return `ACH-${annee}-${String(Number(dernier)).padStart(4, '0')}`;
}

const LIGNE_COLUMNS = `
  al.id, al.produit, al.quantite::float8 AS quantite, al.prix_unitaire::float8 AS "prixUnitaire", al.ordre,
  al.stock_id AS "stockId", al.uom_id AS "uomId", um.symbole AS "uomSymbole"
`;

// Ne garde qu'un stockId qui appartient réellement à l'entreprise appelante ET au bon
// module (isolation multi-tenant, même précaution que validerRecolteIds dans devis.js —
// le filtre module est devenu nécessaire depuis la fusion produits du 2026-08-18 : un id
// valide mais du mauvais module doit être rejeté, ce qui ne pouvait pas arriver avant
// puisqu'un id n'existait alors que dans une seule des deux tables) — stocke null sinon
// plutôt que de rejeter, pour ne jamais bloquer un achat sur un id de stock invalide.
// Retourne une Map stockId -> uniteId (plutôt qu'un simple Set) : sert aussi de repli pour
// l'unité par défaut d'une ligne quand aucun uomId n'est fourni (étape 1 UoM).
async function validerStockIds(client, module, lignes, entrepriseId) {
  const ids = [...new Set(lignes.map(l => l.stockId).filter(Boolean))];
  if (!['Cultures', 'Poulailler', 'Pisciculture'].includes(module) || ids.length === 0) return new Map();
  const result = await client.query(
    'SELECT id, unite_id AS "uniteId" FROM produits WHERE id = ANY($1::int[]) AND entreprise_id = $2 AND module = $3',
    [ids, entrepriseId, module]
  );
  return new Map(result.rows.map(r => [r.id, r.uniteId]));
}

// Résout l'uom_id effectif d'une ligne : l'unité fournie si elle appartient bien à
// l'entreprise appelante, sinon l'unité de base du produit catalogué en repli (défaut
// implicite d'Odoo : une ligne sans uom explicite hérite de l'uom du produit), sinon null
// (produit en texte libre non catalogué, ou produit sans unité de base définie).
async function resolveUomId(client, entrepriseId, uomId, produitUniteId) {
  if (uomId) {
    const check = await client.query('SELECT id FROM unites_mesure WHERE id = $1 AND entreprise_id = $2', [uomId, entrepriseId]);
    if (check.rows.length > 0) return uomId;
  }
  return produitUniteId ?? null;
}

async function getDocumentComplete(documentId, entrepriseId) {
  const documentResult = await pool.query(
    `SELECT ${DOCUMENT_COLUMNS} FROM achats_documents WHERE id = $1 AND entreprise_id = $2`,
    [documentId, entrepriseId]
  );
  if (documentResult.rows.length === 0) return null;

  const lignesResult = await pool.query(
    `SELECT ${LIGNE_COLUMNS} FROM achats_lignes al LEFT JOIN unites_mesure um ON um.id = al.uom_id
     WHERE al.document_id = $1 ORDER BY al.ordre ASC`,
    [documentId]
  );

  return { ...documentResult.rows[0], lignes: lignesResult.rows };
}

router.get('/', authRequired, async (req, res) => {
  const { module, fournisseurId } = req.query;
  // fournisseurId alimente le bouton intelligent "Achats (N)" sur la fiche
  // fournisseur (ContactsTab) : contrairement au reste de cette route, on veut
  // alors les deux modules à la fois (un fournisseur n'est pas rattaché à un
  // seul module), donc `module` devient optionnel dans ce seul cas.
  if (!module && !fournisseurId) {
    return res.status(400).json({ error: 'Le module est requis (Cultures ou Poulailler).' });
  }
  try {
    const conditions = ['entreprise_id = $1'];
    const params = [req.user.entrepriseId];
    if (module) {
      params.push(module);
      conditions.push(`module = $${params.length}`);
    }
    if (fournisseurId) {
      params.push(fournisseurId);
      conditions.push(`fournisseur_id = $${params.length}`);
    }
    const result = await pool.query(
      `SELECT ${DOCUMENT_COLUMNS} FROM achats_documents WHERE ${conditions.join(' AND ')} ORDER BY date DESC, created_at DESC`,
      params
    );
    return res.json({ documents: result.rows });
  } catch (err) {
    log.error('[GET /achats]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des achats.' });
  }
});

// Achats en lignes individuelles (une ligne par produit), pour alimenter le sous-onglet
// Comptabilité de chaque module — remplace l'ancienne source cultures_mouvements/
// poulailler_mouvements, jamais alimentée par ce formulaire multi-lignes. Ne remonte que
// les documents effectivement reçus : un brouillon ou une commande en attente n'est pas
// encore une dépense engagée (même principe que le ledger des devis, qui exclut Brouillon).
router.get('/ledger', authRequired, async (req, res) => {
  const { module } = req.query;
  if (!module) {
    return res.status(400).json({ error: 'Le module est requis (Cultures ou Poulailler).' });
  }
  try {
    const result = await pool.query(
      `SELECT al.id, ad.date, al.produit,
              ad.fournisseur_nom AS partenaire,
              al.quantite::float8 AS quantite,
              al.prix_unitaire::float8 AS "prixUnitaire"
       FROM achats_lignes al
       JOIN achats_documents ad ON ad.id = al.document_id
       WHERE ad.entreprise_id = $1 AND ad.module = $2 AND ad.statut = 'Reçu'
       ORDER BY ad.date DESC, al.ordre ASC`,
      [req.user.entrepriseId, module]
    );
    return res.json({ mouvements: result.rows });
  } catch (err) {
    log.error('[GET /achats/ledger]', err);
    return res.status(500).json({ error: "Erreur lors de la récupération de l'historique des achats." });
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    const document = await getDocumentComplete(req.params.id, req.user.entrepriseId);
    if (!document) return res.status(404).json({ error: 'Document d\'achat introuvable.' });
    return res.json({ document });
  } catch (err) {
    log.error('[GET /achats/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération du document.' });
  }
});

// ═══════════════════════════════════════════════════════════
//  CRÉATION (Brouillon — ne synchronise ni le stock ni les finances,
//  voir POST /:id/recevoir pour le vrai point d'engagement)
// ═══════════════════════════════════════════════════════════

router.post('/', authRequired, async (req, res) => {
  const { module, fournisseurId, fournisseurNom, notes, date, lignes } = req.body;
  if (!module || !['Cultures', 'Poulailler', 'Pisciculture'].includes(module)) {
    return res.status(400).json({ error: 'Le module est requis et doit être Cultures ou Poulailler.' });
  }
  if (!fournisseurId && !fournisseurNom) {
    return res.status(400).json({ error: 'Un fournisseur est requis.' });
  }
  if (!Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ error: 'Au moins une ligne d\'achat est requise.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const total = lignes.reduce((sum, ligne) => sum + (Number(ligne.quantite) || 0) * (Number(ligne.prixUnitaire) || 0), 0);

    const numero = await genererNumeroAchat(client, req.user.entrepriseId);

    const documentResult = await client.query(
      `INSERT INTO achats_documents (entreprise_id, user_id, module, date, fournisseur_id, fournisseur_nom, notes, total, statut, numero)
       VALUES ($1, $2, $3, COALESCE($4, date_entreprise($1)), $5, $6, $7, $8, 'Brouillon', $9)
       RETURNING ${DOCUMENT_COLUMNS}`,
      [req.user.entrepriseId, req.user.sub, module, date || null, fournisseurId || null, fournisseurNom || null, notes || null, total, numero]
    );

    const documentId = documentResult.rows[0].id;
    const stockIdsValides = await validerStockIds(client, module, lignes, req.user.entrepriseId);
    for (let i = 0; i < lignes.length; i += 1) {
      const ligne = lignes[i];
      const stockId = stockIdsValides.has(ligne.stockId) ? ligne.stockId : null;
      const uomId = await resolveUomId(client, req.user.entrepriseId, ligne.uomId, stockId ? stockIdsValides.get(stockId) : null);
      await client.query(
        `INSERT INTO achats_lignes (document_id, produit, quantite, prix_unitaire, ordre, stock_id, uom_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [documentId, ligne.produit, Number(ligne.quantite) || 0, Number(ligne.prixUnitaire) || 0, i, stockId, uomId]
      );
    }

    await client.query('COMMIT');
    const document = await getDocumentComplete(documentId, req.user.entrepriseId);
    return res.status(201).json({ document });
  } catch (err) {
    await client.query('ROLLBACK');
    log.error('[POST /achats]', err);
    return res.status(500).json({ error: 'Erreur lors de l\'enregistrement de l\'achat.' });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════
//  MODIFICATION / SUPPRESSION — uniquement avant réception (le stock et
//  les finances ne bougent qu'à la réception, donc rien à réconcilier ici)
// ═══════════════════════════════════════════════════════════

router.put('/:id', authRequired, async (req, res) => {
  const { module, fournisseurId, fournisseurNom, notes, date, lignes } = req.body;
  if (!module || !['Cultures', 'Poulailler', 'Pisciculture'].includes(module)) {
    return res.status(400).json({ error: 'Le module est requis et doit être Cultures ou Poulailler.' });
  }
  if (!fournisseurId && !fournisseurNom) {
    return res.status(400).json({ error: 'Un fournisseur est requis.' });
  }
  if (!Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ error: 'Au moins une ligne d\'achat est requise.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const check = await client.query(
      'SELECT id, statut FROM achats_documents WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (check.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Document d\'achat introuvable.' });
    }
    if (!['Brouillon', 'Commandé'].includes(check.rows[0].statut)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ce document ne peut plus être modifié une fois reçu.' });
    }

    const total = lignes.reduce((sum, ligne) => sum + (Number(ligne.quantite) || 0) * (Number(ligne.prixUnitaire) || 0), 0);

    await client.query(
      `UPDATE achats_documents SET module = $1, date = COALESCE($2, date), fournisseur_id = $3, fournisseur_nom = $4, notes = $5, total = $6
       WHERE id = $7 AND entreprise_id = $8`,
      [module, date || null, fournisseurId || null, fournisseurNom || null, notes || null, total, req.params.id, req.user.entrepriseId]
    );

    await client.query('DELETE FROM achats_lignes WHERE document_id = $1', [req.params.id]);
    const stockIdsValides = await validerStockIds(client, module, lignes, req.user.entrepriseId);
    for (let i = 0; i < lignes.length; i += 1) {
      const ligne = lignes[i];
      const stockId = stockIdsValides.has(ligne.stockId) ? ligne.stockId : null;
      const uomId = await resolveUomId(client, req.user.entrepriseId, ligne.uomId, stockId ? stockIdsValides.get(stockId) : null);
      await client.query(
        `INSERT INTO achats_lignes (document_id, produit, quantite, prix_unitaire, ordre, stock_id, uom_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.params.id, ligne.produit, Number(ligne.quantite) || 0, Number(ligne.prixUnitaire) || 0, i, stockId, uomId]
      );
    }

    await client.query('COMMIT');
    const document = await getDocumentComplete(req.params.id, req.user.entrepriseId);
    return res.json({ document });
  } catch (err) {
    await client.query('ROLLBACK');
    log.error('[PUT /achats/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du document.' });
  } finally {
    client.release();
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    // achats_lignes n'a pas sa propre colonne entreprise_id (rattachée uniquement
    // via document_id) : il faut vérifier l'appartenance du document AVANT de
    // supprimer ses lignes, sinon n'importe quel utilisateur authentifié pourrait
    // effacer les lignes d'un document d'une autre entreprise en devinant son id.
    const check = await pool.query('SELECT id, statut FROM achats_documents WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Document d\'achat introuvable.' });
    }
    if (!['Brouillon', 'Commandé'].includes(check.rows[0].statut)) {
      return res.status(400).json({ error: 'Un document déjà reçu ne peut plus être supprimé — annulez la réception d\'abord.' });
    }
    await pool.query('DELETE FROM achats_lignes WHERE document_id = $1', [req.params.id]);
    await pool.query('DELETE FROM achats_documents WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    return res.json({ success: true });
  } catch (err) {
    log.error('[DELETE /achats/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression du document.' });
  }
});

// ═══════════════════════════════════════════════════════════
//  CYCLE DE VIE : Brouillon → Commandé → Reçu (annulable)
// ═══════════════════════════════════════════════════════════

// Engage la commande auprès du fournisseur — aucun effet sur le stock ni les finances,
// juste un marqueur de commitment (miroir du passage Brouillon→Envoyé côté devis).
// ─── Axe COMMANDE : Brouillon → Envoyée → Commandé, et Annulée en sortie ───
// Repris de purchase.order dans l'ERP de référence (draft → sent → purchase → cancel). L'étape
// « Envoyée » manquait : rien ne distinguait un achat qu'on prépare d'une demande déjà partie
// chez le fournisseur. Aucune de ces transitions ne touche au stock ni aux finances — c'est
// désormais l'axe réception qui s'en charge, plus bas.

router.post('/:id/envoyer', authRequired, async (req, res) => {
  try {
    const check = await pool.query('SELECT statut FROM achats_documents WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Document d\'achat introuvable.' });
    if (check.rows[0].statut !== 'Brouillon') {
      return res.status(400).json({ error: 'Seul un brouillon peut être envoyé au fournisseur.' });
    }
    await pool.query(`UPDATE achats_documents SET statut = 'Envoyée' WHERE id = $1`, [req.params.id]);
    const document = await getDocumentComplete(req.params.id, req.user.entrepriseId);
    return res.json({ document });
  } catch (err) {
    log.error('[POST /achats/:id/envoyer]', err);
    return res.status(500).json({ error: 'Erreur lors de l\'envoi au fournisseur.' });
  }
});

router.post('/:id/commander', authRequired, async (req, res) => {
  try {
    const check = await pool.query('SELECT statut FROM achats_documents WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Document d\'achat introuvable.' });
    if (!['Brouillon', 'Envoyée'].includes(check.rows[0].statut)) {
      return res.status(400).json({ error: 'Seul un brouillon ou une demande envoyée peut être confirmé en commande.' });
    }
    await pool.query(`UPDATE achats_documents SET statut = 'Commandé' WHERE id = $1`, [req.params.id]);
    const document = await getDocumentComplete(req.params.id, req.user.entrepriseId);
    return res.json({ document });
  } catch (err) {
    log.error('[POST /achats/:id/commander]', err);
    return res.status(500).json({ error: 'Erreur lors du passage en commande.' });
  }
});

// Annuler reste possible tant que rien n'est arrivé. Une commande dont la marchandise est là
// n'est plus annulable : il faudrait d'abord annuler la réception, donc défaire le stock et
// l'écriture de finances — le refuser ici évite de rendre ces deux opérations implicites.
router.post('/:id/annuler', authRequired, async (req, res) => {
  try {
    const check = await pool.query(
      'SELECT statut, etat_reception AS "etatReception" FROM achats_documents WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Document d\'achat introuvable.' });
    const { statut, etatReception } = check.rows[0];
    if (statut === 'Annulée') return res.status(400).json({ error: 'Ce document est déjà annulé.' });
    if (etatReception !== 'en_attente') {
      return res.status(400).json({ error: 'Annulez d\'abord la réception avant d\'annuler la commande.' });
    }
    await pool.query(`UPDATE achats_documents SET statut = 'Annulée' WHERE id = $1`, [req.params.id]);
    const document = await getDocumentComplete(req.params.id, req.user.entrepriseId);
    return res.json({ document });
  } catch (err) {
    log.error('[POST /achats/:id/annuler]', err);
    return res.status(500).json({ error: 'Erreur lors de l\'annulation.' });
  }
});

router.post('/:id/remettre-brouillon', authRequired, async (req, res) => {
  try {
    const check = await pool.query('SELECT statut FROM achats_documents WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Document d\'achat introuvable.' });
    if (check.rows[0].statut !== 'Annulée') {
      return res.status(400).json({ error: 'Seul un document annulé peut revenir en brouillon.' });
    }
    await pool.query(`UPDATE achats_documents SET statut = 'Brouillon' WHERE id = $1`, [req.params.id]);
    const document = await getDocumentComplete(req.params.id, req.user.entrepriseId);
    return res.json({ document });
  } catch (err) {
    log.error('[POST /achats/:id/remettre-brouillon]', err);
    return res.status(500).json({ error: 'Erreur lors du retour en brouillon.' });
  }
});

// ─── Axe RÉCEPTION : en_attente → partiel → recu ───
// Indépendant de l'axe commande, comme receipt_status dans l'ERP de référence. C'est ici, et
// nulle part ailleurs, que le stock et les finances bougent.
//
// « Partiellement reçu » est un CONSTAT, pas un mouvement : sans quantité reçue ligne par ligne,
// on ne sait pas quoi entrer en stock. L'état sert à l'équipe (« une partie est arrivée, la
// commande reste ouverte ») ; le stock et les finances attendent la réception complète. Passer
// aux quantités par ligne lèverait cette limite — c'est le chantier suivant si besoin.

router.post('/:id/reception-partielle', authRequired, async (req, res) => {
  try {
    const check = await pool.query(
      'SELECT statut, etat_reception AS "etatReception" FROM achats_documents WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Document d\'achat introuvable.' });
    if (check.rows[0].statut !== 'Commandé') {
      return res.status(400).json({ error: 'Seule une commande confirmée peut recevoir de la marchandise.' });
    }
    if (check.rows[0].etatReception === 'recu') {
      return res.status(400).json({ error: 'Ce document est déjà entièrement reçu.' });
    }
    await pool.query(`UPDATE achats_documents SET etat_reception = 'partiel' WHERE id = $1`, [req.params.id]);
    const document = await getDocumentComplete(req.params.id, req.user.entrepriseId);
    return res.json({ document });
  } catch (err) {
    log.error('[POST /achats/:id/reception-partielle]', err);
    return res.status(500).json({ error: 'Erreur lors de la réception partielle.' });
  }
});

// Réception complète — c'est ce moment-là, pas la création ni la confirmation de commande, qui
// engage le stock et les finances (voir stockSync.js / financeSync.js).
router.post('/:id/recevoir', authRequired, async (req, res) => {
  try {
    const check = await pool.query(
      'SELECT statut, etat_reception AS "etatReception", module, total, fournisseur_nom AS "fournisseurNom" FROM achats_documents WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Document d\'achat introuvable.' });
    if (check.rows[0].statut !== 'Commandé') {
      return res.status(400).json({ error: 'Seule une commande confirmée peut être marquée comme reçue.' });
    }
    if (check.rows[0].etatReception === 'recu') {
      return res.status(400).json({ error: 'Ce document est déjà entièrement reçu.' });
    }
    const { module, total, fournisseurNom } = check.rows[0];

    await pool.query(`UPDATE achats_documents SET etat_reception = 'recu', date_reception = NOW() WHERE id = $1`, [req.params.id]);

    const lignesResult = await pool.query('SELECT produit, quantite::float8 AS quantite, stock_id AS "stockId", uom_id AS "uomId" FROM achats_lignes WHERE document_id = $1', [req.params.id]);
    await syncAchatDocumentFinance(req.user.entrepriseId, req.user.sub, {
      module, total, fournisseurNom, documentId: Number(req.params.id),
    });
    await applyAchatLignesToStock(req.user.entrepriseId, module, lignesResult.rows, {
      userId: req.user.sub, documentType: 'achat', documentId: Number(req.params.id), raison: 'achat_reception',
    });

    const document = await getDocumentComplete(req.params.id, req.user.entrepriseId);
    return res.json({ document });
  } catch (err) {
    log.error('[POST /achats/:id/recevoir]', err);
    return res.status(500).json({ error: 'Erreur lors de la réception.' });
  }
});

// Annule une réception déjà enregistrée — retire l'entrée finances et restitue le stock. Le
// statut de commande, lui, ne bouge pas : la commande reste confirmée, seule la marchandise
// repart. C'est précisément ce que la séparation des deux axes permet d'exprimer.
router.post('/:id/annuler-reception', authRequired, async (req, res) => {
  try {
    const check = await pool.query(
      'SELECT etat_reception AS "etatReception", module FROM achats_documents WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Document d\'achat introuvable.' });
    if (check.rows[0].etatReception !== 'recu') {
      return res.status(400).json({ error: 'Seul un document reçu peut voir sa réception annulée.' });
    }
    const { module } = check.rows[0];

    const lignesResult = await pool.query('SELECT produit, quantite::float8 AS quantite, stock_id AS "stockId", uom_id AS "uomId" FROM achats_lignes WHERE document_id = $1', [req.params.id]);
    await removeFinanceEntry(req.user.entrepriseId, module, req.params.id);
    await reverseAchatLignesFromStock(req.user.entrepriseId, module, lignesResult.rows, {
      userId: req.user.sub, documentType: 'achat', documentId: Number(req.params.id), raison: 'achat_annulation_reception',
    });

    await pool.query(`UPDATE achats_documents SET etat_reception = 'en_attente', date_reception = NULL WHERE id = $1`, [req.params.id]);
    const document = await getDocumentComplete(req.params.id, req.user.entrepriseId);
    return res.json({ document });
  } catch (err) {
    log.error('[POST /achats/:id/annuler-reception]', err);
    return res.status(500).json({ error: "Erreur lors de l'annulation de la réception." });
  }
});

export default router;