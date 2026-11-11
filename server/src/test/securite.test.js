import { creerLimiteur, gestionnaireErreurs } from '../middleware/securite.js';
import { validerMotDePasse, validerEmail } from '../utils/motDePasse.js';

function reponseFactice() {
  const res = { statusCode: 200, headers: {}, body: null, headersSent: false };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

describe('creerLimiteur', () => {
  test('laisse passer jusqu\'à max puis répond 429 avec Retry-After, par IP', () => {
    const limiteur = creerLimiteur({ fenetreMs: 60_000, max: 2, actifEnTest: true });
    const next = jest.fn();
    for (let i = 0; i < 2; i++) limiteur({ ip: '1.1.1.1' }, reponseFactice(), next);
    expect(next).toHaveBeenCalledTimes(2);

    const res = reponseFactice();
    limiteur({ ip: '1.1.1.1' }, res, next);
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBeDefined();
    expect(next).toHaveBeenCalledTimes(2);

    // Une autre IP a son propre compteur.
    limiteur({ ip: '2.2.2.2' }, reponseFactice(), next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  test('inactif sous Jest par défaut (la suite d\'intégration enchaîne les connexions)', () => {
    const limiteur = creerLimiteur({ fenetreMs: 60_000, max: 0 });
    const next = jest.fn();
    limiteur({ ip: '1.1.1.1' }, reponseFactice(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('gestionnaireErreurs', () => {
  const req = { method: 'GET', originalUrl: '/api/x' };
  test('JSON invalide → 400, corps trop gros → 413', () => {
    const r1 = reponseFactice();
    gestionnaireErreurs({ type: 'entity.parse.failed' }, req, r1, jest.fn());
    expect(r1.statusCode).toBe(400);
    const r2 = reponseFactice();
    gestionnaireErreurs({ type: 'entity.too.large' }, req, r2, jest.fn());
    expect(r2.statusCode).toBe(413);
  });
  test('erreur inattendue → 500 sans détail interne', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = reponseFactice();
    gestionnaireErreurs(new Error('relation "users" does not exist'), req, res, jest.fn());
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/users/);
    spy.mockRestore();
  });
});

describe('validerMotDePasse / validerEmail', () => {
  test('refuse les mots de passe courts, sans chiffre ou sans lettre', () => {
    expect(validerMotDePasse('x')).toBeTruthy();
    expect(validerMotDePasse('abcdefgh')).toBeTruthy();
    expect(validerMotDePasse('12345678')).toBeTruthy();
    expect(validerMotDePasse('a'.repeat(80) + '1')).toBeTruthy(); // > 72 octets (limite bcrypt)
    expect(validerMotDePasse({})).toBeTruthy();
  });
  test('accepte un mot de passe correct', () => {
    expect(validerMotDePasse('Passw0rd!')).toBeNull();
    expect(validerMotDePasse('récolte2026')).toBeNull();
  });
  test('email', () => {
    expect(validerEmail('a@b.co')).toBeNull();
    expect(validerEmail('pas-un-email')).toBeTruthy();
    expect(validerEmail({ $ne: '' })).toBeTruthy();
  });
});
