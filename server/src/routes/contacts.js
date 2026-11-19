// Contacts (clients + fournisseurs unifiés, 2026-08-18) — remplace les anciens
// /api/business/clients* et /api/business/fournisseurs*, fusionnés dans une seule table
// contacts avec deux booléens indépendants est_client/est_fournisseur (un même contact
// réel peut être les deux à la fois, voir server/src/db/socle.js:mergeClientsFournisseursIntoContacts
// pour la migration des données existantes, y compris le rapprochement automatique des
// fiches qui représentaient déjà la même entité des deux côtés).
//
// Architecture façon fiche contact d'un ERP de référence (2026-08-27) : is_company/photo/fonction/notes,
// rattachement société mère (parent_id) + sous-contacts, tags colorés — voir socle.js
// pour le détail du schéma et project_erp_contact_architecture pour le contexte complet.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';

const router = express.Router();

// Ne garde qu'un listePrixId qui appartient réellement à l'entreprise appelante — même
// posture que partout ailleurs dans l'app (ex: validerStockIds dans achats.js) : renvoie
// null silencieusement plutôt que de rejeter toute la requête sur un id invalide.
async function resolveListePrixId(entrepriseId, listePrixId) {
  if (listePrixId == null) return null;
  const result = await pool.query('SELECT id FROM listes_prix WHERE id = $1 AND entreprise_id = $2', [listePrixId, entrepriseId]);
  return result.rows[0]?.id ?? null;
}

// Un parent_id n'est retenu que s'il appartient à la même entreprise ET désigne bien une
// société (is_company = true) — même posture "silencieusement null plutôt que 400" que
// resolveListePrixId ci-dessus. Empêche aussi un contact de se désigner lui-même comme sa
// propre société mère (aucune boucle réelle n'est possible autrement, la hiérarchie n'a
// qu'un seul niveau ici, contrairement à un ERP de référence qui autorise des chaînes plus longues).
async function resolveParentId(entrepriseId, parentId, ownId) {
  if (parentId == null) return null;
  if (ownId != null && Number(parentId) === Number(ownId)) return null;
  const result = await pool.query(
    'SELECT id FROM contacts WHERE id = $1 AND entreprise_id = $2 AND is_company = true',
    [parentId, entrepriseId]
  );
  return result.rows[0]?.id ?? null;
}

// Ne garde que les tagIds qui appartiennent réellement à l'entreprise appelante — filtre
// silencieusement plutôt que de rejeter (même posture que le reste de ce fichier).
async function resolveTagIds(entrepriseId, tagIds) {
  if (!Array.isArray(tagIds) || tagIds.length === 0) return [];
  const result = await pool.query(
    'SELECT id FROM contact_tags WHERE entreprise_id = $1 AND id = ANY($2::int[])',
    [entrepriseId, tagIds.map(Number)]
  );
  return result.rows.map(r => r.id);
}

async function syncContactTags(contactId, tagIds) {
  await pool.query('DELETE FROM contacts_tags_rel WHERE contact_id = $1', [contactId]);
  if (tagIds.length === 0) return;
  const values = tagIds.map((_, i) => `($1, $${i + 2})`).join(', ');
  await pool.query(`INSERT INTO contacts_tags_rel (contact_id, tag_id) VALUES ${values}`, [contactId, ...tagIds]);
}

const CONTACT_COLUMNS = `
  c.id, c.nom, c.prenom, c.telephone, c.email, c.siret, c.adresse,
  c.adresse_rue AS "adresseRue", c.adresse_rue2 AS "adresseRue2", c.adresse_ville AS "adresseVille",
  c.adresse_code_postal AS "adresseCodePostal", c.adresse_region AS "adresseRegion", c.adresse_pays AS "adressePays",
  c.est_client AS "estClient", c.est_fournisseur AS "estFournisseur",
  c.liste_prix_id AS "listePrixId", c.is_company AS "isCompany", c.photo, c.fonction, c.notes,
  c.parent_id AS "parentId", p.nom AS "parentNom", c.created_at AS "createdAt",
  c.devise_facturation AS "deviseFacturation"
`;

async function attachTags(entrepriseId, contactRows) {
  if (contactRows.length === 0) return contactRows;
  const ids = contactRows.map(c => c.id);
  const tagsResult = await pool.query(
    `SELECT ctr.contact_id AS "contactId", ct.id, ct.nom, ct.couleur
     FROM contacts_tags_rel ctr JOIN contact_tags ct ON ct.id = ctr.tag_id
     WHERE ctr.contact_id = ANY($1::int[]) AND ct.entreprise_id = $2`,
    [ids, entrepriseId]
  );
  const parTag = new Map();
  for (const row of tagsResult.rows) {
    if (!parTag.has(row.contactId)) parTag.set(row.contactId, []);
    parTag.get(row.contactId).push({ id: row.id, nom: row.nom, couleur: row.couleur });
  }
  return contactRows.map(c => ({ ...c, tags: parTag.get(c.id) || [] }));
}

router.get('/', authRequired, async (req, res) => {
  const { type, parentId } = req.query;
  try {
    const conditions = ['c.entreprise_id = $1'];
    const params = [req.user.entrepriseId];
    if (type === 'client') conditions.push('c.est_client = true');
    else if (type === 'fournisseur') conditions.push('c.est_fournisseur = true');
    if (parentId) {
      params.push(parentId);
      conditions.push(`c.parent_id = $${params.length}`);
    }
    const result = await pool.query(
      `SELECT ${CONTACT_COLUMNS} FROM contacts c LEFT JOIN contacts p ON p.id = c.parent_id
       WHERE ${conditions.join(' AND ')} ORDER BY c.id DESC`,
      params
    );
    const withTags = await attachTags(req.user.entrepriseId, result.rows);
    return res.json({ contacts: withTags });
  } catch (err) {
    console.error('[GET /contacts]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des contacts.' });
  }
});

router.post('/', authRequired, async (req, res) => {
  const { nom, prenom, telephone, adresse, email, siret, estClient, estFournisseur, listePrixId,
          adresseRue, adresseRue2, adresseVille, adresseCodePostal, adresseRegion, adressePays,
          isCompany, photo, fonction, notes, parentId, tagIds, deviseFacturation } = req.body;
  if (!nom) {
    return res.status(400).json({ error: 'Le nom du contact est requis.' });
  }
  if (!estClient && !estFournisseur) {
    return res.status(400).json({ error: 'Un contact doit être client, fournisseur, ou les deux.' });
  }
  try {
    const listePrixValide = await resolveListePrixId(req.user.entrepriseId, listePrixId);
    const parentValide = await resolveParentId(req.user.entrepriseId, parentId, null);
    const tagsValides = await resolveTagIds(req.user.entrepriseId, tagIds);
    const result = await pool.query(
      `INSERT INTO contacts (entreprise_id, user_id, nom, prenom, telephone, adresse, email, siret, est_client, est_fournisseur, liste_prix_id,
                              adresse_rue, adresse_rue2, adresse_ville, adresse_code_postal, adresse_region, adresse_pays,
                              is_company, photo, fonction, notes, parent_id, devise_facturation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
       RETURNING id`,
      [req.user.entrepriseId, req.user.sub, nom, prenom || null, telephone || null, adresse || null, email || null, siret || null, Boolean(estClient), Boolean(estFournisseur), listePrixValide,
       adresseRue || null, adresseRue2 || null, adresseVille || null, adresseCodePostal || null, adresseRegion || null, adressePays || null,
       Boolean(isCompany), photo || null, fonction || null, notes || null, parentValide, deviseFacturation || null]
    );
    const newId = result.rows[0].id;
    await syncContactTags(newId, tagsValides);
    const complet = await pool.query(
      `SELECT ${CONTACT_COLUMNS} FROM contacts c LEFT JOIN contacts p ON p.id = c.parent_id WHERE c.id = $1`,
      [newId]
    );
    const [withTags] = await attachTags(req.user.entrepriseId, complet.rows);
    return res.status(201).json({ contact: withTags });
  } catch (err) {
    console.error('[POST /contacts]', err);
    return res.status(500).json({ error: 'Erreur lors de la création du contact.' });
  }
});

router.put('/:id', authRequired, async (req, res) => {
  const { nom, prenom, telephone, adresse, email, siret, estClient, estFournisseur,
          adresseRue, adresseRue2, adresseVille, adresseCodePostal, adresseRegion, adressePays,
          isCompany, photo, fonction, notes, tagIds, deviseFacturation } = req.body;
  if (estClient === false && estFournisseur === false) {
    return res.status(400).json({ error: 'Un contact doit être client, fournisseur, ou les deux.' });
  }
  // listePrixId/parentId/deviseFacturation ont besoin de distinguer "non fourni" (ne pas
  // toucher) de "fourni à null" (désassigner, ex: repasser à la devise de l'entreprise) — un
  // simple COALESCE($n, colonne) ne peut jamais écrire NULL.
  const listePrixFourni = Object.prototype.hasOwnProperty.call(req.body, 'listePrixId');
  const parentFourni = Object.prototype.hasOwnProperty.call(req.body, 'parentId');
  const deviseFourni = Object.prototype.hasOwnProperty.call(req.body, 'deviseFacturation');
  try {
    const listePrixValide = listePrixFourni ? await resolveListePrixId(req.user.entrepriseId, req.body.listePrixId) : null;
    const parentValide = parentFourni ? await resolveParentId(req.user.entrepriseId, req.body.parentId, req.params.id) : null;
    const result = await pool.query(
      `UPDATE contacts SET
         nom = COALESCE($1, nom),
         prenom = COALESCE($2, prenom),
         telephone = COALESCE($3, telephone),
         adresse = COALESCE($4, adresse),
         email = COALESCE($5, email),
         siret = COALESCE($6, siret),
         est_client = COALESCE($7, est_client),
         est_fournisseur = COALESCE($8, est_fournisseur),
         liste_prix_id = CASE WHEN $9 THEN $10 ELSE liste_prix_id END,
         adresse_rue = COALESCE($11, adresse_rue),
         adresse_ville = COALESCE($12, adresse_ville),
         adresse_code_postal = COALESCE($13, adresse_code_postal),
         adresse_pays = COALESCE($14, adresse_pays),
         is_company = COALESCE($15, is_company),
         photo = COALESCE($16, photo),
         fonction = COALESCE($17, fonction),
         notes = COALESCE($18, notes),
         adresse_rue2 = COALESCE($19, adresse_rue2),
         adresse_region = COALESCE($20, adresse_region),
         parent_id = CASE WHEN $21 THEN $22 ELSE parent_id END,
         devise_facturation = CASE WHEN $25 THEN $26 ELSE devise_facturation END
       WHERE id = $23 AND entreprise_id = $24
       RETURNING id`,
      [nom, prenom, telephone, adresse, email, siret, estClient, estFournisseur, listePrixFourni, listePrixValide,
       adresseRue, adresseVille, adresseCodePostal, adressePays, isCompany, photo, fonction, notes,
       adresseRue2, adresseRegion, parentFourni, parentValide, req.params.id, req.user.entrepriseId,
       deviseFourni, deviseFacturation || null]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact introuvable.' });
    }
    if (Array.isArray(tagIds)) {
      const tagsValides = await resolveTagIds(req.user.entrepriseId, tagIds);
      await syncContactTags(req.params.id, tagsValides);
    }
    const complet = await pool.query(
      `SELECT ${CONTACT_COLUMNS} FROM contacts c LEFT JOIN contacts p ON p.id = c.parent_id WHERE c.id = $1`,
      [req.params.id]
    );
    const [withTags] = await attachTags(req.user.entrepriseId, complet.rows);
    return res.json({ contact: withTags });
  } catch (err) {
    if (err.code === '23514') {
      // Violation du CHECK (est_client OR est_fournisseur) — les deux flags retombent à false.
      return res.status(400).json({ error: 'Un contact doit être client, fournisseur, ou les deux.' });
    }
    console.error('[PUT /contacts]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du contact.' });
  }
});

// Prix effectifs d'un contact : les lignes de la liste de prix qui lui est assignée, s'il
// en a une. Remplace l'ancien GET /prix-client?clientId=X — un contact sans liste
// assignée renvoie une liste vide, laissant chaque article retomber sur son prix par défaut.
router.get('/:id/prix-effectifs', authRequired, async (req, res) => {
  try {
    const contact = await pool.query('SELECT liste_prix_id FROM contacts WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    if (contact.rows.length === 0) return res.status(404).json({ error: 'Contact introuvable.' });
    const listePrixId = contact.rows[0].liste_prix_id;
    if (!listePrixId) return res.json({ prix: [] });
    const result = await pool.query(
      `SELECT lpl.id, lpl.stock_id AS "stockId", lpl.prix::float8 AS prix, p.nom AS "stockNom"
       FROM listes_prix_lignes lpl JOIN produits p ON p.id = lpl.stock_id
       WHERE lpl.liste_prix_id = $1
       ORDER BY p.nom ASC`,
      [listePrixId]
    );
    return res.json({ prix: result.rows });
  } catch (err) {
    console.error('[GET /contacts/:id/prix-effectifs]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des prix.' });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM contacts WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    // Comme PUT /:id : 0 ligne = id inexistant OU appartenant à une autre entreprise → 404,
    // plutôt qu'un { success: true } trompeur (incohérent avec le reste des routes DELETE).
    if (result.rowCount === 0) return res.status(404).json({ error: 'Contact introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    if (err.code === '23503') {
      // Violation de clé étrangère : ce contact est référencé ailleurs (devis, etc.)
      return res.status(409).json({ error: 'Ce contact a des devis ou factures enregistrés et ne peut pas être supprimé.' });
    }
    console.error('[DELETE /contacts]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

export default router;
