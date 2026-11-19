// Jest globalSetup — une seule fois avant toute la suite d'intégration :
//   1. (re)crée la base `agri_app_test` sur le conteneur Docker `db`
//   2. y applique toutes les migrations depuis zéro (server/src/db/migrate.js : socle 0000 + migrations/)
// Prérequis : la stack Docker doit tourner (`docker compose up -d db`). Si la base
// n'est pas joignable, on échoue tôt avec un message explicite plutôt qu'un timeout obscur.
import pg from 'pg';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import cfg from './testDb.cjs';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '../../..');

export default async function globalSetup() {
  const admin = new Client({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.adminDatabase,
  });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      `Impossible de joindre PostgreSQL sur ${cfg.host}:${cfg.port} — la stack Docker est-elle lancée ` +
      `(\`docker compose up -d db\`) ? Erreur : ${err.message}`
    );
  }

  await admin.query(`DROP DATABASE IF EXISTS ${cfg.database} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${cfg.database}`);
  await admin.end();

  // migrate.js (socle + migrations versionnées) lit DB_* dans l’environnement ; on lui passe la base de test.
  execSync('node src/db/migrate.js', {
    cwd: serverRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      DB_HOST: cfg.host,
      DB_PORT: String(cfg.port),
      DB_NAME: cfg.database,
      DB_USER: cfg.user,
      DB_PASSWORD: cfg.password,
    },
  });

  console.log(`\n[integration] base ${cfg.database} créée et migrée sur ${cfg.host}:${cfg.port}\n`);
}
