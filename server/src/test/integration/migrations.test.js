// Lot 3a de l'audit (A2) : moteur des migrations versionnées (server/src/db/migrations.js).
// Les cas d'essai tournent dans des dossiers temporaires, avec leur propre table de suivi et
// leurs propres tables, pour ne jamais toucher au schéma réel de la base de test.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pool } from './helpers.js';
import {
  appliquerMigrations, migrationsEnAttente, listerMigrations, empreinte, TABLE_MIGRATIONS, VERSION_SOCLE,
  DOSSIER_MIGRATIONS, FICHIER_SOCLE,
} from '../../db/migrations.js';

const TABLE = 'schema_migrations_essai';
const silence = () => {};
let client;
let racine;
let dossier;

const ecrire = (fichier, contenu) => fs.writeFileSync(path.join(dossier, fichier), contenu);
const lancer = (options = {}) => appliquerMigrations(client, { dossier, table: TABLE, journal: silence, ...options });
const tableExiste = async (nom) => (await client.query('SELECT to_regclass($1) AS t', [nom])).rows[0].t !== null;

beforeAll(async () => { client = await pool.connect(); });
afterAll(async () => { client.release(); await pool.end(); });

beforeEach(async () => {
  // Un package.json « module » au-dessus du dossier, comme server/package.json pour le vrai dossier :
  // sinon Node lirait les migrations .js d'essai comme du CommonJS.
  racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agri-migrations-'));
  fs.writeFileSync(path.join(racine, 'package.json'), '{"type":"module"}');
  dossier = path.join(racine, 'migrations');
  fs.mkdirSync(dossier);
  await client.query(`DROP TABLE IF EXISTS ${TABLE}, essai_a, essai_b, essai_c`);
});
afterEach(() => fs.rmSync(racine, { recursive: true, force: true }));

describe('Base de test migrée par migrate.js', () => {
  test('le socle et toutes les migrations du dépôt sont enregistrés, avec leur empreinte', async () => {
    const { rows } = await client.query(`SELECT version, nom, empreinte FROM ${TABLE_MIGRATIONS} ORDER BY version`);
    const attendues = [VERSION_SOCLE, ...listerMigrations(DOSSIER_MIGRATIONS).map((m) => m.version)];
    expect(rows.map((r) => r.version)).toEqual(attendues);
    expect(rows[0]).toMatchObject({ nom: 'socle', empreinte: empreinte(fs.readFileSync(FICHIER_SOCLE, 'utf8')) });
    expect(await migrationsEnAttente(client, { dossier: DOSSIER_MIGRATIONS })).toEqual([]);
  });

  test('le schéma réel est bien là (quelques tables du socle)', async () => {
    for (const t of ['entreprises', 'users', 'devis', 'account_move', 'jetons_compte']) {
      expect(await tableExiste(t)).toBe(true);
    }
  });
});

describe('Moteur de migrations', () => {
  test('applique dans l’ordre, une seule fois, et enregistre chaque version', async () => {
    ecrire('0002_table_b.sql', 'CREATE TABLE essai_b (id INT REFERENCES essai_a(id));');
    ecrire('0001_table_a.sql', 'CREATE TABLE essai_a (id INT PRIMARY KEY);');
    ecrire('0003_donnees.js', "export async function up(client) { await client.query('INSERT INTO essai_a VALUES (1), (2)'); }");
    ecrire('README.md', 'ignoré');

    const premier = await lancer();
    expect(premier.appliquees).toEqual(['0001', '0002', '0003']);
    expect((await client.query('SELECT count(*)::int AS n FROM essai_a')).rows[0].n).toBe(2);
    const { rows } = await client.query(`SELECT version, nom, duree_ms FROM ${TABLE} ORDER BY version`);
    expect(rows.map((r) => `${r.version} ${r.nom}`)).toEqual(['0001 table_a', '0002 table_b', '0003 donnees']);

    // Relancer ne rejoue rien (sinon CREATE TABLE et l'INSERT échoueraient ou doubleraient).
    const second = await lancer();
    expect(second).toMatchObject({ appliquees: [], dejaAppliquees: 3 });
    expect((await client.query('SELECT count(*)::int AS n FROM essai_a')).rows[0].n).toBe(2);

    // Une nouvelle migration ajoutée plus tard est la seule appliquée.
    ecrire('0004_table_c.sql', 'CREATE TABLE essai_c (id INT);');
    expect((await lancer()).appliquees).toEqual(['0004']);
    expect(await migrationsEnAttente(client, { dossier, socle: false, table: TABLE })).toEqual([]);
  });

  test('une migration en échec est annulée entièrement et bloque les suivantes', async () => {
    ecrire('0001_table_a.sql', 'CREATE TABLE essai_a (id INT PRIMARY KEY);');
    ecrire('0002_casse.sql', 'CREATE TABLE essai_b (id INT); SELECT * FROM table_qui_n_existe_pas;');
    ecrire('0003_table_c.sql', 'CREATE TABLE essai_c (id INT);');

    await expect(lancer()).rejects.toThrow(/Migration 0002 .*0002_casse\.sql.* annulée/);
    expect(await tableExiste('essai_a')).toBe(true); // 0001 était déjà validée
    expect(await tableExiste('essai_b')).toBe(false); // annulée avec le reste de 0002
    expect(await tableExiste('essai_c')).toBe(false); // jamais tentée
    expect(await migrationsEnAttente(client, { dossier, socle: false, table: TABLE })).toEqual(['0002', '0003']);

    // Une fois corrigée, la reprise part de là où ça s'était arrêté.
    ecrire('0002_casse.sql', 'CREATE TABLE essai_b (id INT);');
    expect((await lancer()).appliquees).toEqual(['0002', '0003']);
  });

  test('modifier une migration déjà appliquée fait échouer sans rien appliquer', async () => {
    ecrire('0001_table_a.sql', 'CREATE TABLE essai_a (id INT PRIMARY KEY);');
    await lancer();
    ecrire('0001_table_a.sql', 'CREATE TABLE essai_a (id BIGINT PRIMARY KEY);');
    ecrire('0002_table_b.sql', 'CREATE TABLE essai_b (id INT);');
    await expect(lancer()).rejects.toThrow(/0001 .*modifiée après avoir été appliquée/);
    expect(await tableExiste('essai_b')).toBe(false);
  });

  test('l’empreinte ignore les fins de ligne (CRLF Windows / LF Linux)', async () => {
    ecrire('0001_table_a.sql', 'CREATE TABLE essai_a (\n  id INT\n);\n');
    await lancer();
    ecrire('0001_table_a.sql', 'CREATE TABLE essai_a (\r\n  id INT\r\n);\r\n');
    expect((await lancer()).appliquees).toEqual([]);
  });

  test('le socle est appliqué une fois en version 0000, avant les migrations', async () => {
    const fichierSocle = `${dossier}-socle.js`; // hors du dossier des migrations
    try {
      fs.writeFileSync(fichierSocle, '// socle d’essai');
      const appels = [];
      const socle = { fichier: fichierSocle, appliquer: async (c) => { appels.push('socle'); await c.query('CREATE TABLE essai_a (id INT)'); } };
      ecrire('0001_table_b.sql', 'CREATE TABLE essai_b (id INT);');

      expect((await lancer({ socle })).appliquees).toEqual([VERSION_SOCLE, '0001']);
      expect((await lancer({ socle })).appliquees).toEqual([]);
      expect(appels).toEqual(['socle']);

      fs.writeFileSync(fichierSocle, '// socle d’essai, modifié');
      await expect(lancer({ socle })).rejects.toThrow(/0000 .*modifiée/);
    } finally {
      fs.rmSync(fichierSocle, { force: true });
    }
  });

  test('une version en base absente du code (retour en arrière) est signalée sans bloquer', async () => {
    ecrire('0001_table_a.sql', 'CREATE TABLE essai_a (id INT);');
    ecrire('0002_table_b.sql', 'CREATE TABLE essai_b (id INT);');
    await lancer();
    fs.rmSync(path.join(dossier, '0002_table_b.sql'));
    const messages = [];
    const res = await lancer({ journal: (m) => messages.push(m) });
    expect(res.inconnues).toEqual(['0002']);
    expect(messages.join('\n')).toMatch(/absentes du code : 0002/);
  });

  test('noms invalides, numéros en double et module .js sans up() sont refusés', async () => {
    ecrire('1_sans_zeros.sql', 'SELECT 1;');
    expect(() => listerMigrations(dossier)).toThrow(/mal nommée/);
    fs.rmSync(path.join(dossier, '1_sans_zeros.sql'));

    ecrire('0001_a.sql', 'SELECT 1;');
    ecrire('0001_b.sql', 'SELECT 1;');
    expect(() => listerMigrations(dossier)).toThrow(/numéro 0001/);
    fs.rmSync(path.join(dossier, '0001_b.sql'));

    ecrire('0000_pirate.sql', 'SELECT 1;');
    expect(() => listerMigrations(dossier)).toThrow(/réservée au socle/);
    fs.rmSync(path.join(dossier, '0000_pirate.sql'));

    ecrire('0002_sans_up.js', 'export const rien = 1;');
    await expect(lancer()).rejects.toThrow(/doit exporter une fonction up/);
  });

  test('le dossier des migrations du dépôt est bien formé', () => {
    expect(() => listerMigrations(DOSSIER_MIGRATIONS)).not.toThrow();
  });
});
