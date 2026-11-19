// Lot 3b de l'audit (A3) : journal structuré et contexte de requête.
import express from 'express';
import request from 'supertest';
import { log, serialiserErreur } from '../utils/journal.js';
import { contexteRequete, retablirContexte, cheminJournalisable } from '../middleware/contexteRequete.js';
import { gestionnaireErreurs } from '../middleware/securite.js';

// Capture ce qui est écrit sur stdout/stderr, ligne par ligne.
let lignes;
let espions;
const envOrigine = { ...process.env };
beforeEach(() => {
  lignes = [];
  const capter = (flux) => jest.spyOn(flux, 'write').mockImplementation((texte) => { lignes.push({ flux, texte: String(texte) }); return true; });
  espions = [capter(process.stdout), capter(process.stderr)];
  process.env.LOG_LEVEL = 'debug';
  process.env.LOG_FORMAT = 'json';
});
afterEach(() => {
  espions.forEach((e) => e.mockRestore());
  process.env = { ...envOrigine };
});
const json = () => lignes.map((l) => JSON.parse(l.texte));

describe('log', () => {
  test('une ligne JSON par événement, erreurs et avertissements sur stderr', () => {
    log.info('bonjour', { cle: 1 });
    log.error('[GET /x]', new Error('boum'));
    const [info, erreur] = json();
    expect(info).toMatchObject({ niveau: 'info', message: 'bonjour', cle: 1 });
    expect(info.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(erreur).toMatchObject({ niveau: 'error', message: '[GET /x]', erreur: { nom: 'Error', message: 'boum' } });
    expect(erreur.erreur.pile).toMatch(/boum/);
    expect(lignes[0].flux).toBe(process.stdout);
    expect(lignes[1].flux).toBe(process.stderr);
  });

  test('même forme d’appel que console : les textes sont ajoutés au message', () => {
    log.warn('PostgreSQL injoignable :', 'ECONNREFUSED', 3);
    expect(json()[0].message).toBe('PostgreSQL injoignable : ECONNREFUSED 3');
  });

  test('seuil LOG_LEVEL respecté, silencieux par défaut en test', () => {
    process.env.LOG_LEVEL = 'warn';
    log.info('ignoré');
    log.warn('gardé');
    expect(json().map((l) => l.message)).toEqual(['gardé']);
    delete process.env.LOG_LEVEL;
    log.error('rien'); // NODE_ENV=test sous Jest
    expect(lignes).toHaveLength(1);
  });

  test('format texte lisible hors production', () => {
    process.env.LOG_FORMAT = 'texte';
    log.error('échec', new Error('détail'));
    expect(lignes[0].texte).toMatch(/^\S+ ERROR échec\n {2}Error: détail/);
  });
});

describe('serialiserErreur', () => {
  test('garde le diagnostic PostgreSQL, jamais le detail (il recopie des valeurs)', () => {
    const err = Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), {
      code: '23505', constraint: 'users_email_key', table: 'users', detail: 'Key (email)=(a@b.fr) already exists.',
    });
    const s = serialiserErreur(err);
    expect(s).toMatchObject({ code: '23505', contrainte: 'users_email_key', table: 'users' });
    expect(JSON.stringify(s)).not.toMatch(/a@b\.fr/);
  });
  test('valeur qui n’est pas une Error', () => {
    expect(serialiserErreur('texte')).toEqual({ message: 'texte' });
  });
});

describe('contexteRequete', () => {
  function appEssai() {
    const app = express();
    app.use(contexteRequete);
    app.use(express.json());
    app.use(retablirContexte);
    app.use((req, res, next) => { req.user = { sub: 7, entrepriseId: 3 }; next(); });
    // Le corps JSON a été lu (événements de flux) puis on attend : le contexte doit survivre.
    app.post('/api/ecrire', async (req, res) => {
      await new Promise((r) => setTimeout(r, 5));
      log.warn('dans la route', { recu: req.body.valeur });
      res.json({ ok: true });
    });
    app.get('/api/panne', async () => { throw new Error('relation "secrets" does not exist'); });
    app.get('/api/devis/public/:token', (req, res) => res.json({ ok: true }));
    app.get('/api/health', (req, res) => res.json({ statut: 'ok' }));
    app.use((err, req, res, next) => gestionnaireErreurs(err, req, res, next));
    return app;
  }

  test('identifiant renvoyé en en-tête et présent sur chaque ligne de la requête, après lecture du corps', async () => {
    const res = await request(appEssai()).post('/api/ecrire').send({ valeur: 42 });
    const id = res.headers['x-request-id'];
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    const [route, acces] = json();
    expect(route).toMatchObject({ message: 'dans la route', recu: 42, requete: id, utilisateur: 7, entreprise: 3 });
    expect(acces).toMatchObject({ type: 'acces', methode: 'POST', chemin: '/api/ecrire', statut: 200, requete: id, utilisateur: 7 });
  });

  test('identifiant entrant repris s’il est sûr, remplacé sinon', async () => {
    const app = appEssai();
    expect((await request(app).get('/api/health').set('X-Request-Id', 'caddy-1234abcd')).headers['x-request-id']).toBe('caddy-1234abcd');
    const forge = (await request(app).get('/api/health').set('X-Request-Id', 'faux <journal> injecté')).headers['x-request-id'];
    expect(forge).toMatch(/^[0-9a-f]{12}$/);
  });

  test('une erreur 500 renvoie la référence, sans détail interne, et la journalise avec elle', async () => {
    // Express 4 ne transmet pas une promesse rejetée : on passe par un middleware qui appelle next(err).
    const app = express();
    app.use(contexteRequete);
    app.get('/api/panne', (req, res, next) => next(new Error('relation "secrets" does not exist')));
    app.use(gestionnaireErreurs);
    const res = await request(app).get('/api/panne?jeton=abc');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erreur interne du serveur.', requestId: res.headers['x-request-id'] });
    const erreur = json().find((l) => l.niveau === 'error' && l.erreur);
    expect(erreur).toMatchObject({ message: 'Erreur non gérée sur GET /api/panne', requete: res.headers['x-request-id'] });
    expect(JSON.stringify(json())).not.toMatch(/jeton=abc/);
  });

  test('jetons masqués dans le journal d’accès, contrôle de santé en debug', async () => {
    const app = appEssai();
    await request(app).get('/api/devis/public/9f8e7d6c5b4a?x=1');
    await request(app).get('/api/health');
    const [devis, sante] = json();
    expect(devis.chemin).toBe('/api/devis/public/:jeton');
    expect(JSON.stringify(devis)).not.toMatch(/9f8e7d6c5b4a/);
    expect(sante.niveau).toBe('debug');
  });

  test('cheminJournalisable', () => {
    expect(cheminJournalisable({ originalUrl: '/api/cameras/alertes/abc123?token=x' })).toBe('/api/cameras/alertes/:jeton');
    expect(cheminJournalisable({ originalUrl: '/api/devis/12?q=1' })).toBe('/api/devis/12');
  });
});
