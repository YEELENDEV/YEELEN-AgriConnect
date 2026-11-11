import { generate as generateOtp } from 'otplib';
import { app, pool, request, registerEntreprise } from './helpers.js';
import { generateEmailCode } from '../../utils/mfaCode.js';

afterAll(async () => { await pool.end(); });

const bearer = (t) => ({ Authorization: `Bearer ${t}` });

describe('MFA — TOTP', () => {
  test('setup → verify → login en deux étapes', async () => {
    const user = await registerEntreprise();

    const setup = await request(app).post('/api/mfa/setup').set(bearer(user.token)).send({ method: 'totp' });
    expect(setup.status).toBe(200);
    expect(setup.body.method).toBe('totp');
    expect(setup.body.secret).toBeTruthy();

    const code = await generateOtp({ strategy: 'totp', secret: setup.body.secret });
    const verify = await request(app).post('/api/mfa/verify').set(bearer(user.token)).send({ code, method: 'totp' });
    expect(verify.status).toBe(200);
    expect(verify.body.success).toBe(true);

    const me = await request(app).get('/api/auth/me').set(bearer(user.token));
    expect(me.body.user.mfaEnabled).toBe(true);
    expect(me.body.user.mfaMethod).toBe('totp');

    // Login : sans code → mfaRequired ; avec un bon code → token ; mauvais → 401
    const step1 = await request(app).post('/api/auth/login').send({ email: user.email, password: user.password });
    expect(step1.status).toBe(200);
    expect(step1.body).toMatchObject({ mfaRequired: true, mfaMethod: 'totp' });
    expect(step1.body.token).toBeUndefined();

    const bad = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password, mfaCode: '000000' });
    expect(bad.status).toBe(401);

    const fresh = await generateOtp({ strategy: 'totp', secret: setup.body.secret });
    const step2 = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password, mfaCode: fresh });
    expect(step2.status).toBe(200);
    expect(step2.body.token).toBeTruthy();
  });

  test('2FA active : setup refusé (409), désactivation exige le bon mot de passe', async () => {
    const user = await registerEntreprise();
    const setup = await request(app).post('/api/mfa/setup').set(bearer(user.token)).send({ method: 'totp' });
    const code = await generateOtp({ strategy: 'totp', secret: setup.body.secret });
    await request(app).post('/api/mfa/verify').set(bearer(user.token)).send({ code, method: 'totp' });

    // Un jeton seul ne permet plus de remplacer le secret TOTP d'un compte protégé.
    const reSetup = await request(app).post('/api/mfa/setup').set(bearer(user.token)).send({ method: 'totp' });
    expect(reSetup.status).toBe(409);

    const sansMdp = await request(app).post('/api/mfa/disable').set(bearer(user.token)).send({});
    expect(sansMdp.status).toBe(400);
    const mauvaisMdp = await request(app).post('/api/mfa/disable').set(bearer(user.token)).send({ password: 'Mauvais123' });
    expect(mauvaisMdp.status).toBe(401);
    let me = await request(app).get('/api/auth/me').set(bearer(user.token));
    expect(me.body.user.mfaEnabled).toBe(true);

    const ok = await request(app).post('/api/mfa/disable').set(bearer(user.token)).send({ password: user.password });
    expect(ok.status).toBe(200);
    me = await request(app).get('/api/auth/me').set(bearer(user.token));
    expect(me.body.user.mfaEnabled).toBe(false);
  });
});

describe('MFA — code par email', () => {
  test('setup (envoi échoue sans SMTP → 502) mais le code reste dérivable ; verify + login OK', async () => {
    const user = await registerEntreprise();

    // Pas d'EMAIL_* en test → l'envoi jette, la route répond 502. Le code, lui, est
    // déterministe (HOTP sur JWT_SECRET + identité) : on le recalcule côté test.
    const setup = await request(app).post('/api/mfa/setup').set(bearer(user.token)).send({ method: 'email' });
    expect(setup.status).toBe(502);

    const code = generateEmailCode(user.userId, user.email);
    const verify = await request(app).post('/api/mfa/verify').set(bearer(user.token)).send({ code, method: 'email' });
    expect(verify.status).toBe(200);
    expect(verify.body.method).toBe('email');

    const bad = await request(app).post('/api/mfa/verify').set(bearer(user.token)).send({ code: '000000', method: 'email' });
    expect(bad.status).toBe(400);

    const me = await request(app).get('/api/auth/me').set(bearer(user.token));
    expect(me.body.user).toMatchObject({ mfaEnabled: true, mfaMethod: 'email' });

    // Login : étape 1 annonce la méthode email ; étape 2 accepte le code recalculé.
    const step1 = await request(app).post('/api/auth/login').send({ email: user.email, password: user.password });
    expect(step1.body).toMatchObject({ mfaRequired: true, mfaMethod: 'email' });

    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password, mfaCode: '123456' });
    expect(wrong.status).toBe(401);

    const step2 = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password, mfaCode: generateEmailCode(user.userId, user.email) });
    expect(step2.status).toBe(200);
    expect(step2.body.token).toBeTruthy();
  });
});
