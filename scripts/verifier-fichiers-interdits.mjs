#!/usr/bin/env node
// Garde-fou avant commit : refuse les fichiers qui n'ont rien à faire dans le dépôt, même
// quand le .gitignore a été contourné (`git add -f`) ou n'existe pas encore pour ce cas.
// Lancé par Lefthook (lefthook.yml) avec la liste des fichiers ajoutés au commit.
//
// Pourquoi ce filet en plus de .gitignore et de la détection de secrets : un `server/.env`
// complet (mot de passe de la base, secret JWT) a déjà été commité puis poussé sur ce dépôt
// public en juillet 2026. La détection de secrets reconnaît des formats de jetons connus ;
// elle ne reconnaît pas un mot de passe choisi à la main dans un fichier .env.
import fs from 'node:fs';

const INTERDITS = [
  { motif: /(^|\/)\.env(\.[^/]*)?$/, raison: 'fichier de variables d’environnement (secrets)', sauf: /\.env\.example$/ },
  // `server/Dockerfile.backup` (image du service de sauvegarde) n'est pas une sauvegarde : exclu.
  { motif: /\.dump$|\.sql\.gz$|\.backup$/, raison: 'sauvegarde de base de données (données réelles)', sauf: /(^|\/)Dockerfile\.backup$/ },
  { motif: /(^|\/)backups\//, raison: 'dossier de sauvegardes' },
  { motif: /\.(pem|key|p12|pfx|jks|keystore)$/, raison: 'clé privée ou certificat' },
  { motif: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, raison: 'clé SSH privée' },
  { motif: /(^|\/)(\.npmrc|\.pgpass|credentials(\.json)?)$/, raison: 'fichier d’identifiants' },
  { motif: /\.age$|(^|\/)keys\.txt$/, raison: 'clé de chiffrement age (seuls les fichiers chiffrés par SOPS se commitent)' },
  { motif: /\.bak$/, raison: 'copie de sauvegarde locale' },
];
const TAILLE_MAX = 5 * 1024 * 1024; // au-delà : binaire ou dump probable, à stocker hors dépôt

const fichiers = process.argv.slice(2).map((f) => f.replace(/\\/g, '/'));
const refus = [];
for (const f of fichiers) {
  for (const { motif, raison, sauf } of INTERDITS) {
    if (motif.test(f) && !(sauf && sauf.test(f))) refus.push(`  ${f} — ${raison}`);
  }
  try {
    const { size } = fs.statSync(f);
    if (size > TAILLE_MAX) refus.push(`  ${f} — fichier de ${(size / 1024 / 1024).toFixed(1)} Mo (limite 5 Mo)`);
  } catch {
    // Fichier supprimé dans ce commit : rien à vérifier.
  }
}

if (refus.length) {
  console.error('\n✖ Fichier(s) interdit(s) dans le dépôt.\n');
  console.error(refus.join('\n'));
  console.error('\nRetirez-le(s) du commit :  git restore --staged <fichier>');
  console.error('Les secrets partagés se versionnent chiffrés avec SOPS (voir docs/securite-depot.md).\n');
  process.exit(1);
}
