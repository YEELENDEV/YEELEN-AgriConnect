/**
 * Migrations — YEELEN AgriConnect
 *
 * Amène la base au schéma attendu par le code : le socle (./socle.js, version 0000) puis chaque
 * fichier de ./migrations/ pas encore appliqué, dans l'ordre. Ce qui a déjà été appliqué n'est
 * pas rejoué (suivi dans la table `schema_migrations`). Moteur : ./migrations.js.
 *
 * Lancer depuis le dossier server/ :
 *   node src/db/migrate.js            applique ce qui manque
 *   node src/db/migrate.js --statut   affiche ce qui reste à appliquer, sans rien modifier
 *
 * Code de sortie 1 en cas d'échec (une migration en échec est annulée, les suivantes ne
 * s'appliquent pas).
 */

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { appliquerMigrations, migrationsEnAttente, DOSSIER_MIGRATIONS, FICHIER_SOCLE } from './migrations.js';

// Ce script tourne en dehors du serveur Express : chemin explicite vers server/.env, résolu
// depuis l'emplacement de ce fichier (pas depuis le répertoire d'exécution). Les variables
// déjà présentes dans l'environnement (conteneur, tests) restent prioritaires.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  const client = new pg.Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  try {
    await client.connect();
    if (process.argv.includes('--statut')) {
      const attente = await migrationsEnAttente(client, { dossier: DOSSIER_MIGRATIONS });
      console.log(attente.length ? `Migrations en attente : ${attente.join(', ')}` : '✅ Base à jour, aucune migration en attente.');
      return;
    }
    const { appliquerSocle } = await import('./socle.js');
    const { appliquees, dejaAppliquees } = await appliquerMigrations(client, {
      dossier: DOSSIER_MIGRATIONS,
      socle: { fichier: FICHIER_SOCLE, appliquer: appliquerSocle },
    });
    console.log(appliquees.length
      ? `✅ ${appliquees.length} migration(s) appliquée(s), ${dejaAppliquees} déjà en place.`
      : `✅ Base à jour (${dejaAppliquees} migration(s) déjà en place).`);
  } catch (err) {
    console.error('❌ Erreur de migration :', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

await main();
