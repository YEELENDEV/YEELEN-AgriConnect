// Toutes les émissions d'email de l'app passent par ce fichier (aucun autre fichier
// n'appelle nodemailer directement) : codes MFA, création de compte employé, envoi de
// devis au client. Dépend d'EMAIL_USER/EMAIL_PASS (identifiants Gmail) — sans eux
// configurés, chaque sendXxxEmail échoue silencieusement côté appelant (voir devis.js,
// où l'échec d'envoi est un problème produit déjà documenté séparément).
import nodemailer from 'nodemailer';
import { echapperHtml as h, ligneEntete } from '../utils/html.js';

// Un seul transporteur Gmail partagé pour toute l'app — pas de compte SMTP par
// entreprise, l'email part toujours depuis le même compte technique.
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Envoie le code à usage unique de la double authentification par email (distinct de la
// méthode TOTP, qui n'a pas besoin d'email). Le code lui-même est dérivé et vérifié côté
// appelant (utils/mfaCode.js), pas ici. `context` (optionnel) porte les infos de la
// tentative de connexion (appareil / navigateur / IP) pour aider l'utilisateur à repérer
// une tentative qui ne viendrait pas de lui — même intention que l'email de code de l'ERP
// de référence.
export async function sendMfaCodeEmail(to, code, context = {}) {
  const { device, browser, ip } = context;
  const contextLine =
    device || browser || ip
      ? `<p style="color: #888; font-size: 12px;">Tentative de connexion${
          browser ? ` depuis ${h(browser)}` : ''
        }${device ? ` sur ${h(device)}` : ''}${
          ip ? ` (IP ${h(ip)})` : ''
        }. Si ce n'est pas vous, ne communiquez ce code à personne et changez votre mot de passe.</p>`
      : '';
  await transporter.sendMail({
    from: `"YEELEN AgriConnect" <${process.env.EMAIL_USER}>`,
    to,
    subject: 'Votre code de vérification',
    html: `
      <div style="font-family: sans-serif; padding: 20px;">
        <h2>YEELEN AgriConnect</h2>
        <p>Votre code de vérification est :</p>
        <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${h(code)}</p>
        <p style="color: #888; font-size: 13px;">Ce code expire dans 10 minutes.</p>
        ${contextLine}
      </div>
    `,
  });
}

// Envoyé quand un admin crée un compte de connexion pour un employé (EmployeesModule,
// option "Créer un compte de connexion") — communique le mot de passe temporaire en
// clair par email, à charge pour l'employé de le changer à la première connexion.
export async function sendWelcomeEmail(to, tempPassword, prenom) {
  await transporter.sendMail({
    from: `"YEELEN AgriConnect" <${process.env.EMAIL_USER}>`,
    to,
    subject: 'Votre accès à YEELEN AgriConnect',
    html: `
      <div style="font-family: sans-serif; padding: 20px;">
        <h2>Bienvenue ${h(prenom)},</h2>
        <p>Un compte a été créé pour vous sur YEELEN AgriConnect.</p>
        <p>Email de connexion : <strong>${h(to)}</strong></p>
        <p>Mot de passe temporaire : <strong>${h(tempPassword)}</strong></p>
        <p style="color: #888; font-size: 13px;">Pensez à le changer dès votre première connexion.</p>
      </div>
    `,
  });
}

// Envoyé à l'inscription d'une nouvelle entreprise, avant que le compte soit utilisable
// (voir routes/auth.js:register/confirmer-inscription) — code à 6 chiffres dérivé par
// utils/mfaCode.js, jamais stocké, même mécanique que le code MFA email mais distinct dans
// son intitulé pour ne pas laisser croire à un problème de sécurité sur un compte existant.
export async function sendInscriptionCodeEmail(to, code, nomEntreprise) {
  await transporter.sendMail({
    from: `"YEELEN AgriConnect" <${process.env.EMAIL_USER}>`,
    to,
    subject: 'Confirmez votre inscription à YEELEN AgriConnect',
    html: `
      <div style="font-family: sans-serif; padding: 20px;">
        <h2>Bienvenue${nomEntreprise ? ` ${h(nomEntreprise)}` : ''},</h2>
        <p>Pour activer votre compte YEELEN AgriConnect, saisissez ce code de confirmation :</p>
        <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${h(code)}</p>
        <p style="color: #888; font-size: 13px;">Ce code expire dans 10 minutes. Si vous n'êtes pas à l'origine de cette inscription, ignorez cet email.</p>
      </div>
    `,
  });
}

// Envoie un email au client avec un lien vers son devis, pour consultation et signature
// — le lien pointe vers la route publique /devis/public/:token (pas d'authentification
// requise côté client, uniquement le token dans l'URL le protège).
export async function sendDevisEmail(to, clientNom, entrepriseNom, numero, lienConsultation) {
  await transporter.sendMail({
    // Objet nodemailer plutôt que chaîne : le nom (saisi par l'entreprise) est encodé par
    // nodemailer, des guillemets ou un retour à la ligne ne peuvent plus casser l'en-tête From.
    from: { name: ligneEntete(entrepriseNom), address: process.env.EMAIL_USER },
    to,
    subject: ligneEntete(`Devis ${numero} — ${entrepriseNom}`, 200),
    html: `
      <div style="font-family: sans-serif; padding: 20px;">
        <h2>Bonjour ${h(clientNom)},</h2>
        <p>Vous avez reçu un nouveau devis de la part de <strong>${h(entrepriseNom)}</strong>.</p>
        <p>Numéro de devis : <strong>${h(numero)}</strong></p>
        <p><a href="${h(lienConsultation)}" style="display:inline-block; padding:12px 24px; background:#2d6a4f; color:#fff; text-decoration:none; border-radius:8px;">Consulter et signer le devis</a></p>
        <p style="color: #888; font-size: 13px;">Ce lien est personnel, ne le partagez pas.</p>
      </div>
    `,
  });
}
