// Point d'entrée UNIQUE des variables d'environnement du backend. Importé en tout premier par
// db.js et par tout module qui lit une variable sensible (JWT_SECRET, etc.).
//
// Ordre de chargement (dotenv n'écrase jamais une variable déjà posée) :
//   1. variables déjà présentes dans le process (docker compose `env_file`, CI) — prioritaires ;
//   2. server/.env — la configuration du backend (DB_*, JWT_SECRET, EMAIL_*…) ;
//   3. .env à la racine du dépôt — repli historique (variables partagées avec docker compose).
//
// Avant 2026-11, ce fichier ne lisait QUE le .env racine, et il était évalué avant db.js (qui
// chargeait server/.env) : hors Docker, JWT_SECRET n'était donc jamais trouvé et le backend
// signait silencieusement ses tokens avec une valeur par défaut publique — n'importe qui
// pouvait forger un token admin. D'où le chargement explicite et la vérification ci-dessous.
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Délai maximal d'un appel HTTP sortant (Open-Meteo, SoilGrids, Agromonitoring, taux de
// change, reCAPTCHA). Sans lui, une API tierce qui ne répond plus immobilisait la requête
// de l'utilisateur indéfiniment.
export const DELAI_API_EXTERNE_MS = 10_000;

const LONGUEUR_MIN_SECRET = 32;
const SECRETS_CONNUS = new Set(['dev-secret-change-me', 'change-me', 'secret', 'changeme']);

function resoudreJwtSecret() {
  const secret = process.env.JWT_SECRET;
  const faible = !secret || secret.length < LONGUEUR_MIN_SECRET || SECRETS_CONNUS.has(secret);
  if (!faible) return secret;

  if (IS_PRODUCTION) {
    // Refus de démarrer : un secret faible ou absent en production revient à laisser
    // n'importe qui forger un token. Générer p. ex. avec : openssl rand -base64 48
    throw new Error(
      `JWT_SECRET absent ou trop faible (minimum ${LONGUEUR_MIN_SECRET} caractères aléatoires) — démarrage refusé en production.`
    );
  }
  if (secret) {
    if (process.env.NODE_ENV !== 'test') console.warn(`[env] JWT_SECRET fait moins de ${LONGUEUR_MIN_SECRET} caractères : acceptable en développement uniquement.`);
    return secret;
  }
  // Développement sans aucun secret configuré : secret aléatoire propre à ce process (les
  // tokens deviennent invalides au redémarrage) plutôt qu'une valeur par défaut publique.
  console.warn('[env] JWT_SECRET absent : secret aléatoire temporaire généré (développement uniquement).');
  return crypto.randomBytes(48).toString('base64');
}

export const env = {
  PORT: Number(process.env.PORT || 4000),
  JWT_SECRET: resoudreJwtSecret(),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  APP_NAME: process.env.APP_NAME || 'YEELEN AgriConnect',
};
