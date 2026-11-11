import { app, pool, request } from './helpers.js';

afterAll(async () => { await pool.end(); });

describe('GET /api/health', () => {
  test('répond 200 sans authentification quand la base répond, sans aucune donnée métier', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ statut: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
