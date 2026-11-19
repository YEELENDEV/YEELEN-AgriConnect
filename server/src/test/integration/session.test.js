// Lot 2b de l'audit (S4) : session du navigateur dans un cookie HttpOnly, renouvellement
// glissant borné à SESSION_MAX_JOURS, protection CSRF par en-tête, Bearer toujours accepté.
import jwt from 'jsonwebtoken';
import { app, pool, request, registerEntreprise } from './helpers.js';
import { env } from '../../config/env.js';
import { viderCacheRoles } from '../../utils/rolesService.js';

afterAll(async () => { await pool.end(); });

const NAVIGATEUR = { 'X-Requested-With': 'AgriConnect' };
const cookieDe = (res) => (res.headers['set-cookie'] || []).find((c) => c.startsWith('agri_session='));
const valeurCookie = (c) => c.split(';')[0];
const jetonDuCookie = (c) => decodeURIComponent(valeurCookie(c).slice('agri_session='.length));
const efface = (c) => /Expires=Thu, 01 Jan 1970/.test(c);
const maintenantS = () => Math.floor(Date.now() / 1000);

// Jeton forgé avec le vrai secret, pour simuler un jeton ancien (iat) ou une connexion ancienne (at).
const forger = ({ iat: _i, exp: _e, ...payload }, { iat, expiresIn = '2h' }) =>
  jwt.sign({ ...payload, iat }, env.JWT_SECRET, { algorithm: 'HS256', expiresIn });

async function connexionNavigateur(admin) {
  const res = await request(app).post('/api/auth/login').set(NAVIGATEUR).send({ email: admin.email, password: admin.password });
  expect(res.status).toBe(200);
  return res;
}

describe('Cookie de session (S4)', () => {
  beforeEach(() => viderCacheRoles());

  test('connexion depuis le navigateur : cookie HttpOnly/SameSite=Strict, aucun jeton dans le corps', async () => {
    const admin = await registerEntreprise();
    const res = await connexionNavigateur(admin);
    expect(res.body.token).toBeUndefined();
    expect(res.body.user.email).toBe(admin.email);
    const c = cookieDe(res);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Strict/);
    expect(c).toMatch(/Path=\/api/);
    expect(c).not.toMatch(/Secure/); // seulement en production

    const me = await request(app).get('/api/auth/me').set('Cookie', valeurCookie(c));
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(admin.email);
  });

  test('client d’API (sans l’en-tête) : le jeton reste dans le corps et le Bearer fonctionne', async () => {
    const admin = await registerEntreprise();
    const res = await request(app).post('/api/auth/login').send({ email: admin.email, password: admin.password });
    expect(res.body.token).toBeTruthy();
    // Écriture en Bearer, sans en-tête CSRF : acceptée (un site tiers ne peut pas poser Authorization).
    const ecriture = await request(app).post('/api/contacts').set('Authorization', `Bearer ${res.body.token}`).send({ nom: 'API', estClient: true });
    expect(ecriture.status).toBe(201);
  });

  test('CSRF : une écriture portée par le cookie sans l’en-tête est refusée', async () => {
    const admin = await registerEntreprise();
    const cookie = valeurCookie(cookieDe(await connexionNavigateur(admin)));
    const sans = await request(app).post('/api/contacts').set('Cookie', cookie).send({ nom: 'CSRF', estClient: true });
    expect(sans.status).toBe(403);
    expect(sans.body.reason).toBe('csrf');
    const avec = await request(app).post('/api/contacts').set('Cookie', cookie).set(NAVIGATEUR).send({ nom: 'OK', estClient: true });
    expect(avec.status).toBe(201);
    // Une lecture n'a pas besoin de l'en-tête.
    expect((await request(app).get('/api/contacts').set('Cookie', cookie)).status).toBe(200);
  });

  test('déconnexion : le cookie est effacé', async () => {
    const admin = await registerEntreprise();
    const cookie = valeurCookie(cookieDe(await connexionNavigateur(admin)));
    const res = await request(app).post('/api/auth/deconnexion').set('Cookie', cookie).set(NAVIGATEUR);
    expect(res.status).toBe(200);
    expect(efface(cookieDe(res))).toBe(true);
  });

  test('renouvellement glissant : un jeton de plus de 15 min est remplacé, l’heure de connexion conservée', async () => {
    const admin = await registerEntreprise();
    const payload = jwt.decode(admin.token);
    const at = maintenantS() - 3 * 3600;
    const ancien = forger({ ...payload, at }, { iat: maintenantS() - 20 * 60 });
    const res = await request(app).get('/api/auth/me').set('Cookie', `agri_session=${ancien}`);
    expect(res.status).toBe(200);
    const nouveau = jwt.decode(jetonDuCookie(cookieDe(res)));
    expect(nouveau.at).toBe(at);
    expect(nouveau.iat).toBeGreaterThan(maintenantS() - 60);

    // Un jeton récent n'est pas renouvelé à chaque requête.
    const recent = forger({ ...payload, at }, { iat: maintenantS() - 60 });
    expect(cookieDe(await request(app).get('/api/auth/me').set('Cookie', `agri_session=${recent}`))).toBeUndefined();
  });

  test('durée absolue : une session ouverte il y a plus de 7 jours est refusée et son cookie effacé', async () => {
    const admin = await registerEntreprise();
    const payload = jwt.decode(admin.token);
    const vieux = forger({ ...payload, at: maintenantS() - 8 * 24 * 3600 }, { iat: maintenantS() - 60 });
    const res = await request(app).get('/api/auth/me').set('Cookie', `agri_session=${vieux}`);
    expect(res.status).toBe(401);
    expect(efface(cookieDe(res))).toBe(true);
    // Même règle en Bearer.
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${vieux}`)).status).toBe(401);
  });

  test('session révoquée : le cookie d’un autre appareil est refusé puis effacé', async () => {
    const admin = await registerEntreprise();
    const autreAppareil = valeurCookie(cookieDe(await connexionNavigateur(admin)));
    const ici = valeurCookie(cookieDe(await connexionNavigateur(admin)));
    const revoque = await request(app).post('/api/auth/deconnecter-autres-appareils').set('Cookie', ici).set(NAVIGATEUR);
    expect(revoque.status).toBe(200);
    expect(revoque.body.token).toBeUndefined();
    const nouveauIci = valeurCookie(cookieDe(revoque));

    viderCacheRoles();
    const refus = await request(app).get('/api/auth/me').set('Cookie', autreAppareil);
    expect(refus.status).toBe(401);
    expect(refus.body.reason).toBe('session_revoquee');
    expect(efface(cookieDe(refus))).toBe(true);
    expect((await request(app).get('/api/auth/me').set('Cookie', nouveauIci)).status).toBe(200);
  });

  test('CORS : les cookies sont autorisés pour une origine admise, pas pour une origine inconnue', async () => {
    const ok = await request(app).options('/api/auth/me').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const tiers = await request(app).options('/api/auth/me').set('Origin', 'https://site-tiers.example').set('Access-Control-Request-Method', 'GET');
    expect(tiers.headers['access-control-allow-origin']).toBeUndefined();
  });
});
