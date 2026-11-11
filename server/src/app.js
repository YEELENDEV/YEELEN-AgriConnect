// Fabrique de l'application Express — construit et configure `app` (middlewares + montage
// de toutes les routes /api/*) SANS ouvrir de port ni tester la base. `server.js` l'importe
// pour lancer le vrai serveur ; la suite de tests d'intégration l'importe pour la piloter
// avec supertest sans démarrer de listener.
//
// (Un ancien `server/src/app.js` — un simple doublon de server.js — avait été supprimé le
// 2026-08-16 ; ce fichier-ci, recréé le 2026-08-29, a un rôle différent et assumé :
// c'est la source unique du montage des routes, partagée entre prod et tests.)
import express from "express";
import cors from "cors";
import { IS_PRODUCTION } from "./config/env.js";
import {
  enTetesSecurite, creerLimiteur, asyncMiddleware, route404, gestionnaireErreurs,
} from "./middleware/securite.js";

import authRoutes from "./routes/auth.js";
import businessRoutes from "./routes/business.js";
import culturesRoutes from "./routes/cultures.js";
import poulaillerRoutes from "./routes/poulailler.js";
import piscicultureRoutes from "./routes/pisciculture.js";
import meteoRoutes from "./routes/meteo.js";
import precisionAgricoleRoutes from "./routes/precisionAgricole.js";
import devisesRoutes from "./routes/devises.js";
import entrepriseRoutes from "./routes/entreprise.js";
import salariesRoutes from "./routes/salaries.js";
import banquesRoutes from "./routes/banques.js";
import mfaRoutes from "./routes/mfa.js";
import devisRoutes from "./routes/devis.js";
import achatsRoutes from "./routes/achats.js";
import observationsRoutes from "./routes/observations.js";
import camerasRoutes from "./routes/cameras.js";
import planningRoutes from "./routes/planning.js";
import calendarRoutes from "./routes/calendar.js";
import recoltesRoutes from "./routes/recoltes.js";
import feedbackRoutes from "./routes/feedback.js";
import equipementsRoutes from "./routes/equipements.js";
import produitsRoutes from "./routes/produits.js";
import emplacementsStockRoutes from "./routes/emplacementsStock.js";
import applicationsIntrantsRoutes from "./routes/applicationsIntrants.js";
import produitCategoriesRoutes from "./routes/produitCategories.js";
import produitRecettesRoutes from "./routes/produitRecettes.js";
import ordresTransformationRoutes from "./routes/ordresTransformation.js";
import haccpRoutes from "./routes/haccp.js";
import contactsRoutes from "./routes/contacts.js";
import listesPrixRoutes from "./routes/listesPrix.js";
import paymentTermsRoutes from "./routes/paymentTerms.js";
import taxesRoutes from "./routes/taxes.js";
import journalsRoutes from "./routes/journals.js";
import accountsRoutes from "./routes/accounts.js";
import unitesMesureCategoriesRoutes from "./routes/unitesMesureCategories.js";
import unitesMesureRoutes from "./routes/unitesMesure.js";
import attributsProduitRoutes from "./routes/attributsProduit.js";
import produitTemplatesRoutes from "./routes/produitTemplates.js";
import facturesRoutes from "./routes/factures.js";
import paiementsRoutes from "./routes/paiements.js";
import rechercheRoutes from "./routes/recherche.js";
import activitesRoutes from "./routes/activites.js";
import messagesRoutes from "./routes/messages.js";
import contactTagsRoutes from "./routes/contactTags.js";
import rhRoutes from "./routes/rh.js";
import billingRoutes from "./routes/billing.js";
import { verifierTokenSiPresent } from "./middleware/auth.js";
import { subscriptionGuard } from "./middleware/subscriptionGuard.js";
import { moduleGuard } from "./middleware/moduleGuard.js";
import { creerPermissionGuard } from "./middleware/permissionGuard.js";
import rolesRoutes from "./routes/roles.js";

const app = express();

// Ne révèle pas la technologie serveur (en-tête X-Powered-By: Express).
app.disable("x-powered-by");

// Proxy de confiance : seules les adresses de bouclage et des réseaux privés (le réseau Docker
// où vit Caddy) sont autorisées à fournir X-Forwarded-For. req.ip est alors la vraie IP du
// client, et un client ne peut plus usurper une IP en forgeant lui-même cet en-tête (ce qui
// contournait la limite d'inscriptions par IP). Surchargeable via TRUST_PROXY.
app.set("trust proxy", process.env.TRUST_PROXY || "loopback, linklocal, uniquelocal");

app.use(enTetesSecurite);

// CORS : en production le frontend et l'API partagent le même domaine (Caddy), seules les
// origines listées dans CORS_ORIGINS (ou FRONTEND_URL) sont acceptées. En développement, toute
// origine localhost/127.0.0.1 est acceptée (Vite 5173, nginx 8090, preview…). L'API
// n'utilise pas de cookies (jeton Bearer), donc pas de `credentials`.
//
// exposedHeaders : par défaut, le JavaScript d'une page ne peut lire QUE les en-têtes simples
// d'une réponse cross-origin — Content-Disposition reste invisible même quand le serveur
// l'envoie. Sans cette ligne, le PDF partagé par WhatsApp arrivait chez le client sous le nom
// « document.pdf » au lieu de « FAC-2026-0001.pdf ».
const ORIGINES_AUTORISEES = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "")
  .split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean);
const ORIGINE_LOCALE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
function origineAutorisee(origin, req) {
  // Pas d'en-tête Origin : outil en ligne de commande, caméra IP, GET même origine.
  if (!origin) return true;
  if (ORIGINES_AUTORISEES.includes(origin)) return true;
  if (!IS_PRODUCTION && ORIGINE_LOCALE.test(origin)) return true;
  // Même origine (cas de la production derrière Caddy, qui conserve l'en-tête Host) : un POST
  // envoie lui aussi un en-tête Origin, qu'il ne faut pas confondre avec un appel tiers.
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
app.use(cors((req, callback) => {
  const autorise = origineAutorisee(req.headers.origin, req);
  callback(autorise ? null : new Error("CORS_ORIGINE_REFUSEE"), {
    origin: autorise, exposedHeaders: ["Content-Disposition"],
  });
}));
// Limite relevée à 2mb : la photo de contact est envoyée en base64 dans le corps JSON.
app.use(express.json({ limit: "2mb" }));

// Limitation de débit des routes publiques (sans authentification), par IP : anti force brute
// sur la connexion / les codes, anti énumération des jetons de devis et de caméras. Les
// limites métier plus fines (échecs par email, inscriptions par IP) vivent dans les routes.
// Seulement les routes d'authentification publiques : /api/auth/me (appelé à chaque chargement
// de page) ne doit pas consommer ce quota, sinon des collègues derrière une même IP
// (box partagée, NAT d'opérateur mobile) se bloqueraient mutuellement.
app.use(
  ["/api/auth/login", "/api/auth/register", "/api/auth/confirmer-inscription", "/api/auth/renvoyer-code-inscription"],
  creerLimiteur({
    prefixe: "auth", fenetreMs: 15 * 60_000, max: 50,
    message: "Trop de tentatives depuis cette adresse. Réessayez dans quelques minutes.",
  })
);
app.use("/api/devis/public", creerLimiteur({ prefixe: "devis-public", fenetreMs: 60_000, max: 60 }));
app.use("/api/cameras/alertes", creerLimiteur({ prefixe: "cameras-alertes", fenetreMs: 60_000, max: 120 }));

// Abonnement Phase 1 (2026-09-04, Lot 2) : verifierTokenSiPresent pose req.user quand un
// token valide est présent SANS jamais rejeter (authRequired, posé route par route plus loin,
// s'occupe du 401 réel) ; subscriptionGuard lit alors req.user.entrepriseId pour bloquer (402)
// une entreprise dont l'essai/l'abonnement a expiré — voir docs/spec-abonnement-phase1.md §3.3
// pour la justification de ce montage global plutôt qu'un ajout à chaque route existante.
app.use(verifierTokenSiPresent);
app.use(asyncMiddleware(subscriptionGuard));
// Blocage d'accès par module payant (2026-09-07, suite du calcul de prix par module) — voir
// middleware/moduleGuard.js pour le détail du découpage (modules payants / fonctions
// transverses incluses / hors périmètre). Toujours après subscriptionGuard : une entreprise
// dont l'abonnement global est expiré est déjà bloquée avant d'arriver ici.
app.use(asyncMiddleware(moduleGuard));

// Permissions par ressource et action — ÉTAPE 2 : MODE OBSERVATION, ne refuse rien encore.
// Journalise ce qu'il refuserait (audit_log, action « permission_observee ») pour qu'on corrige
// la carte sur de vraies données avant de basculer en refus par défaut à l'étape 3.
app.use(asyncMiddleware(creerPermissionGuard(app)));

app.use("/api/auth", authRoutes);
app.use("/api/roles", rolesRoutes);
app.use("/api/business", businessRoutes);
app.use("/api/cultures", culturesRoutes);
app.use("/api/poulailler", poulaillerRoutes);
app.use("/api/pisciculture", piscicultureRoutes);
app.use("/api/meteo", meteoRoutes);
app.use("/api/precision", precisionAgricoleRoutes);
app.use("/api/devises", devisesRoutes);
app.use("/api/entreprise", entrepriseRoutes);
app.use("/api/salaries", salariesRoutes);
app.use("/api/banques", banquesRoutes);
app.use("/api/mfa", mfaRoutes);
app.use("/api/devis", devisRoutes);
app.use("/api/achats", achatsRoutes);
app.use("/api/observations", observationsRoutes);
// Surveillance : registre de caméras. Hors périmètre des modules payants — comme météo et
// observations, ce n’est pas une brique du système de tarification.
app.use("/api/cameras", camerasRoutes);
app.use("/api/planning", planningRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/recoltes", recoltesRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/equipements", equipementsRoutes);
app.use("/api/produits", produitsRoutes);
app.use("/api/emplacements-stock", emplacementsStockRoutes);
app.use("/api/applications-intrants", applicationsIntrantsRoutes);
app.use("/api/produit-categories", produitCategoriesRoutes);
app.use("/api/produit-recettes", produitRecettesRoutes);
app.use("/api/ordres-transformation", ordresTransformationRoutes);
app.use("/api/haccp", haccpRoutes);
app.use("/api/contacts", contactsRoutes);
app.use("/api/contact-tags", contactTagsRoutes);
app.use("/api/listes-prix", listesPrixRoutes);
app.use("/api/payment-terms", paymentTermsRoutes);
app.use("/api/taxes", taxesRoutes);
app.use("/api/journals", journalsRoutes);
app.use("/api/accounts", accountsRoutes);
app.use("/api/unites-mesure-categories", unitesMesureCategoriesRoutes);
app.use("/api/unites-mesure", unitesMesureRoutes);
app.use("/api/attributs-produit", attributsProduitRoutes);
app.use("/api/produit-templates", produitTemplatesRoutes);
app.use("/api/factures", facturesRoutes);
app.use("/api/paiements", paiementsRoutes);
app.use("/api/recherche", rechercheRoutes);
app.use("/api/activites", activitesRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/rh", rhRoutes);
app.use("/api/billing", billingRoutes);

// Route de bienvenue à la racine — vérification manuelle rapide ("le backend répond-il ?").
app.get("/", (req, res) => {
  res.json({ message: "Backend AgriApp opérationnel 🚜" });
});

// Toute autre URL : 404 JSON (au lieu de la page HTML par défaut d'Express), puis
// gestionnaire d'erreurs final qui ne divulgue jamais de détail interne.
app.use(route404);
app.use(gestionnaireErreurs);

export default app;
