// Journal du serveur (lot 3b de l'audit, A3) — remplace les console.error/log dispersés.
//
// Avant : 344 console.error recopiés dans les routes, sans niveau ni moyen de relier une ligne
// à la requête qui l'a produite. Inexploitable en production (« quelle erreur a eu ce client ? »).
//
// Maintenant :
//   - quatre niveaux (debug, info, warn, error), seuil réglable par LOG_LEVEL ;
//   - en production, une ligne JSON par événement (lisible par `docker compose logs`, filtrable
//     avec jq, prête pour un outil d'agrégation) ; en développement, une ligne lisible ;
//   - chaque ligne écrite pendant une requête porte automatiquement son identifiant (`requete`),
//     l'utilisateur et l'entreprise, via AsyncLocalStorage (voir middleware/contexteRequete.js) :
//     aucune route n'a à les passer à la main ;
//   - une Error est sérialisée sans les champs qui recopient des données (le `detail` de
//     PostgreSQL contient les valeurs en conflit : emails, noms…).
//
// Volontairement sans dépendance : ce module ne lit que process.env (pas config/env.js, qui
// journalise lui-même au chargement).
import { AsyncLocalStorage } from 'node:async_hooks';

const NIVEAUX = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const stockage = new AsyncLocalStorage();

// Lus à chaque écriture (coût négligeable) pour que les tests puissent changer l'environnement.
function seuil() {
  const demande = (process.env.LOG_LEVEL || '').toLowerCase();
  if (demande in NIVEAUX) return NIVEAUX[demande];
  // Tests : silencieux par défaut (les erreurs provoquées exprès noieraient la sortie de Jest).
  // LOG_LEVEL=debug npm run test:integration pour tout voir.
  return process.env.NODE_ENV === 'test' ? NIVEAUX.silent : NIVEAUX.info;
}
function formatJson() {
  const f = (process.env.LOG_FORMAT || '').toLowerCase();
  if (f === 'json') return true;
  if (f === 'texte' || f === 'text') return false;
  return process.env.NODE_ENV === 'production';
}

// Champs d'une erreur PostgreSQL ou Node utiles au diagnostic, sans valeurs métier.
export function serialiserErreur(err) {
  if (!(err instanceof Error)) return { message: String(err) };
  const sortie = { nom: err.name, message: err.message };
  if (err.code) sortie.code = err.code;
  if (err.constraint) sortie.contrainte = err.constraint;
  if (err.table) sortie.table = err.table;
  if (err.column) sortie.colonne = err.column;
  if (err.stack) sortie.pile = err.stack;
  return sortie;
}

// Exécute fn avec un contexte (identifiant de requête, objet req) visible par toutes les
// écritures du journal faites pendant fn, y compris après des await.
export function avecContexte(contexte, fn) {
  return stockage.run(contexte, fn);
}
export function contexteCourant() {
  return stockage.getStore();
}

function champsDuContexte() {
  const ctx = stockage.getStore();
  if (!ctx) return {};
  const champs = { requete: ctx.requestId };
  // req.user est posé APRÈS l'ouverture du contexte (verifierTokenSiPresent) : lu au moment
  // d'écrire, pas au moment de créer le contexte.
  const user = ctx.req?.user;
  if (user?.sub) champs.utilisateur = user.sub;
  if (user?.entrepriseId) champs.entreprise = user.entrepriseId;
  return champs;
}

// log.error('[GET /devis]', err) — même forme d'appel que console.error, pour que la
// bascule soit mécanique. Arguments après le message : une Error → champ `erreur` ; un objet
// simple → ses champs ; tout le reste (texte, nombre) → ajouté au message.
function ecrire(niveau, message, extras) {
  if (NIVEAUX[niveau] < seuil()) return;
  let texte = String(message);
  let erreur;
  const champs = {};
  for (const x of extras) {
    if (x instanceof Error) erreur = serialiserErreur(x);
    else if (x && typeof x === 'object' && !Array.isArray(x)) Object.assign(champs, x);
    else if (x !== undefined) texte += ` ${typeof x === 'string' ? x : JSON.stringify(x)}`;
  }
  const ligne = {
    date: new Date().toISOString(),
    niveau,
    message: texte,
    ...champsDuContexte(),
    ...champs,
    ...(erreur ? { erreur } : {}),
  };
  const flux = NIVEAUX[niveau] >= NIVEAUX.warn ? process.stderr : process.stdout;
  flux.write((formatJson() ? JSON.stringify(ligne) : enTexte(ligne)) + '\n');
}

function enTexte({ date, niveau, message, requete, erreur, ...reste }) {
  let s = `${date} ${niveau.toUpperCase().padEnd(5)}${requete ? ` [${requete}]` : ''} ${message}`;
  // Ligne d'accès : méthode, chemin, statut et durée sont déjà dans le message (le JSON, lui,
  // garde les champs séparés pour le filtrage).
  const autres = Object.entries(reste).filter(([k]) => reste.type !== 'acces' || ['utilisateur', 'entreprise'].includes(k));
  if (autres.length) s += ' ' + autres.map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ');
  if (erreur) s += '\n' + (erreur.pile || `${erreur.nom || 'Erreur'}: ${erreur.message}`).replace(/^/gm, '  ');
  return s;
}

export const log = {
  debug: (message, ...extras) => ecrire('debug', message, extras),
  info: (message, ...extras) => ecrire('info', message, extras),
  warn: (message, ...extras) => ecrire('warn', message, extras),
  error: (message, ...extras) => ecrire('error', message, extras),
};
