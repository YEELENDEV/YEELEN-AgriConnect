import express from 'express';
import bcrypt from 'bcryptjs';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { sendWelcomeEmail } from '../services/mailer.js';
import { validerMotDePasse, validerEmail, BCRYPT_COUT } from '../utils/motDePasse.js';
import { invaliderCacheRoles } from '../utils/rolesService.js';
import { logAuditEvent } from '../utils/auditLog.js';
import { logFieldChanges, getJournal } from '../utils/journalModifications.js';
import { calculerJoursOuvres, listerJoursOuvres } from '../utils/congesJours.js';

const router = express.Router();

// L'application n'attribue plus de « niveau d'accès » : tout est ouvert par défaut, et seules les
// restrictions posées par l'entreprise ferment quelque chose (voir permissions/catalogue.js et
// utils/rolesService.js). Les `requireRole` serveur ont été retirés le 2026-11-11 : la colonne
// texte `role` ne décide plus rien côté serveur. Elle alimente encore le jeton et les onglets du
// frontend (src/components/roles.js) ; on y met donc la valeur qui ne masque rien.
const ROLE_TEXTE_NEUTRE = 'admin';

const SALARIE_COLUMNS = `
  s.id, s.nom, s.prenom, s.poste, s.poste_id AS "posteId", s.departement_id AS "departementId",
  s.manager_id AS "managerId",
  s.date_embauche AS "dateEmbauche",
  s.salaire::float8 AS salaire, s.presence,
  s.avances::float8 AS avances, s.conges::float8 AS conges,
  s.email, s.telephone, s.adresse,
  s.photo, s.date_naissance AS "dateNaissance",
  s.contact_urgence_nom AS "contactUrgenceNom", s.contact_urgence_tel AS "contactUrgenceTel",
  s.num_piece_identite AS "numPieceIdentite",
  s.date_depart AS "dateDepart", s.motif_depart AS "motifDepart",
  s.cout_horaire::float8 AS "coutHoraire", s.heures_hebdo::float8 AS "heuresHebdo",
  s.jours_travailles AS "joursTravailles",
  s.statut, s.created_at AS "createdAt",
  u.email AS "compteEmail", eu.role_id AS "roleId", r.nom AS "roleNom",
  p.intitule AS "posteNom",
  d.nom AS "departementNom",
  (m.prenom || ' ' || m.nom) AS "managerNom"
`;

const SALARIE_FROM = `
  FROM salaries s
  LEFT JOIN users u ON u.id = s.user_id
  LEFT JOIN entreprise_utilisateurs eu ON eu.user_id = s.user_id AND eu.entreprise_id = s.entreprise_id
  LEFT JOIN roles r ON r.id = eu.role_id
  LEFT JOIN postes p ON p.id = s.poste_id
  LEFT JOIN departements d ON d.id = s.departement_id
  LEFT JOIN salaries m ON m.id = s.manager_id
`;

async function fetchSalarie(id) {
  const r = await pool.query(`SELECT ${SALARIE_COLUMNS} ${SALARIE_FROM} WHERE s.id = $1`, [id]);
  return r.rows[0] || null;
}

// Fiche d'UN salarié de l'entreprise de l'appelant, ou null. Depuis le retrait de la couche
// historique (2026-11-11), l'accès n'est plus filtré ici par le rôle texte : ce sont les
// restrictions posées par l'entreprise (permissionGuard, ressources salaries/conges/presences/
// avances/contrats/bulletins) qui décident, comme partout ailleurs. Ce helper ne garantit plus
// que le cloisonnement par entreprise.
async function resolveAccessibleSalarie(req, salarieId) {
  const r = await pool.query(
    `SELECT s.id, s.user_id, s.manager_id, s.entreprise_id, s.jours_travailles,
            s.salaire::float8 AS salaire, m.user_id AS manager_user_id
     FROM salaries s
     LEFT JOIN salaries m ON m.id = s.manager_id
     WHERE s.id = $1 AND s.entreprise_id = $2`,
    [salarieId, req.user.entrepriseId]
  );
  return r.rows[0] || null;
}

// Vrai si la demande de congé concerne l'appelant lui-même, et qu'il n'en est ni le manager ni
// le propriétaire de l'entreprise. Règle d'intégrité indépendante de toute restriction : on ne
// décide pas de sa propre demande. (Avant, un rôle texte « admin » levait cette règle — or tous
// les comptes créés depuis 2026-09-13 portent ce texte : chacun pouvait valider ses congés.)
async function estSaPropreDemande(req, access) {
  if (access.user_id !== req.user.sub) return false;
  if (access.manager_user_id === req.user.sub) return false;
  return !(await estProprietaire(req.user.entrepriseId, req.user.sub));
}

async function estProprietaire(entrepriseId, userId) {
  const { rows } = await pool.query('SELECT 1 FROM entreprises WHERE id = $1 AND proprietaire_user_id = $2', [entrepriseId, userId]);
  return rows.length > 0;
}

// ═══════════════════════════════════════════════════════════
//  LISTE / DÉTAIL
// ═══════════════════════════════════════════════════════════

router.get('/', authRequired, async (req, res) => {
  try {
    const { departementId } = req.query;
    const params = [req.user.entrepriseId];
    let filtre = '';
    if (departementId) { params.push(departementId); filtre = ` AND s.departement_id = $${params.length}`; }
    const result = await pool.query(
      `SELECT ${SALARIE_COLUMNS} ${SALARIE_FROM}
       WHERE s.entreprise_id = $1 AND s.statut != 'Inactif'${filtre}
       ORDER BY s.id DESC`,
      params
    );
    return res.json({ salaries: result.rows });
  } catch (err) {
    console.error('[GET /salaries]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des salariés.' });
  }
});

// Self-service : le salarié connecté récupère SA fiche (via salaries.user_id).
router.get('/moi', authRequired, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ${SALARIE_COLUMNS} ${SALARIE_FROM}
       WHERE s.entreprise_id = $1 AND s.user_id = $2`,
      [req.user.entrepriseId, req.user.sub]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Aucune fiche salarié n'est liée à votre compte." });
    return res.json({ salarie: r.rows[0] });
  } catch (err) {
    console.error('[GET /salaries/moi]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération de votre fiche.' });
  }
});

// ═══════════════════════════════════════════════════════════
//  CRÉATION (fiche RH seule, OU fiche + compte de connexion)
// ═══════════════════════════════════════════════════════════

router.post('/', authRequired, async (req, res) => {
  const {
    nom, prenom, poste, posteId, departementId, managerId,
    dateEmbauche, salaire, presence,
    email, telephone, adresse,
    photo, dateNaissance, contactUrgenceNom, contactUrgenceTel, numPieceIdentite,
    coutHoraire, heuresHebdo, joursTravailles,
    createAccount, compteEmail, password,
  } = req.body;

  if (!nom || !prenom) {
    return res.status(400).json({ error: 'Nom et prénom requis.' });
  }
  if (createAccount && (!compteEmail || !password)) {
    return res.status(400).json({ error: 'Email de connexion et mot de passe requis pour créer un compte.' });
  }
  if (createAccount) {
    const erreur = validerEmail(compteEmail) || validerMotDePasse(password);
    if (erreur) return res.status(400).json({ error: erreur });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let userId = null;
    let roleIdValide = null;

    if (createAccount) {
      const existing = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [compteEmail]);
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Un utilisateur avec cet email existe déjà.' });
      }
      const passwordHash = await bcrypt.hash(password, BCRYPT_COUT);
      const userResult = await client.query(
        `INSERT INTO users (email, role, password) VALUES ($1, $2, $3) RETURNING id`,
        [compteEmail.toLowerCase(), ROLE_TEXTE_NEUTRE, passwordHash]
      );
      userId = userResult.rows[0].id;
      // roleId est le rôle DÉFINI PAR L'ENTREPRISE (restrictions). Sans lui, la personne n'a
      // aucune restriction, ce qui est le défaut du produit. Validé contre l'entreprise pour
      // qu'on ne puisse pas rattacher quelqu'un au rôle d'une autre.
      if (req.body.roleId) {
        const { rows: verif } = await client.query(
          'SELECT id FROM roles WHERE id = $1 AND entreprise_id = $2',
          [req.body.roleId, req.user.entrepriseId]
        );
        roleIdValide = verif[0]?.id || null;
      }
      await client.query(
        `INSERT INTO entreprise_utilisateurs (entreprise_id, user_id, role, role_id, statut)
         VALUES ($1, $2, $3, $4, 'Actif')`,
        [req.user.entrepriseId, userId, ROLE_TEXTE_NEUTRE, roleIdValide]
      );
    }

    const salarieResult = await client.query(
      `INSERT INTO salaries
         (entreprise_id, user_id, nom, prenom, poste, poste_id, departement_id, manager_id,
          date_embauche, salaire, presence, email, telephone, adresse,
          photo, date_naissance, contact_urgence_nom, contact_urgence_tel, num_piece_identite,
          cout_horaire, heures_hebdo, jours_travailles, statut)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'Actif')
       RETURNING id`,
      [
        req.user.entrepriseId, userId, nom, prenom,
        poste || null, posteId || null, departementId || null, managerId || null,
        dateEmbauche || null, Number(salaire) || 0, presence || 'Présent',
        email || null, telephone || null, adresse || null,
        photo || null, dateNaissance || null, contactUrgenceNom || null, contactUrgenceTel || null, numPieceIdentite || null,
        coutHoraire === '' || coutHoraire == null ? null : Number(coutHoraire),
        heuresHebdo === '' || heuresHebdo == null ? null : Number(heuresHebdo),
        joursTravailles || null,
      ]
    );
    const salarieId = salarieResult.rows[0].id;

    // Contrat initial si un salaire est fourni (cohérent avec migrateContratsFromSalaries).
    if (Number(salaire) > 0) {
      await client.query(
        `INSERT INTO salaries_contrats (entreprise_id, salarie_id, type, date_debut, salaire, actif)
         VALUES ($1, $2, 'CDI', $3, $4, TRUE)`,
        [req.user.entrepriseId, salarieId, dateEmbauche || null, Number(salaire)]
      );
    }

    await client.query('COMMIT');

    if (createAccount) {
      await logAuditEvent({
        entrepriseId: req.user.entrepriseId, userId: req.user.sub, email: req.user.email,
        action: 'account_created', req,
        details: { targetUserId: userId, targetEmail: compteEmail, roleId: roleIdValide },
      });
      try { await sendWelcomeEmail(compteEmail, password, prenom); }
      catch (mailErr) { console.error('[POST /salaries] email non envoyé', mailErr); }
    }

    return res.status(201).json({ salarie: await fetchSalarie(salarieId) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /salaries]', err);
    return res.status(500).json({ error: "Erreur lors de la création du salarié." });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════
//  MISE À JOUR — fiche RH + synchro compte lié + journal des modifications
// ═══════════════════════════════════════════════════════════

const TRACKED_FIELDS = ['salaire', 'poste_id', 'departement_id', 'manager_id', 'statut', 'date_depart'];

router.put('/:id', authRequired, async (req, res) => {
  const {
    nom, prenom, poste, posteId, departementId, managerId,
    dateEmbauche, salaire, presence, email, telephone, adresse,
    photo, dateNaissance, contactUrgenceNom, contactUrgenceTel, numPieceIdentite,
    dateDepart, motifDepart, coutHoraire, heuresHebdo, joursTravailles, statut,
    linkAccount, compteEmail, password,
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const beforeR = await client.query(
      `SELECT * FROM salaries WHERE id = $1 AND entreprise_id = $2`,
      [req.params.id, req.user.entrepriseId]
    );
    if (beforeR.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Salarié introuvable.' });
    }
    const before = beforeR.rows[0];

    // Anti-auto-référence sur le manager (hiérarchie à un seul niveau exploité).
    const managerFinal = (managerId && Number(managerId) === Number(req.params.id)) ? null : (managerId ?? null);

    // Lier un compte de connexion à un salarié qui n'en a pas encore.
    let userId = before.user_id;
    if (linkAccount && !userId) {
      if (!compteEmail || !password) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Email, mot de passe et rôle requis pour créer le compte.' });
      }
      const erreurCompte = validerEmail(compteEmail) || validerMotDePasse(password);
      if (erreurCompte) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: erreurCompte });
      }
      const existing = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [compteEmail]);
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Un utilisateur avec cet email existe déjà.' });
      }
      const passwordHash = await bcrypt.hash(password, BCRYPT_COUT);
      const ur = await client.query(
        `INSERT INTO users (email, role, password) VALUES ($1,$2,$3) RETURNING id`,
        [compteEmail.toLowerCase(), ROLE_TEXTE_NEUTRE, passwordHash]
      );
      userId = ur.rows[0].id;
      await client.query(
        `INSERT INTO entreprise_utilisateurs (entreprise_id, user_id, role, statut) VALUES ($1,$2,$3,'Actif')`,
        [req.user.entrepriseId, userId, ROLE_TEXTE_NEUTRE]
      );

      await client.query('UPDATE salaries SET user_id = $1 WHERE id = $2', [userId, req.params.id]);
      await logAuditEvent({
        entrepriseId: req.user.entrepriseId, userId: req.user.sub, email: req.user.email,
        action: 'account_created', req, details: { targetUserId: userId, targetEmail: compteEmail, via: 'PUT /salaries/:id' },
      });
      try { await sendWelcomeEmail(compteEmail, password, prenom || before.prenom); }
      catch (mailErr) { console.error('[PUT /salaries] email non envoyé', mailErr); }
    }

    const upd = await client.query(
      `UPDATE salaries SET
         nom = COALESCE($1, nom),
         prenom = COALESCE($2, prenom),
         poste = COALESCE($3, poste),
         poste_id = $4,
         departement_id = $5,
         manager_id = $6,
         date_embauche = COALESCE($7, date_embauche),
         salaire = COALESCE($8, salaire),
         presence = COALESCE($9, presence),
         email = COALESCE($10, email),
         telephone = COALESCE($11, telephone),
         adresse = COALESCE($12, adresse),
         photo = COALESCE($13, photo),
         date_naissance = $14,
         contact_urgence_nom = COALESCE($15, contact_urgence_nom),
         contact_urgence_tel = COALESCE($16, contact_urgence_tel),
         num_piece_identite = COALESCE($17, num_piece_identite),
         date_depart = $18,
         motif_depart = COALESCE($19, motif_depart),
         cout_horaire = $20,
         heures_hebdo = $21,
         jours_travailles = COALESCE($22, jours_travailles),
         statut = COALESCE($23, statut)
       WHERE id = $24 AND entreprise_id = $25
       RETURNING *`,
      [
        nom, prenom, poste,
        posteId === undefined ? before.poste_id : (posteId || null),
        departementId === undefined ? before.departement_id : (departementId || null),
        managerId === undefined ? before.manager_id : managerFinal,
        dateEmbauche, salaire, presence, email, telephone, adresse,
        photo,
        dateNaissance === undefined ? before.date_naissance : (dateNaissance || null),
        contactUrgenceNom, contactUrgenceTel, numPieceIdentite,
        dateDepart === undefined ? before.date_depart : (dateDepart || null),
        motifDepart,
        coutHoraire === undefined ? before.cout_horaire : (coutHoraire === '' || coutHoraire == null ? null : Number(coutHoraire)),
        heuresHebdo === undefined ? before.heures_hebdo : (heuresHebdo === '' || heuresHebdo == null ? null : Number(heuresHebdo)),
        joursTravailles, statut,
        req.params.id, req.user.entrepriseId,
      ]
    );
    const after = upd.rows[0];

    // Salaire modifié => resynchronise le contrat actif (le contrat historise, salaries.salaire reste la valeur lue partout).
    if (salaire != null && Number(salaire) !== Number(before.salaire)) {
      await client.query(
        `UPDATE salaries_contrats SET salaire = $1 WHERE salarie_id = $2 AND actif = TRUE`,
        [Number(salaire), req.params.id]
      );
    }

    // Synchro accès du compte lié quand `statut` bascule vers/depuis 'Inactif' (même logique que DELETE).
    if (userId && statut && statut !== before.statut) {
      if (statut === 'Inactif') {
        if (await estProprietaire(req.user.entrepriseId, userId)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: "Le compte propriétaire de l'entreprise ne peut pas être désactivé." });
        }
        await client.query(`UPDATE entreprise_utilisateurs SET statut = 'Inactif' WHERE user_id = $1 AND entreprise_id = $2`, [userId, req.user.entrepriseId]);
        await logAuditEvent({ entrepriseId: req.user.entrepriseId, userId: req.user.sub, email: req.user.email, action: 'account_deactivated', req, details: { targetUserId: userId, via: 'PUT /salaries/:id' } });
      } else if (before.statut === 'Inactif') {
        await client.query(`UPDATE entreprise_utilisateurs SET statut = 'Actif' WHERE user_id = $1 AND entreprise_id = $2`, [userId, req.user.entrepriseId]);
        await logAuditEvent({ entrepriseId: req.user.entrepriseId, userId: req.user.sub, email: req.user.email, action: 'account_reactivated', req, details: { targetUserId: userId, via: 'PUT /salaries/:id' } });
      }
    }

    await client.query('COMMIT');
    // Le garde des permissions met en cache le statut du compte : sans invalidation, un compte
    // désactivé garderait l'accès jusqu'à 60 s.
    if (userId) invaliderCacheRoles(req.user.entrepriseId, userId);

    // Journal des modifications (hors transaction : best-effort, comme pour les devis).
    await logFieldChanges(req.user.entrepriseId, 'salarie', Number(req.params.id), req.user.sub, before, after, TRACKED_FIELDS);

    return res.json({ salarie: await fetchSalarie(req.params.id) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PUT /salaries]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════
//  SUPPRESSION (désactive le compte, ne le supprime pas)
// ═══════════════════════════════════════════════════════════

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const salarie = await pool.query(
      'SELECT user_id FROM salaries WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (salarie.rows.length === 0) return res.status(404).json({ error: 'Salarié introuvable.' });

    if (salarie.rows[0].user_id) {
      // Garde-fou contre le verrouillage : le propriétaire ne peut pas être mis dehors, ni par un
      // autre compte, ni par lui-même (même règle que pour les rôles, voir rolesService).
      if (await estProprietaire(req.user.entrepriseId, salarie.rows[0].user_id)) {
        return res.status(400).json({ error: "Le compte propriétaire de l'entreprise ne peut pas être désactivé." });
      }
      await pool.query(`UPDATE entreprise_utilisateurs SET statut = 'Inactif' WHERE user_id = $1 AND entreprise_id = $2`, [salarie.rows[0].user_id, req.user.entrepriseId]);
      invaliderCacheRoles(req.user.entrepriseId, salarie.rows[0].user_id);
      await logAuditEvent({ entrepriseId: req.user.entrepriseId, userId: req.user.sub, email: req.user.email, action: 'account_deactivated', req, details: { targetUserId: salarie.rows[0].user_id } });
    }
    await pool.query(`UPDATE salaries SET statut = 'Inactif' WHERE id = $1`, [req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /salaries]', err);
    return res.status(500).json({ error: 'Erreur lors de la désactivation.' });
  }
});

// ═══════════════════════════════════════════════════════════
//  Journal des modifications de la fiche
// ═══════════════════════════════════════════════════════════
router.get('/:id/journal', authRequired, async (req, res) => {
  try {
    if (!(await resolveAccessibleSalarie(req, req.params.id))) return res.status(404).json({ error: 'Salarié introuvable.' });
    const journal = await getJournal('salarie', Number(req.params.id), req.user.entrepriseId);
    return res.json({ journal });
  } catch (err) {
    console.error('[GET /salaries/:id/journal]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération du journal.' });
  }
});

// ═══════════════════════════════════════════════════════════
//  Présences
// ═══════════════════════════════════════════════════════════
const PRESENCE_COLUMNS = `id, salarie_id AS "salarieId", date, statut, notes, created_at AS "createdAt"`;
const STATUTS_PRESENCE = ['Présent', 'Absent', 'Retard', 'Congé'];

router.get('/:id/presences', authRequired, async (req, res) => {
  try {
    if (!(await resolveAccessibleSalarie(req, req.params.id))) return res.status(404).json({ error: 'Salarié introuvable.' });
    const result = await pool.query(
      `SELECT ${PRESENCE_COLUMNS} FROM salaries_presences WHERE salarie_id = $1 ORDER BY date DESC`,
      [req.params.id]
    );
    return res.json({ presences: result.rows });
  } catch (err) {
    console.error('[GET /salaries/:id/presences]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des présences.' });
  }
});

router.post('/:id/presences', authRequired, async (req, res) => {
  const { date, statut, notes } = req.body;
  if (!date || !STATUTS_PRESENCE.includes(statut)) return res.status(400).json({ error: 'Date et statut valides requis.' });
  try {
    if (!(await resolveAccessibleSalarie(req, req.params.id))) return res.status(404).json({ error: 'Salarié introuvable.' });
    const result = await pool.query(
      `INSERT INTO salaries_presences (salarie_id, date, statut, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (salarie_id, date) DO UPDATE SET statut = $3, notes = $4
       RETURNING ${PRESENCE_COLUMNS}`,
      [req.params.id, date, statut, notes || null]
    );
    return res.status(201).json({ presence: result.rows[0] });
  } catch (err) {
    console.error('[POST /salaries/:id/presences]', err);
    return res.status(500).json({ error: "Erreur lors de l'enregistrement de la présence." });
  }
});

// ═══════════════════════════════════════════════════════════
//  Congés — types via /api/rh ; ici : demandes, décompte, solde, droits
// ═══════════════════════════════════════════════════════════
const CONGE_COLUMNS = `
  c.id, c.salarie_id AS "salarieId", c.type_id AS "typeId",
  c.date_debut AS "dateDebut", c.date_fin AS "dateFin",
  c.nb_jours::float8 AS "nbJours", c.demi_jour_debut AS "demiJourDebut", c.demi_jour_fin AS "demiJourFin",
  c.motif, c.statut, c.decided_by AS "decidedBy", c.decided_at AS "decidedAt", c.created_at AS "createdAt",
  ct.nom AS "typeNom", ct.couleur AS "typeCouleur", ct.paye AS "typePaye"
`;
const CONGE_FROM = `FROM salaries_conges c LEFT JOIN conges_types ct ON ct.id = c.type_id`;
const STATUTS_APRES_APPROBATION = ['Approuvé'];

async function chargerFeriesEtCalendrier(entrepriseId, salarieId) {
  const feriesR = await pool.query('SELECT to_char(date, \'YYYY-MM-DD\') AS d FROM jours_feries WHERE entreprise_id = $1', [entrepriseId]);
  const feriesSet = new Set(feriesR.rows.map(r => r.d));
  const sR = await pool.query('SELECT jours_travailles FROM salaries WHERE id = $1', [salarieId]);
  return { feriesSet, joursTravailles: sR.rows[0]?.jours_travailles || null };
}

// Pose (statut 'Congé') ou retire les lignes de présence couvrant un congé approuvé.
async function appliquerPresencesConge(entrepriseId, conge, poser) {
  const { feriesSet, joursTravailles } = await chargerFeriesEtCalendrier(entrepriseId, conge.salarie_id);
  const jours = listerJoursOuvres(
    typeof conge.date_debut === 'string' ? conge.date_debut : conge.date_debut.toISOString().slice(0, 10),
    typeof conge.date_fin === 'string' ? conge.date_fin : conge.date_fin.toISOString().slice(0, 10),
    feriesSet, joursTravailles
  );
  if (jours.length === 0) return;
  if (poser) {
    for (const iso of jours) {
      await pool.query(
        `INSERT INTO salaries_presences (salarie_id, date, statut, notes)
         VALUES ($1, $2, 'Congé', 'Congé approuvé')
         ON CONFLICT (salarie_id, date) DO UPDATE SET statut = 'Congé'`,
        [conge.salarie_id, iso]
      );
    }
  } else {
    await pool.query(
      `DELETE FROM salaries_presences WHERE salarie_id = $1 AND date = ANY($2::date[]) AND statut = 'Congé'`,
      [conge.salarie_id, jours]
    );
  }
}

router.get('/:id/conges', authRequired, async (req, res) => {
  try {
    if (!(await resolveAccessibleSalarie(req, req.params.id))) return res.status(404).json({ error: 'Salarié introuvable.' });
    const result = await pool.query(
      `SELECT ${CONGE_COLUMNS} ${CONGE_FROM} WHERE c.salarie_id = $1 ORDER BY c.date_debut DESC`,
      [req.params.id]
    );
    return res.json({ conges: result.rows });
  } catch (err) {
    console.error('[GET /salaries/:id/conges]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des congés.' });
  }
});

// Création d'une demande : admin OU le salarié lui-même (self-service).
router.post('/:id/conges', authRequired, async (req, res) => {
  const { typeId, dateDebut, dateFin, motif, demiJourDebut = false, demiJourFin = false } = req.body;
  if (!dateDebut || !dateFin) return res.status(400).json({ error: 'Dates de début et de fin requises.' });
  try {
    const access = await resolveAccessibleSalarie(req, req.params.id);
    if (!access) return res.status(404).json({ error: 'Salarié introuvable.' });

    // Type appartient à l'entreprise (sinon null).
    let typeIdFinal = null;
    if (typeId) {
      const t = await pool.query('SELECT id FROM conges_types WHERE id = $1 AND entreprise_id = $2', [typeId, req.user.entrepriseId]);
      if (t.rows[0]) typeIdFinal = t.rows[0].id;
    }
    const { feriesSet, joursTravailles } = await chargerFeriesEtCalendrier(req.user.entrepriseId, req.params.id);
    const nbJours = calculerJoursOuvres(dateDebut, dateFin, feriesSet, joursTravailles, !!demiJourDebut, !!demiJourFin);

    const ins = await pool.query(
      `INSERT INTO salaries_conges (salarie_id, type_id, date_debut, date_fin, nb_jours, demi_jour_debut, demi_jour_fin, motif, statut)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Demandé') RETURNING id`,
      [req.params.id, typeIdFinal, dateDebut, dateFin, nbJours, !!demiJourDebut, !!demiJourFin, motif || null]
    );
    const full = await pool.query(`SELECT ${CONGE_COLUMNS} ${CONGE_FROM} WHERE c.id = $1`, [ins.rows[0].id]);
    return res.status(201).json({ conge: full.rows[0] });
  } catch (err) {
    console.error('[POST /salaries/:id/conges]', err);
    return res.status(500).json({ error: "Erreur lors de la création de la demande de congé." });
  }
});

// Décision : admin OU manager direct du salarié. Approuver => pose les présences 'Congé' ;
// repasser en Refusé/Demandé depuis Approuvé => les retire.
router.put('/conges/:congeId', authRequired, async (req, res) => {
  const { statut } = req.body;
  if (!['Approuvé', 'Refusé', 'Demandé'].includes(statut)) return res.status(400).json({ error: 'Statut invalide.' });
  try {
    const cR = await pool.query(
      `SELECT c.*, s.entreprise_id FROM salaries_conges c JOIN salaries s ON s.id = c.salarie_id
       WHERE c.id = $1 AND s.entreprise_id = $2`,
      [req.params.congeId, req.user.entrepriseId]
    );
    const conge = cR.rows[0];
    if (!conge) return res.status(404).json({ error: 'Demande de congé introuvable.' });
    const access = await resolveAccessibleSalarie(req, conge.salarie_id);
    if (!access) return res.status(403).json({ error: 'Non autorisé à décider de ce congé.' });
    // Un salarié ne valide pas ses propres congés.
    if (await estSaPropreDemande(req, access)) {
      return res.status(403).json({ error: "Vous ne pouvez pas décider de votre propre demande." });
    }

    const etaitApprouve = STATUTS_APRES_APPROBATION.includes(conge.statut);
    const devientApprouve = STATUTS_APRES_APPROBATION.includes(statut);

    const upd = await pool.query(
      `UPDATE salaries_conges SET statut = $1, decided_by = $2, decided_at = NOW() WHERE id = $3 RETURNING id`,
      [statut, req.user.sub, req.params.congeId]
    );
    if (!upd.rows[0]) return res.status(404).json({ error: 'Demande de congé introuvable.' });

    if (!etaitApprouve && devientApprouve) await appliquerPresencesConge(req.user.entrepriseId, conge, true);
    else if (etaitApprouve && !devientApprouve) await appliquerPresencesConge(req.user.entrepriseId, conge, false);

    const full = await pool.query(`SELECT ${CONGE_COLUMNS} ${CONGE_FROM} WHERE c.id = $1`, [req.params.congeId]);
    return res.json({ conge: full.rows[0] });
  } catch (err) {
    console.error('[PUT /salaries/conges/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du congé.' });
  }
});

router.delete('/conges/:congeId', authRequired, async (req, res) => {
  try {
    const cR = await pool.query(
      `SELECT c.* FROM salaries_conges c JOIN salaries s ON s.id = c.salarie_id
       WHERE c.id = $1 AND s.entreprise_id = $2`,
      [req.params.congeId, req.user.entrepriseId]
    );
    const conge = cR.rows[0];
    if (!conge) return res.status(404).json({ error: 'Demande de congé introuvable.' });
    const access = await resolveAccessibleSalarie(req, conge.salarie_id);
    if (!access) return res.status(404).json({ error: 'Demande de congé introuvable.' });
    // Sa propre demande ne s'annule que tant qu'elle est 'Demandé' (sinon on effacerait une
    // décision prise par un autre) ; manager et propriétaire peuvent tout retirer.
    if (conge.statut !== 'Demandé' && await estSaPropreDemande(req, access)) {
      return res.status(403).json({ error: 'Seule une demande encore en attente peut être annulée.' });
    }
    if (STATUTS_APRES_APPROBATION.includes(conge.statut)) {
      await appliquerPresencesConge(req.user.entrepriseId, conge, false);
    }
    await pool.query('DELETE FROM salaries_conges WHERE id = $1', [req.params.congeId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /salaries/conges/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression du congé.' });
  }
});

// Solde par type de congé pour une année : alloué (conges_droits) − pris (Σ nb_jours approuvés).
router.get('/:id/conges-solde', authRequired, async (req, res) => {
  try {
    if (!(await resolveAccessibleSalarie(req, req.params.id))) return res.status(404).json({ error: 'Salarié introuvable.' });
    const annee = Number(req.query.annee) || new Date().getFullYear();
    const { rows } = await pool.query(
      `SELECT ct.id AS "typeId", ct.nom, ct.couleur, ct.paye,
              COALESCE(cd.jours_alloues, 0)::float8 AS "alloues",
              COALESCE((
                SELECT SUM(sc.nb_jours) FROM salaries_conges sc
                WHERE sc.salarie_id = $1 AND sc.type_id = ct.id AND sc.statut = 'Approuvé'
                  AND EXTRACT(YEAR FROM sc.date_debut) = $2
              ), 0)::float8 AS "pris"
       FROM conges_types ct
       LEFT JOIN conges_droits cd ON cd.type_id = ct.id AND cd.salarie_id = $1 AND cd.annee = $2
       WHERE ct.entreprise_id = $3
       ORDER BY ct.ordre, ct.nom`,
      [req.params.id, annee, req.user.entrepriseId]
    );
    const solde = rows.map(r => ({ ...r, restant: Math.round((r.alloues - r.pris) * 100) / 100 }));
    return res.json({ annee, solde });
  } catch (err) {
    console.error('[GET /salaries/:id/conges-solde]', err);
    return res.status(500).json({ error: 'Erreur lors du calcul du solde.' });
  }
});

// Droits annuels (admin) — upsert sur (salarie, type, annee).
router.get('/:id/conges-droits', authRequired, async (req, res) => {
  try {
    if (!(await resolveAccessibleSalarie(req, req.params.id))) return res.status(404).json({ error: 'Salarié introuvable.' });
    const { rows } = await pool.query(
      `SELECT cd.id, cd.type_id AS "typeId", cd.annee, cd.jours_alloues::float8 AS "joursAlloues", ct.nom AS "typeNom"
       FROM conges_droits cd JOIN conges_types ct ON ct.id = cd.type_id
       WHERE cd.salarie_id = $1 ORDER BY cd.annee DESC, ct.nom`,
      [req.params.id]
    );
    return res.json({ droits: rows });
  } catch (err) {
    console.error('[GET /salaries/:id/conges-droits]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des droits.' });
  }
});

router.post('/:id/conges-droits', authRequired, async (req, res) => {
  const { typeId, annee, joursAlloues } = req.body;
  if (!typeId || !annee) return res.status(400).json({ error: 'Type et année requis.' });
  try {
    if (!(await resolveAccessibleSalarie(req, req.params.id))) return res.status(404).json({ error: 'Salarié introuvable.' });
    const t = await pool.query('SELECT id FROM conges_types WHERE id = $1 AND entreprise_id = $2', [typeId, req.user.entrepriseId]);
    if (!t.rows[0]) return res.status(400).json({ error: 'Type de congé inconnu.' });
    const { rows } = await pool.query(
      `INSERT INTO conges_droits (entreprise_id, salarie_id, type_id, annee, jours_alloues)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (salarie_id, type_id, annee) DO UPDATE SET jours_alloues = EXCLUDED.jours_alloues
       RETURNING id, type_id AS "typeId", annee, jours_alloues::float8 AS "joursAlloues"`,
      [req.user.entrepriseId, req.params.id, typeId, Number(annee), Number(joursAlloues) || 0]
    );
    return res.status(201).json({ droit: rows[0] });
  } catch (err) {
    console.error('[POST /salaries/:id/conges-droits]', err);
    return res.status(500).json({ error: 'Erreur lors de l\'enregistrement du droit.' });
  }
});

router.delete('/conges-droits/:droitId', authRequired, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM conges_droits cd USING salaries s
       WHERE cd.id = $1 AND cd.salarie_id = s.id AND s.entreprise_id = $2`,
      [req.params.droitId, req.user.entrepriseId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Droit introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /salaries/conges-droits/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

// ═══════════════════════════════════════════════════════════
//  Avances
// ═══════════════════════════════════════════════════════════
const AVANCE_COLUMNS = `id, salarie_id AS "salarieId", date, montant::float8 AS montant, motif, created_at AS "createdAt"`;

router.get('/:id/avances', authRequired, async (req, res) => {
  try {
    if (!(await resolveAccessibleSalarie(req, req.params.id))) return res.status(404).json({ error: 'Salarié introuvable.' });
    const result = await pool.query(
      `SELECT ${AVANCE_COLUMNS} FROM salaries_avances WHERE salarie_id = $1 ORDER BY date DESC`,
      [req.params.id]
    );
    return res.json({ avances: result.rows });
  } catch (err) {
    console.error('[GET /salaries/:id/avances]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des avances.' });
  }
});

router.post('/:id/avances', authRequired, async (req, res) => {
  const { date, montant, motif } = req.body;
  if (!montant) return res.status(400).json({ error: 'Montant requis.' });
  try {
    if (!(await resolveAccessibleSalarie(req, req.params.id))) return res.status(404).json({ error: 'Salarié introuvable.' });
    const result = await pool.query(
      `INSERT INTO salaries_avances (salarie_id, date, montant, motif)
       VALUES ($1, COALESCE($2, date_entreprise($5)), $3, $4) RETURNING ${AVANCE_COLUMNS}`,
      [req.params.id, date || null, Number(montant), motif || null, req.user.entrepriseId]
    );
    return res.status(201).json({ avance: result.rows[0] });
  } catch (err) {
    console.error('[POST /salaries/:id/avances]', err);
    return res.status(500).json({ error: "Erreur lors de l'enregistrement de l'avance." });
  }
});

router.delete('/avances/:avanceId', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM salaries_avances a USING salaries s
       WHERE a.id = $1 AND a.salarie_id = s.id AND s.entreprise_id = $2`,
      [req.params.avanceId, req.user.entrepriseId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Avance introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /salaries/avances/:id]', err);
    return res.status(500).json({ error: "Erreur lors de la suppression de l'avance." });
  }
});

// ═══════════════════════════════════════════════════════════
//  Contrats — historise les termes ; le contrat actif porte le salaire de référence
// ═══════════════════════════════════════════════════════════
const CONTRAT_COLUMNS = `
  id, salarie_id AS "salarieId", type, date_debut AS "dateDebut", date_fin AS "dateFin",
  fin_periode_essai AS "finPeriodeEssai", salaire::float8 AS salaire, actif, created_at AS "createdAt"
`;

router.get('/:id/contrats', authRequired, async (req, res) => {
  try {
    if (!(await resolveAccessibleSalarie(req, req.params.id))) return res.status(404).json({ error: 'Salarié introuvable.' });
    const { rows } = await pool.query(
      `SELECT ${CONTRAT_COLUMNS} FROM salaries_contrats WHERE salarie_id = $1 ORDER BY actif DESC, date_debut DESC NULLS LAST, id DESC`,
      [req.params.id]
    );
    return res.json({ contrats: rows });
  } catch (err) {
    console.error('[GET /salaries/:id/contrats]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des contrats.' });
  }
});

// Nouveau contrat => désactive les précédents, devient l'actif, resynchronise salaries.salaire.
router.post('/:id/contrats', authRequired, async (req, res) => {
  const { type = 'CDI', dateDebut, dateFin, finPeriodeEssai, salaire } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!(await resolveAccessibleSalarie(req, req.params.id))) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Salarié introuvable.' });
    }
    await client.query('UPDATE salaries_contrats SET actif = FALSE WHERE salarie_id = $1', [req.params.id]);
    const { rows } = await client.query(
      `INSERT INTO salaries_contrats (entreprise_id, salarie_id, type, date_debut, date_fin, fin_periode_essai, salaire, actif)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE) RETURNING ${CONTRAT_COLUMNS}`,
      [req.user.entrepriseId, req.params.id, type, dateDebut || null, dateFin || null, finPeriodeEssai || null,
       salaire === '' || salaire == null ? null : Number(salaire)]
    );
    if (salaire != null && salaire !== '') {
      await client.query('UPDATE salaries SET salaire = $1 WHERE id = $2', [Number(salaire), req.params.id]);
    }
    await client.query('COMMIT');
    return res.status(201).json({ contrat: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /salaries/:id/contrats]', err);
    return res.status(500).json({ error: 'Erreur lors de la création du contrat.' });
  } finally {
    client.release();
  }
});

router.put('/contrats/:contratId', authRequired, async (req, res) => {
  const { type, dateDebut, dateFin, finPeriodeEssai, salaire, actif } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT c.*, s.entreprise_id FROM salaries_contrats c JOIN salaries s ON s.id = c.salarie_id
       WHERE c.id = $1 AND s.entreprise_id = $2`,
      [req.params.contratId, req.user.entrepriseId]
    );
    if (!cur.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Contrat introuvable.' }); }
    if (actif === true) {
      await client.query('UPDATE salaries_contrats SET actif = FALSE WHERE salarie_id = $1', [cur.rows[0].salarie_id]);
    }
    const { rows } = await client.query(
      `UPDATE salaries_contrats SET
         type = COALESCE($1, type),
         date_debut = $2, date_fin = $3, fin_periode_essai = $4,
         salaire = $5,
         actif = COALESCE($6, actif)
       WHERE id = $7 RETURNING ${CONTRAT_COLUMNS}`,
      [type ?? null,
       dateDebut === undefined ? cur.rows[0].date_debut : (dateDebut || null),
       dateFin === undefined ? cur.rows[0].date_fin : (dateFin || null),
       finPeriodeEssai === undefined ? cur.rows[0].fin_periode_essai : (finPeriodeEssai || null),
       salaire === undefined ? cur.rows[0].salaire : (salaire === '' || salaire == null ? null : Number(salaire)),
       typeof actif === 'boolean' ? actif : null,
       req.params.contratId]
    );
    if (rows[0].actif && rows[0].salaire != null) {
      await client.query('UPDATE salaries SET salaire = $1 WHERE id = $2', [rows[0].salaire, cur.rows[0].salarie_id]);
    }
    await client.query('COMMIT');
    return res.json({ contrat: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PUT /salaries/contrats/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du contrat.' });
  } finally {
    client.release();
  }
});

router.delete('/contrats/:contratId', authRequired, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM salaries_contrats c USING salaries s
       WHERE c.id = $1 AND c.salarie_id = s.id AND s.entreprise_id = $2`,
      [req.params.contratId, req.user.entrepriseId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Contrat introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /salaries/contrats/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression du contrat.' });
  }
});

// ═══════════════════════════════════════════════════════════
//  Feuilles de temps — heures imputables sur une parcelle / un poulailler
// ═══════════════════════════════════════════════════════════
const TEMPS_COLUMNS = `
  t.id, t.salarie_id AS "salarieId", t.date, t.heures::float8 AS heures,
  t.parcelle_id AS "parcelleId", t.poulailler_id AS "poulaillerId", t.tache, t.created_at AS "createdAt",
  pa.nom AS "parcelleNom", po.nom AS "poulaillerNom"
`;
const TEMPS_FROM = `FROM salaries_temps t
  LEFT JOIN parcelles pa ON pa.id = t.parcelle_id
  LEFT JOIN poulaillers po ON po.id = t.poulailler_id`;

router.get('/:id/temps', authRequired, async (req, res) => {
  try {
    const access = await resolveAccessibleSalarie(req, req.params.id);
    if (!access) return res.status(404).json({ error: 'Salarié introuvable.' });
    const { rows } = await pool.query(
      `SELECT ${TEMPS_COLUMNS} ${TEMPS_FROM} WHERE t.salarie_id = $1 ORDER BY t.date DESC, t.id DESC`,
      [req.params.id]
    );
    const totalHeures = rows.reduce((s, r) => s + Number(r.heures), 0);
    // Le coût main-d'œuvre (heures × coût horaire) est calculé côté client à partir de salaries.coutHoraire.
    return res.json({ temps: rows, totalHeures: Math.round(totalHeures * 100) / 100 });
  } catch (err) {
    console.error('[GET /salaries/:id/temps]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des feuilles de temps.' });
  }
});

router.post('/:id/temps', authRequired, async (req, res) => {
  const { date, heures, parcelleId, poulaillerId, tache } = req.body;
  if (!date || !heures) return res.status(400).json({ error: 'Date et heures requises.' });
  try {
    if (!(await resolveAccessibleSalarie(req, req.params.id))) return res.status(404).json({ error: 'Salarié introuvable.' });
    // parcelle / poulailler appartiennent à l'entreprise, sinon null (même posture que les FK stock).
    let pId = null, poId = null;
    if (parcelleId) {
      const p = await pool.query('SELECT id FROM parcelles WHERE id = $1 AND entreprise_id = $2', [parcelleId, req.user.entrepriseId]);
      if (p.rows[0]) pId = p.rows[0].id;
    }
    if (poulaillerId) {
      const p = await pool.query('SELECT id FROM poulaillers WHERE id = $1 AND entreprise_id = $2', [poulaillerId, req.user.entrepriseId]);
      if (p.rows[0]) poId = p.rows[0].id;
    }
    const { rows } = await pool.query(
      `INSERT INTO salaries_temps (entreprise_id, salarie_id, date, heures, parcelle_id, poulailler_id, tache)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.user.entrepriseId, req.params.id, date, Number(heures), pId, poId, tache || null]
    );
    const full = await pool.query(`SELECT ${TEMPS_COLUMNS} ${TEMPS_FROM} WHERE t.id = $1`, [rows[0].id]);
    return res.status(201).json({ temps: full.rows[0] });
  } catch (err) {
    console.error('[POST /salaries/:id/temps]', err);
    return res.status(500).json({ error: "Erreur lors de l'enregistrement des heures." });
  }
});

router.delete('/temps/:tempsId', authRequired, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM salaries_temps t USING salaries s
       WHERE t.id = $1 AND t.salarie_id = s.id AND s.entreprise_id = $2`,
      [req.params.tempsId, req.user.entrepriseId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Ligne introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /salaries/temps/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

// ═══════════════════════════════════════════════════════════
//  Bulletin mensuel estimé (lecture seule, pas un moteur de paie)
//  net ≈ salaire − avances du mois − retenue pour absences non payées
// ═══════════════════════════════════════════════════════════
router.get('/:id/bulletin', authRequired, async (req, res) => {
  try {
    const access = await resolveAccessibleSalarie(req, req.params.id);
    if (!access) return res.status(404).json({ error: 'Salarié introuvable.' });
    const mois = /^\d{4}-\d{2}$/.test(req.query.mois || '') ? req.query.mois : new Date().toISOString().slice(0, 7);
    const debut = `${mois}-01`;
    const finExclue = (() => { const d = new Date(`${debut}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); })();

    const contratR = await pool.query(
      'SELECT salaire::float8 AS salaire, type FROM salaries_contrats WHERE salarie_id = $1 AND actif = TRUE ORDER BY id DESC LIMIT 1',
      [req.params.id]
    );
    const salaire = contratR.rows[0]?.salaire ?? access.salaire ?? 0;

    const avancesR = await pool.query(
      'SELECT COALESCE(SUM(montant),0)::float8 AS total FROM salaries_avances WHERE salarie_id = $1 AND date >= $2 AND date < $3',
      [req.params.id, debut, finExclue]
    );
    const avances = avancesR.rows[0].total;

    // Absences non payées : présences 'Absent' du mois + jours de congés approuvés d'un type non payé démarrant dans le mois.
    const absR = await pool.query(
      `SELECT COUNT(*)::int AS n FROM salaries_presences WHERE salarie_id = $1 AND statut = 'Absent' AND date >= $2 AND date < $3`,
      [req.params.id, debut, finExclue]
    );
    const congesNonPayesR = await pool.query(
      `SELECT COALESCE(SUM(c.nb_jours),0)::float8 AS n
       FROM salaries_conges c JOIN conges_types ct ON ct.id = c.type_id
       WHERE c.salarie_id = $1 AND c.statut = 'Approuvé' AND ct.paye = FALSE
         AND c.date_debut >= $2 AND c.date_debut < $3`,
      [req.params.id, debut, finExclue]
    );
    const joursAbsenceNonPayee = absR.rows[0].n + congesNonPayesR.rows[0].n;

    // Jours ouvrés du mois (dimanche + fériés exclus, calendrier salarié si défini).
    const { feriesSet, joursTravailles } = await chargerFeriesEtCalendrier(req.user.entrepriseId, req.params.id);
    const finMoisInclus = (() => { const d = new Date(`${finExclue}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
    const joursOuvresMois = calculerJoursOuvres(debut, finMoisInclus, feriesSet, joursTravailles);

    const retenueAbsences = joursOuvresMois > 0 ? Math.round((salaire * joursAbsenceNonPayee / joursOuvresMois) * 100) / 100 : 0;
    const netEstime = Math.round((salaire - avances - retenueAbsences) * 100) / 100;

    return res.json({
      mois, salaire, avances, joursAbsenceNonPayee, joursOuvresMois, retenueAbsences, netEstime,
      contratType: contratR.rows[0]?.type || null,
    });
  } catch (err) {
    console.error('[GET /salaries/:id/bulletin]', err);
    return res.status(500).json({ error: 'Erreur lors du calcul du bulletin.' });
  }
});

export default router;
