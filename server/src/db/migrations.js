// Moteur des migrations versionnées (lot 3a de l'audit, A2).
//
// Avant : un seul script cumulatif (aujourd'hui ./socle.js) relancé en entier à chaque
// déploiement, sans trace de ce qui avait été appliqué — un écart entre une base et le script
// passait inaperçu jusqu'à casser une installation neuve.
//
// Maintenant :
//   - le socle est la version « 0000 », appliquée une fois par base ;
//   - chaque changement suivant est un fichier ./migrations/NNNN_nom.sql ou NNNN_nom.js
//     (export async function up(client)), appliqué une seule fois, dans une transaction ;
//   - la table `schema_migrations` garde la version, le nom, l'empreinte SHA-256 du fichier,
//     la date et la durée. Modifier un fichier déjà appliqué fait échouer la commande : on
//     ajoute une nouvelle migration, on ne réécrit pas l'histoire.
//   - un verrou consultatif PostgreSQL empêche deux exécutions simultanées (deux conteneurs
//     qui démarrent ensemble, ou un déploiement lancé deux fois).
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
export const DOSSIER_MIGRATIONS = path.join(ICI, 'migrations');
export const FICHIER_SOCLE = path.join(ICI, 'socle.js');
export const TABLE_MIGRATIONS = 'schema_migrations';
export const VERSION_SOCLE = '0000';
// Clé arbitraire mais fixe du verrou consultatif (pg_advisory_lock prend un bigint).
const CLE_VERROU = 7_319_004_211;
const NOM_FICHIER = /^(\d{4})_([a-z0-9][a-z0-9_]*)\.(sql|js)$/;
const NOM_TABLE = /^[a-z_][a-z0-9_]*$/;

// Empreinte indépendante des fins de ligne : un même fichier extrait sous Windows (CRLF) et
// sous Linux (LF) doit donner la même valeur, sinon la production refuserait de migrer.
export function empreinte(texte) {
  return crypto.createHash('sha256').update(texte.replace(/\r\n/g, '\n')).digest('hex');
}

// Liste les migrations du dossier, triées. Un nom mal formé ou un numéro en double est une
// erreur (pas un fichier ignoré en silence) : sinon une migration pourrait ne jamais s'appliquer.
export function listerMigrations(dossier) {
  if (!fs.existsSync(dossier)) return [];
  const migrations = [];
  const vus = new Map();
  for (const fichier of fs.readdirSync(dossier).sort()) {
    if (fichier === 'README.md') continue;
    const m = NOM_FICHIER.exec(fichier);
    if (!m) {
      throw new Error(`Migration mal nommée : « ${fichier} » (attendu : 0001_nom_en_minuscules.sql ou .js).`);
    }
    const [, version, nom, type] = m;
    if (version === VERSION_SOCLE) throw new Error(`« ${fichier} » : la version 0000 est réservée au socle.`);
    if (vus.has(version)) throw new Error(`Deux migrations portent le numéro ${version} : « ${vus.get(version)} » et « ${fichier} ».`);
    vus.set(version, fichier);
    const chemin = path.join(dossier, fichier);
    migrations.push({ version, nom, type, fichier, chemin, empreinte: empreinte(fs.readFileSync(chemin, 'utf8')) });
  }
  return migrations;
}

async function executer(client, migration) {
  if (migration.type === 'sql') {
    await client.query(fs.readFileSync(migration.chemin, 'utf8'));
    return;
  }
  const module = await import(pathToFileURL(migration.chemin).href);
  if (typeof module.up !== 'function') throw new Error(`« ${migration.fichier} » doit exporter une fonction up(client).`);
  await module.up(client);
}

// Applique ce qui manque. `socle` = { fichier, appliquer(client) } (optionnel, pour les tests).
// Renvoie { appliquees: [versions], dejaAppliquees: n, inconnues: [versions] }.
export async function appliquerMigrations(client, { dossier, socle, table = TABLE_MIGRATIONS, journal = console.log } = {}) {
  if (!NOM_TABLE.test(table)) throw new Error(`Nom de table de suivi invalide : ${table}`);
  const migrations = listerMigrations(dossier);
  const prevues = socle
    ? [{ version: VERSION_SOCLE, nom: 'socle', type: 'socle', fichier: path.basename(socle.fichier), empreinte: empreinte(fs.readFileSync(socle.fichier, 'utf8')), socle }, ...migrations]
    : migrations;

  await client.query('SELECT pg_advisory_lock($1)', [CLE_VERROU]);
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS ${table} (
      version       TEXT PRIMARY KEY,
      nom           TEXT NOT NULL,
      empreinte     TEXT NOT NULL,
      appliquee_le  TIMESTAMPTZ NOT NULL DEFAULT now(),
      duree_ms      INTEGER NOT NULL
    )`);
    const { rows } = await client.query(`SELECT version, nom, empreinte FROM ${table}`);
    const faites = new Map(rows.map((r) => [r.version, r]));

    // Vérification d'abord, avant d'appliquer quoi que ce soit : un fichier déjà appliqué puis
    // modifié veut dire que cette base et le code ne sont plus d'accord sur l'histoire.
    for (const m of prevues) {
      const faite = faites.get(m.version);
      if (faite && faite.empreinte !== m.empreinte) {
        throw new Error(
          `La migration ${m.version} (« ${m.fichier} ») a été modifiée après avoir été appliquée sur cette base. ` +
          'Restaurez le fichier d’origine et ajoutez une nouvelle migration pour le changement.'
        );
      }
    }
    const connues = new Set(prevues.map((m) => m.version));
    const inconnues = [...faites.keys()].filter((v) => !connues.has(v)).sort();
    if (inconnues.length) {
      // Cas normal d'un retour en arrière du code : la base est en avance. On prévient sans bloquer.
      journal(`⚠️  Migrations présentes en base mais absentes du code : ${inconnues.join(', ')} (code plus ancien que la base ?).`);
    }

    const appliquees = [];
    for (const m of prevues) {
      if (faites.has(m.version)) continue;
      const debut = Date.now();
      journal(`→ ${m.version} ${m.nom}…`);
      if (m.socle) {
        // Le socle gère lui-même ses transactions (certains rattrapages font BEGIN/COMMIT) ;
        // il est idempotent, donc rejouable s'il échoue à mi-chemin.
        await m.socle.appliquer(client);
        await client.query(`INSERT INTO ${table} (version, nom, empreinte, duree_ms) VALUES ($1, $2, $3, $4)`,
          [m.version, m.nom, m.empreinte, Date.now() - debut]);
      } else {
        await client.query('BEGIN');
        try {
          await executer(client, m);
          await client.query(`INSERT INTO ${table} (version, nom, empreinte, duree_ms) VALUES ($1, $2, $3, $4)`,
            [m.version, m.nom, m.empreinte, Date.now() - debut]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          err.message = `Migration ${m.version} (« ${m.fichier} ») annulée : ${err.message}`;
          throw err;
        }
      }
      journal(`✅ ${m.version} ${m.nom} (${Date.now() - debut} ms)`);
      appliquees.push(m.version);
    }
    return { appliquees, dejaAppliquees: prevues.length - appliquees.length, inconnues };
  } finally {
    // Ne doit pas masquer l'erreur d'origine (ex. transaction du socle restée en échec) : le
    // verrou est de toute façon libéré à la fermeture de la connexion.
    await client.query('SELECT pg_advisory_unlock($1)', [CLE_VERROU]).catch(() => {});
  }
}

// Versions prévues par le code mais pas encore appliquées sur cette base (sans rien modifier).
// Sert au démarrage du serveur et à `migrate.js --statut`. Base jamais migrée → tout est en attente.
export async function migrationsEnAttente(executant, { dossier = DOSSIER_MIGRATIONS, socle = true, table = TABLE_MIGRATIONS } = {}) {
  const versions = [...(socle ? [VERSION_SOCLE] : []), ...listerMigrations(dossier).map((m) => m.version)];
  const { rows: [existe] } = await executant.query('SELECT to_regclass($1) AS t', [table]);
  if (!existe.t) return versions;
  const { rows } = await executant.query(`SELECT version FROM ${table}`);
  const faites = new Set(rows.map((r) => r.version));
  return versions.filter((v) => !faites.has(v));
}
