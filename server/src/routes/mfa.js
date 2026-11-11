import express from 'express';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
// otplib 13 est un paquet dual ESM/CJS — l'import ESM natif fonctionne aussi bien
// sous `node` qu'avec Jest (--experimental-vm-modules), contrairement au shim
// createRequire('otplib') qui cassait le chargement d'une dépendance ESM (@scure/base).
import { generateSecret, generateURI, verify } from 'otplib';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { logAuditEvent, countRecentAuditEvents } from '../utils/auditLog.js';
import { generateEmailCode, verifyEmailCode, maskEmail, requestContext } from '../utils/mfaCode.js';
import { sendMfaCodeEmail } from '../services/mailer.js';

const router = express.Router();

// Nb max d'emails de code 2FA par heure et par compte (envoi côté enrôlement ET côté
// connexion partagent ce compteur) — même esprit que la limite `send_email` de l'ERP
// de référence. Au-delà : 429.
const EMAIL_SEND_LIMIT = 5;

// Génère + envoie un code par email, en respectant la limite de débit. Renvoie
// { ok:true, sentTo } ou { ok:false, status, error }.
async function issueEmailCode(userId, email, req) {
  const recent = await countRecentAuditEvents(email, ['mfa_email_code_sent'], 60);
  if (recent >= EMAIL_SEND_LIMIT) {
    return { ok: false, status: 429, error: "Trop d'envois de code. Réessayez dans une heure." };
  }
  const code = generateEmailCode(userId, email);
  await logAuditEvent({ userId, email, action: 'mfa_email_code_sent', req });
  try {
    await sendMfaCodeEmail(email, code, requestContext(req));
  } catch (err) {
    // Même posture que devis.js : l'échec d'envoi n'annule pas l'opération côté serveur
    // (le code reste valide et re-demandable), mais on le signale.
    console.error('[issueEmailCode] envoi email', err);
    return { ok: false, status: 502, error: "Le code n'a pas pu être envoyé par email. Réessayez." };
  }
  return { ok: true, sentTo: maskEmail(email) };
}

// ─── POST /api/mfa/setup — démarre l'activation ({ method: 'totp' | 'email' }) ───
router.post('/setup', authRequired, async (req, res) => {
  const method = req.body?.method === 'email' ? 'email' : 'totp';
  try {
    const userResult = await pool.query('SELECT email, mfa_enabled FROM users WHERE id = $1', [req.user.sub]);
    if (!userResult.rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    const { email, mfa_enabled: mfaDejaActive } = userResult.rows[0];
    // Sans ce garde, un jeton volé suffisait à remplacer silencieusement le secret TOTP d'un
    // compte déjà protégé (l'attaquant récupérait le QR code de SON appareil). Changer de
    // méthode impose de désactiver d'abord — ce qui exige le mot de passe (voir /disable).
    if (mfaDejaActive) {
      return res.status(409).json({ error: 'La vérification en deux étapes est déjà active. Désactivez-la avant d’en configurer une nouvelle.' });
    }

    if (method === 'email') {
      const r = await issueEmailCode(req.user.sub, email, req);
      if (!r.ok) return res.status(r.status).json({ error: r.error });
      return res.json({ method: 'email', sentTo: r.sentTo });
    }

    // method === 'totp'
    const secret = generateSecret();
    const otpauthUrl = generateURI({ issuer: 'YEELEN AgriConnect', label: email, secret });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
    // On stocke le secret mais mfa_enabled reste false tant que l'utilisateur n'a pas confirmé.
    await pool.query('UPDATE users SET mfa_secret = $1 WHERE id = $2', [secret, req.user.sub]);
    return res.json({ method: 'totp', qrCode: qrCodeDataUrl, secret });
  } catch (err) {
    console.error('[POST /mfa/setup]', err);
    return res.status(500).json({ error: "Erreur lors du démarrage de l'activation." });
  }
});

// ─── POST /api/mfa/resend — renvoie un code par email (écran d'enrôlement) ───
router.post('/resend', authRequired, async (req, res) => {
  try {
    const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [req.user.sub]);
    const email = userResult.rows[0].email;
    const r = await issueEmailCode(req.user.sub, email, req);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    return res.json({ sentTo: r.sentTo });
  } catch (err) {
    console.error('[POST /mfa/resend]', err);
    return res.status(500).json({ error: "Erreur lors du renvoi du code." });
  }
});

// ─── POST /api/mfa/verify — confirme l'activation ({ code, method }) ───
router.post('/verify', authRequired, async (req, res) => {
  const { code } = req.body;
  const method = req.body?.method === 'email' ? 'email' : 'totp';
  if (!code) return res.status(400).json({ error: 'Code requis.' });

  try {
    const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [req.user.sub]);
    if (!userResult.rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    const { email } = userResult.rows[0];

    // Même limite que la connexion (5 échecs/heure) : un code à 6 chiffres ne doit pas pouvoir
    // être deviné par essais successifs.
    const echecs = await countRecentAuditEvents(email, ['mfa_verify_failed'], 60);
    if (echecs >= 5) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans une heure.' });
    }
    const echec = async (message) => {
      await logAuditEvent({ entrepriseId: req.user.entrepriseId, userId: req.user.sub, email, action: 'mfa_verify_failed', req });
      return res.status(400).json({ error: message });
    };

    if (method === 'email') {
      if (!verifyEmailCode(req.user.sub, email, code)) {
        return echec('Code invalide ou expiré.');
      }
      await pool.query(
        "UPDATE users SET mfa_enabled = true, mfa_method = 'email', mfa_secret = NULL WHERE id = $1",
        [req.user.sub]
      );
      return res.json({ success: true, method: 'email' });
    }

    // method === 'totp'
    const result = await pool.query('SELECT mfa_secret FROM users WHERE id = $1', [req.user.sub]);
    const secret = result.rows[0]?.mfa_secret;
    if (!secret) return res.status(400).json({ error: "Aucune procédure d'activation en cours." });

    const { valid } = await verify({ secret, token: String(code) });
    if (!valid) return echec('Code invalide.');

    await pool.query(
      "UPDATE users SET mfa_enabled = true, mfa_method = 'totp' WHERE id = $1",
      [req.user.sub]
    );
    return res.json({ success: true, method: 'totp' });
  } catch (err) {
    console.error('[POST /mfa/verify]', err);
    return res.status(500).json({ error: 'Erreur lors de la vérification.' });
  }
});

// ─── POST /api/mfa/disable ({ password }) ───
// Exige le mot de passe actuel : désactiver la 2FA affaiblit le compte, un jeton de session
// seul (volé, ou session laissée ouverte) ne doit pas suffire.
router.post('/disable', authRequired, async (req, res) => {
  const { password } = req.body || {};
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Mot de passe requis pour désactiver la vérification en deux étapes.' });
  }
  try {
    const userResult = await pool.query('SELECT email, password FROM users WHERE id = $1', [req.user.sub]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    const echecs = await countRecentAuditEvents(user.email, ['mfa_disable_failed'], 60);
    if (echecs >= 5) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans une heure.' });
    }
    if (!(await bcrypt.compare(password, user.password))) {
      await logAuditEvent({ entrepriseId: req.user.entrepriseId, userId: req.user.sub, email: user.email, action: 'mfa_disable_failed', req });
      return res.status(401).json({ error: 'Mot de passe incorrect.' });
    }

    await pool.query(
      "UPDATE users SET mfa_enabled = false, mfa_secret = NULL, mfa_method = 'totp' WHERE id = $1",
      [req.user.sub]
    );
    await logAuditEvent({ entrepriseId: req.user.entrepriseId, userId: req.user.sub, email: req.user.email, action: 'mfa_disabled', req });
    return res.json({ success: true });
  } catch (err) {
    console.error('[POST /mfa/disable]', err);
    return res.status(500).json({ error: 'Erreur lors de la désactivation.' });
  }
});

export default router;
