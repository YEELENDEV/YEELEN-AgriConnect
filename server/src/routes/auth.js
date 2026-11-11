// Cycle de vie complet d'un compte : inscription (register), connexion (login, avec
// étape MFA optionnelle), profil courant (me), et lecture du journal d'audit des
// connexions (audit-log, admin uniquement). Toutes les routes ci-dessous, sauf
// /register et /login (forcément publiques), sont protégées par authRequired.
import express from 'express';
import bcrypt from 'bcryptjs';
// otplib 13 : import ESM natif (dual ESM/CJS). Voir le commentaire équivalent dans mfa.js.
import { verify as verifyTotp } from 'otplib';
import { pool } from '../db.js';
import { authRequired, signerToken } from '../middleware/auth.js';
import { validerMotDePasse, validerEmail, BCRYPT_COUT, HASH_FACTICE } from '../utils/motDePasse.js';
import { CATEGORIES_PRODUITS_DEFAUT, CONGES_TYPES_DEFAUT, PAYMENT_TERMS_DEFAUT } from '../utils/referentielsDefaut.js';
import { logAuditEvent, getAuditLog, countRecentAuditEvents, countRecentAuditEventsByIp, extraireIp } from '../utils/auditLog.js';
import { TRIAL_DAYS } from '../config/abonnement.js';
import { verifierRecaptcha } from '../utils/recaptcha.js';
import { generateEmailCode, verifyEmailCode, requestContext } from '../utils/mfaCode.js';
import { sendMfaCodeEmail, sendInscriptionCodeEmail } from '../services/mailer.js';
import { COMPTES_DEFAUT, JOURNAUX_DEFAUT } from '../utils/comptaDefauts.js';
import { UNITES_MESURE_DEFAUT } from '../utils/unitesMesureDefaut.js';
import { EMPLACEMENTS_STOCK_DEFAUT } from '../utils/emplacementsStockDefaut.js';

const router = express.Router();

// Nombre d'échecs de mot de passe tolérés par compte sur la fenêtre ci-dessous avant de
// refuser temporairement toute nouvelle tentative (anti force brute, en complément du
// limiteur par IP posé dans app.js — qui, lui, ne protège pas d'une attaque distribuée).
const ECHECS_MDP_MAX = 10;
const FENETRE_ECHECS_MDP_MIN = 15;

// Référentiels amorcés pour toute nouvelle entreprise : listes partagées avec migrate.js via
// utils/referentielsDefaut.js. Sans les catégories de produits, une entreprise inscrite ne
// pourrait ajouter aucun article de stock tant qu'un admin n'en crée pas une à la main.
// ─── POST /api/auth/register ───────────────────────────────────────────────
// Crée en une seule transaction : le compte utilisateur, sa nouvelle entreprise, et le
// lien entre les deux avec le rôle 'admin' — celui qui s'inscrit est toujours admin de
// la toute nouvelle entreprise qu'il vient de créer (pas de rejoindre une entreprise
// existante depuis cette route).
router.post('/register', async (req, res) => {
  const { email, password, nomEntreprise, typeCompte, siret, devise, locale, recaptchaToken, telephone, pays, numeroTva, adresse } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  }
  const erreurEmail = validerEmail(email);
  if (erreurEmail) return res.status(400).json({ error: erreurEmail });
  const erreurMdp = validerMotDePasse(password);
  if (erreurMdp) return res.status(400).json({ error: erreurMdp });

  // pays/téléphone/TVA/adresse : facultatifs pour un compte 'particulier' (comme le SIRET),
  // obligatoires pour 'entreprise' — décision explicite de l'utilisateur, voir docs/journal.md.
  if ((typeCompte !== 'particulier') && (!telephone || !pays || !numeroTva || !adresse)) {
    return res.status(400).json({ error: 'Pays, téléphone, numéro de TVA et adresse sont requis pour un compte entreprise.' });
  }

  // reCAPTCHA v3 (Lot 3, inspiré du module Odoo google_recaptcha) : repli gracieux total tant
  // que RECAPTCHA_SECRET_KEY n'est pas configuré (voir utils/recaptcha.js) — ne bloque jamais
  // en dev/avant que l'utilisateur ait créé ses clés Google.
  const recaptcha = await verifierRecaptcha(recaptchaToken, 'register');
  if (!recaptcha.ok) {
    return res.status(400).json({ error: 'Vérification anti-robot échouée. Réessayez.' });
  }

  // Deux types de comptes possibles : 'entreprise' (avec SIRET optionnel) ou
  // 'particulier' — tout ce qui n'est pas explicitement 'particulier' est traité
  // comme 'entreprise' par défaut.
  const compteType = typeCompte === 'particulier' ? 'particulier' : 'entreprise';

  // Abonnement Phase 1, anti-abus (2026-09-04) : freine la création répétée de comptes
  // d'essai depuis une même adresse (contourner la période d'évaluation en changeant
  // d'email à chaque fois) — indépendant du reCAPTCHA à venir (défense en profondeur, voir
  // docs/spec-abonnement-phase1.md). IP absente (proxy mal configuré) = jamais bloquant,
  // voir countRecentAuditEventsByIp. Vérifié AVANT la transaction : inutile d'ouvrir une
  // connexion dédiée pour un rejet qui n'écrit rien.
  const ipInscription = extraireIp(req);
  const inscriptionsRecentes = await countRecentAuditEventsByIp(ipInscription, ['trial_started'], 24 * 60);
  if (inscriptionsRecentes >= 3) {
    return res.status(429).json({ error: 'Trop d\'inscriptions depuis cette adresse. Réessayez plus tard.' });
  }

  const client = await pool.connect();
  try {
    const existing = await client.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Un utilisateur avec cet email existe déjà.' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COUT);

    // Transaction explicite : les 3 INSERT (user, entreprise, lien) doivent réussir
    // ensemble ou pas du tout — un utilisateur sans entreprise, ou une entreprise sans
    // admin, laisserait l'app dans un état incohérent.
    await client.query('BEGIN');

    const userResult = await client.query(
      `INSERT INTO users (email, role, password)
       VALUES ($1, $2, $3)
       RETURNING id, email, created_at`,
      [email.toLowerCase(), 'admin', passwordHash]
    );
    const user = userResult.rows[0];

    // Nom d'entreprise par défaut si non fourni — dépend du type de compte pour rester
    // cohérent ("Espace de x@y.com" pour un particulier, "Entreprise de x@y.com" sinon).
    const entrepriseResult = await client.query(
      `INSERT INTO entreprises (nom, siret, type_compte, devise, locale, subscription_status, trial_ends_at, email_confirme, telephone, pays, numero_tva, adresse, modules_actifs_initialises)
       VALUES ($1, $2, $3, COALESCE($4, 'XOF'), COALESCE($5, 'fr-FR'), 'trial', now() + ($6 || ' days')::interval, FALSE, $7, $8, $9, $10, TRUE)
       RETURNING id, nom, siret, type_compte, devise, locale, subscription_status AS "subscriptionStatus", trial_ends_at AS "trialEndsAt"`,
      [
        nomEntreprise || `${compteType === 'particulier' ? 'Espace' : 'Entreprise'} de ${user.email}`,
        compteType === 'entreprise' ? (siret || null) : null,
        compteType,
        devise || null,
        locale || null,
        String(TRIAL_DAYS),
        compteType === 'entreprise' ? telephone : (telephone || null),
        compteType === 'entreprise' ? pays : (pays || null),
        compteType === 'entreprise' ? numeroTva : (numeroTva || null),
        compteType === 'entreprise' ? adresse : (adresse || null),
      ]
    );
    const entreprise = entrepriseResult.rows[0];

    await client.query(
      `INSERT INTO entreprise_utilisateurs (entreprise_id, user_id, role, statut)
       VALUES ($1, $2, $3, 'Actif')`,
      [entreprise.id, user.id, 'admin']
    );

    for (const cat of CATEGORIES_PRODUITS_DEFAUT) {
      await client.query(
        `INSERT INTO produit_categories (entreprise_id, module, nom, ordre) VALUES ($1, $2, $3, $4)
         ON CONFLICT (entreprise_id, module, nom) DO NOTHING`,
        [entreprise.id, cat.module, cat.nom, cat.ordre]
      );
    }

    for (const t of CONGES_TYPES_DEFAUT) {
      await client.query(
        `INSERT INTO conges_types (entreprise_id, nom, paye, justificatif_requis, couleur, ordre)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (entreprise_id, nom) DO NOTHING`,
        [entreprise.id, t.nom, t.paye, t.justificatif_requis, t.couleur, t.ordre]
      );
    }

    for (const term of PAYMENT_TERMS_DEFAUT) {
      const ptRes = await client.query(
        `INSERT INTO payment_terms (entreprise_id, name, sequence) VALUES ($1, $2, $3)
         ON CONFLICT (entreprise_id, name) DO NOTHING RETURNING id`,
        [entreprise.id, term.name, term.sequence]
      );
      if (!ptRes.rows[0]) continue;
      for (const l of term.lines) {
        await client.query(
          `INSERT INTO payment_term_lines (payment_term_id, value, value_amount, delay_type, nb_days, ordre)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [ptRes.rows[0].id, l.value, l.value_amount, l.delay_type, l.nb_days, l.ordre]
        );
      }
    }

    // Étape 2 Comptabilité : plan de comptes + journaux par défaut (mêmes listes que
    // migrate.js:seedComptaConfigForExistingEntreprises, via utils/comptaDefauts.js).
    const compteIdParCode = {};
    for (const c of COMPTES_DEFAUT) {
      const acc = await client.query(
        `INSERT INTO account_account (entreprise_id, code, name, account_type, reconcile)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (entreprise_id, code) DO UPDATE SET code = EXCLUDED.code RETURNING id`,
        [entreprise.id, c.code, c.name, c.account_type, c.reconcile]
      );
      compteIdParCode[c.code] = acc.rows[0].id;
    }
    for (const j of JOURNAUX_DEFAUT) {
      await client.query(
        `INSERT INTO account_journal (entreprise_id, name, code, type, sequence, refund_sequence, default_account_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (entreprise_id, code) DO NOTHING`,
        [entreprise.id, j.name, j.code, j.type, j.sequence, j.refund_sequence,
         j.defaultAccountCode ? compteIdParCode[j.defaultAccountCode] : null]
      );
    }

    // Étape 1 alignement Odoo produit/stock : catégories d'unités de mesure + unités par
    // défaut (mêmes listes que migrate.js:seedUnitesMesureForExistingEntreprises, via
    // utils/unitesMesureDefaut.js).
    for (const cat of UNITES_MESURE_DEFAUT) {
      const catRes = await client.query(
        `INSERT INTO unites_mesure_categories (entreprise_id, nom) VALUES ($1, $2)
         ON CONFLICT (entreprise_id, nom) DO NOTHING RETURNING id`,
        [entreprise.id, cat.categorie]
      );
      if (!catRes.rows[0]) continue;
      for (const u of cat.unites) {
        await client.query(
          `INSERT INTO unites_mesure (entreprise_id, categorie_id, nom, symbole, facteur, est_reference)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [entreprise.id, catRes.rows[0].id, u.nom, u.symbole, u.facteur, u.estReference]
        );
      }
    }

    // Emplacements de stock par défaut (étape 3 alignement Odoo produit/stock — mêmes
    // emplacements que migrate.js:seedEmplacementsStockForExistingEntreprises, via
    // utils/emplacementsStockDefaut.js).
    for (const e of EMPLACEMENTS_STOCK_DEFAUT) {
      await client.query(
        `INSERT INTO emplacements_stock (entreprise_id, nom, type, par_defaut) VALUES ($1, $2, $3, $4)
         ON CONFLICT (entreprise_id, nom) DO NOTHING`,
        [entreprise.id, e.nom, e.type, e.type === 'interne']
      );
    }

    // Le compte qui ouvre l'entreprise en est le propriétaire, définitivement : aucune
    // restriction ne lui sera opposable. C'est lui qui créera ensuite les rôles correspondant à
    // la constitution de son entreprise. Aucun rôle n'est amorcé — l'application ne fournit pas
    // de politique, elle fournit les options pour en écrire une.
    await client.query('UPDATE entreprises SET proprietaire_user_id = $1 WHERE id = $2', [user.id, entreprise.id]);

    await client.query('COMMIT');

    await logAuditEvent({
      entrepriseId: entreprise.id, userId: user.id, email: user.email, action: 'trial_started', req,
      details: { trialDays: TRIAL_DAYS },
    });

    // Confirmation par email obligatoire avant tout token (email_confirme = FALSE posé
    // ci-dessus) : le code est envoyé maintenant, l'inscription se termine réellement dans
    // POST /confirmer-inscription. Échec d'envoi = best-effort (comme sendMfaCodeEmail au
    // login) — l'utilisateur peut toujours redemander un code via /renvoyer-code-inscription.
    const code = generateEmailCode(user.id, user.email);
    await logAuditEvent({ entrepriseId: entreprise.id, userId: user.id, email: user.email, action: 'inscription_code_envoye', req });
    try {
      await sendInscriptionCodeEmail(user.email, code, entreprise.nom);
    } catch (mailErr) {
      console.error('[register] envoi code de confirmation', mailErr);
    }

    return res.status(201).json({ confirmationRequired: true, email: user.email });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[register]', err);
    return res.status(500).json({ error: "Erreur serveur lors de l'inscription." });
  } finally {
    client.release();
  }
});

// ─── POST /api/auth/confirmer-inscription ──────────────────────────────────
// Deuxième étape de l'inscription : vérifie le code reçu par email et active le compte
// (entreprises.email_confirme -> TRUE), puis renvoie le même payload {token,user,entreprise}
// que renvoyait l'ancien /register avant l'ajout de cette étape.
router.post('/confirmer-inscription', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: 'Email et code requis.' });
  }

  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.created_at, u.is_platform_admin, eu.entreprise_id, eu.role,
              e.nom AS entreprise_nom, e.type_compte, e.devise, e.locale, e.fuseau, e.email_confirme
       FROM users u
       JOIN entreprise_utilisateurs eu ON eu.user_id = u.id AND eu.statut = 'Actif'
       JOIN entreprises e ON e.id = eu.entreprise_id
       WHERE LOWER(u.email) = LOWER($1)
       LIMIT 1`,
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Compte introuvable.' });
    }
    const row = result.rows[0];
    if (row.email_confirme) {
      return res.status(400).json({ error: 'Ce compte est déjà confirmé.' });
    }

    const recent = await countRecentAuditEvents(row.email, ['inscription_code_invalide'], 60);
    if (recent >= 5) {
      return res.status(429).json({ error: "Trop de tentatives. Réessayez dans une heure." });
    }

    if (!verifyEmailCode(row.id, row.email, code)) {
      await logAuditEvent({ entrepriseId: row.entreprise_id, userId: row.id, email: row.email, action: 'inscription_code_invalide', req });
      return res.status(401).json({ error: 'Code invalide ou expiré.' });
    }

    await pool.query('UPDATE entreprises SET email_confirme = TRUE WHERE id = $1', [row.entreprise_id]);
    await logAuditEvent({ entrepriseId: row.entreprise_id, userId: row.id, email: row.email, action: 'inscription_confirmee', req });

    const isPlatformAdmin = row.is_platform_admin === true;
    const token = signerToken({ sub: row.id, email: row.email, entrepriseId: row.entreprise_id, role: row.role, isPlatformAdmin });
    return res.json({
      token,
      user: { id: row.id, email: row.email, role: row.role, createdAt: row.created_at, isPlatformAdmin },
      entreprise: { id: row.entreprise_id, nom: row.entreprise_nom, typeCompte: row.type_compte, devise: row.devise, locale: row.locale, fuseau: row.fuseau },
    });
  } catch (err) {
    console.error('[confirmer-inscription]', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la confirmation.' });
  }
});

// ─── POST /api/auth/renvoyer-code-inscription ──────────────────────────────
// Réponse volontairement identique que l'email existe ou non / soit déjà confirmé (parité
// avec la logique anti-énumération du login) : { ok: true } dans tous les cas, l'envoi réel
// n'a lieu que si un compte en attente de confirmation correspond.
router.post('/renvoyer-code-inscription', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email requis.' });
  }
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, eu.entreprise_id, e.nom AS entreprise_nom, e.email_confirme
       FROM users u
       JOIN entreprise_utilisateurs eu ON eu.user_id = u.id AND eu.statut = 'Actif'
       JOIN entreprises e ON e.id = eu.entreprise_id
       WHERE LOWER(u.email) = LOWER($1)
       LIMIT 1`,
      [email]
    );
    const row = result.rows[0];
    if (row && !row.email_confirme) {
      const recent = await countRecentAuditEvents(row.email, ['inscription_code_envoye'], 60);
      if (recent < 5) {
        const code = generateEmailCode(row.id, row.email);
        await logAuditEvent({ entrepriseId: row.entreprise_id, userId: row.id, email: row.email, action: 'inscription_code_envoye', req });
        try {
          await sendInscriptionCodeEmail(row.email, code, row.entreprise_nom);
        } catch (mailErr) {
          console.error('[renvoyer-code-inscription]', mailErr);
        }
      }
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[renvoyer-code-inscription]', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── POST /api/auth/login ──────────────────────────────────────────────────
// Chaque branche (email inconnu, mauvais mot de passe, MFA requis/échoué, pas
// d'entreprise, succès) journalise son propre événement dans audit_log — voir
// CLAUDE.md, section "Jalon 1", pour la liste complète des actions tracées.
router.post('/login', async (req, res) => {
  const { email, password, mfaCode, confirmationCode } = req.body;

  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );

    if (result.rows.length === 0) {
      // Comparaison factice : sans elle, un email inconnu répond en ~1 ms contre ~100 ms pour un
      // email existant (coût bcrypt) — l'écart de temps suffisait à énumérer les comptes.
      await bcrypt.compare(String(password), HASH_FACTICE);
      await logAuditEvent({ email, action: 'login_failed_unknown_email', req });
      // Message générique volontaire ("Identifiants invalides", pas "email inconnu") :
      // ne pas révéler si l'email existe ou non, pour ne pas faciliter l'énumération
      // de comptes valides par un tiers.
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    const user = result.rows[0];

    // Récupéré tôt (avant les vérifications) pour pouvoir tracer l'entreprise
    // concernée même sur les tentatives échouées d'un compte existant.
    const rattachement = await pool.query(
      `SELECT eu.entreprise_id, eu.role, e.nom AS entreprise_nom, e.devise, e.locale, e.fuseau, e.email_confirme
       FROM entreprise_utilisateurs eu
       JOIN entreprises e ON e.id = eu.entreprise_id
       WHERE eu.user_id = $1 AND eu.statut = 'Actif'
       LIMIT 1`,
      [user.id]
    );
    const entrepriseId = rattachement.rows[0]?.entreprise_id ?? null;

    // Verrouillage temporaire après trop d'échecs sur CE compte (force brute distribuée sur
    // plusieurs IP, que le limiteur par IP ne voit pas). Vérifié avant bcrypt : pendant le
    // verrouillage, même le bon mot de passe est refusé — sinon le verrou ne protège rien.
    const echecsRecents = await countRecentAuditEvents(user.email, ['login_failed_password'], FENETRE_ECHECS_MDP_MIN);
    if (echecsRecents >= ECHECS_MDP_MAX) {
      await logAuditEvent({ entrepriseId, userId: user.id, email: user.email, action: 'login_locked', req });
      return res.status(429).json({ error: `Trop de tentatives échouées. Réessayez dans ${FENETRE_ECHECS_MDP_MIN} minutes.` });
    }

    const valid = await bcrypt.compare(String(password), user.password);
    if (!valid) {
      await logAuditEvent({ entrepriseId, userId: user.id, email: user.email, action: 'login_failed_password', req });
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    // Filet de sécurité pour l'inscription à deux étapes (voir /register et
    // /confirmer-inscription) : si l'utilisateur a fermé l'onglet avant de saisir son code
    // et revient se connecter normalement, on le renvoie vers la même étape plutôt que de
    // le laisser échouer sur "Aucune entreprise associée" (rattachement reste trouvé ici
    // car entreprise_utilisateurs.statut n'est pas affecté par email_confirme).
    if (rattachement.rows.length > 0 && rattachement.rows[0].email_confirme === false) {
      if (!confirmationCode) {
        const recentEnvoi = await countRecentAuditEvents(user.email, ['inscription_code_envoye'], 60);
        if (recentEnvoi < 5) {
          const code = generateEmailCode(user.id, user.email);
          await logAuditEvent({ entrepriseId, userId: user.id, email: user.email, action: 'inscription_code_envoye', req });
          try {
            await sendInscriptionCodeEmail(user.email, code, rattachement.rows[0].entreprise_nom);
          } catch (mailErr) {
            console.error('[login] envoi code de confirmation', mailErr);
          }
        }
        return res.status(200).json({ confirmationRequired: true, email: user.email });
      }
      const recentEchecs = await countRecentAuditEvents(user.email, ['inscription_code_invalide'], 60);
      if (recentEchecs >= 5) {
        return res.status(429).json({ error: "Trop de tentatives. Réessayez dans une heure." });
      }
      if (!verifyEmailCode(user.id, user.email, confirmationCode)) {
        await logAuditEvent({ entrepriseId, userId: user.id, email: user.email, action: 'inscription_code_invalide', req });
        return res.status(401).json({ error: 'Code invalide ou expiré.' });
      }
      await pool.query('UPDATE entreprises SET email_confirme = TRUE WHERE id = $1', [entrepriseId]);
      await logAuditEvent({ entrepriseId, userId: user.id, email: user.email, action: 'inscription_confirmee', req });
    }

    // Étape MFA si activée sur le compte. Deux méthodes possibles selon user.mfa_method :
    //   - 'totp'  : application d'authentification (otplib), le code vient de l'appareil ;
    //   - 'email' : code envoyé par email, dérivé/vérifié via utils/mfaCode.js (aucun
    //     stockage). Sans code fourni, on répond 200 (pas 401) avec mfaRequired:true —
    //     étape intermédiaire normale du flux — et, en mode 'email', on envoie le code.
    if (user.mfa_enabled) {
      const mfaMethod = user.mfa_method === 'email' ? 'email' : 'totp';

      if (!mfaCode) {
        if (mfaMethod === 'email') {
          const recent = await countRecentAuditEvents(user.email, ['mfa_email_code_sent'], 60);
          if (recent >= 5) {
            return res.status(429).json({ error: "Trop d'envois de code. Réessayez dans une heure." });
          }
          const code = generateEmailCode(user.id, user.email);
          await logAuditEvent({ entrepriseId, userId: user.id, email: user.email, action: 'mfa_email_code_sent', req });
          try {
            await sendMfaCodeEmail(user.email, code, requestContext(req));
          } catch (mailErr) {
            console.error('[login] envoi code MFA email', mailErr);
          }
        }
        await logAuditEvent({ entrepriseId, userId: user.id, email: user.email, action: 'login_mfa_required', req });
        return res.status(200).json({ mfaRequired: true, mfaMethod });
      }

      // Limite de tentatives de vérification, tous modes confondus (parité avec la
      // limite `code_check` de l'ERP de référence).
      const failedRecent = await countRecentAuditEvents(user.email, ['login_failed_mfa'], 60);
      if (failedRecent >= 5) {
        return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans une heure.' });
      }

      let mfaValid;
      if (mfaMethod === 'email') {
        mfaValid = verifyEmailCode(user.id, user.email, mfaCode);
      } else {
        ({ valid: mfaValid } = await verifyTotp({ secret: user.mfa_secret, token: mfaCode }));
      }
      if (!mfaValid) {
        await logAuditEvent({ entrepriseId, userId: user.id, email: user.email, action: 'login_failed_mfa', req });
        return res.status(401).json({ error: 'Code MFA invalide.' });
      }
    }

    // Un compte valide sans rattachement actif à aucune entreprise ne peut pas se
    // connecter (ex: employé désactivé — voir la logique de statut miroir entre
    // salaries.statut et entreprise_utilisateurs.statut documentée dans CLAUDE.md).
    if (rattachement.rows.length === 0) {
      await logAuditEvent({ userId: user.id, email: user.email, action: 'login_failed_no_entreprise', req });
      return res.status(403).json({ error: 'Aucune entreprise associée à ce compte.' });
    }

    const { role, entreprise_nom: entrepriseNom, devise: entrepriseDevise, locale: entrepriseLocale, fuseau: entrepriseFuseau } = rattachement.rows[0];
    const isPlatformAdmin = user.is_platform_admin === true;

    // Le JWT porte entrepriseId/role/isPlatformAdmin en dur : une bascule de rôle ou du
    // flag is_platform_admin en base ne prend effet qu'à la prochaine connexion, pas en
    // temps réel sur un token déjà émis (voir requirePlatformAdmin.js).
    const token = signerToken({ sub: user.id, email: user.email, entrepriseId, role, isPlatformAdmin });

    await logAuditEvent({ entrepriseId, userId: user.id, email: user.email, action: 'login_success', req });

    return res.json({
      token,
      user: { id: user.id, email: user.email, role, createdAt: user.created_at, isPlatformAdmin },
      entreprise: { id: entrepriseId, nom: entrepriseNom, devise: entrepriseDevise, locale: entrepriseLocale, fuseau: entrepriseFuseau },
    });
  } catch (err) {
    console.error('[login]', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la connexion.' });
  }
});

// ─── GET /api/auth/me ──────────────────────────────────────────────────────
// Relit l'état actuel en base (contrairement au JWT, qui est figé au moment de sa
// signature) — utile pour rafraîchir l'affichage frontend sans forcer une reconnexion,
// même si le rôle/flag effectivement appliqué aux permissions reste celui du JWT en cours.
router.get('/me', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
  `SELECT u.id, u.email, u.created_at, u.mfa_enabled, u.mfa_method, u.is_platform_admin, eu.role, e.id AS entreprise_id, e.nom AS entreprise_nom, e.devise, e.locale, e.fuseau
   FROM users u
   JOIN entreprise_utilisateurs eu ON eu.user_id = u.id
   JOIN entreprises e ON e.id = eu.entreprise_id
   WHERE u.id = $1 AND eu.entreprise_id = $2`,
  [req.user.sub, req.user.entrepriseId]
);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    const row = result.rows[0];
return res.json({
  user: { id: row.id, email: row.email, role: row.role, createdAt: row.created_at, mfaEnabled: row.mfa_enabled, mfaMethod: row.mfa_method || 'totp', isPlatformAdmin: row.is_platform_admin === true },
  entreprise: { id: row.entreprise_id, nom: row.entreprise_nom, devise: row.devise, locale: row.locale, fuseau: row.fuseau },
});
  } catch (err) {
    console.error('[me]', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ─── GET /api/auth/audit-log — journal des connexions (admin uniquement) ──
// Scopé par entreprise (req.user.entrepriseId), donc un admin ne voit que les
// tentatives de connexion liées à sa propre entreprise, pas celles des autres.
router.get('/audit-log', authRequired, async (req, res) => {
  try {
    const historique = await getAuditLog(req.user.entrepriseId);
    return res.json({ historique });
  } catch (err) {
    console.error('[GET /audit-log]', err);
    return res.status(500).json({ error: "Erreur lors de la récupération du journal d'audit." });
  }
});

export default router;
