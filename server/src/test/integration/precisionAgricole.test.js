import { app, pool, request, registerEntreprise } from './helpers.js';

afterAll(async () => { await pool.end(); });

const bearer = (t) => ({ Authorization: `Bearer ${t}` });

// Crée une parcelle avec localisation/superficie explicites (createParcelle de helpers.js
// n'accepte pas ces champs — inutile d'étendre un helper partagé pour ce seul fichier).
async function creerParcelleLocalisee(token, { latitude = 12.639, longitude = -3.996, superficie = 5, nom } = {}) {
  const res = await request(app).post('/api/cultures/parcelles').set(bearer(token))
    .send({ nom: nom || `Parcelle ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, culture: 'Maïs', latitude, longitude, superficie });
  return res.body.parcelle.id;
}

function fabriquerReponseSoilGrids({ ph = 61, argile = 256, sable = 480, limon = 264, soc = 103, azote = 78, cec = 91 } = {}) {
  const layer = (name, mean, dFactor) => ({ name, unit_measure: { d_factor: dFactor }, depths: [{ values: { mean } }] });
  return {
    properties: {
      layers: [
        layer('phh2o', ph, 10), layer('clay', argile, 10), layer('sand', sable, 10),
        layer('silt', limon, 10), layer('soc', soc, 10), layer('nitrogen', azote, 100), layer('cec', cec, 10),
      ],
    },
  };
}

function mockerFetchSol(soilData, { ok = true, status = 200 } = {}) {
  const original = global.fetch;
  global.fetch = async () => ({ ok, status, json: async () => soilData });
  return () => { global.fetch = original; };
}

describe('GET /api/precision/sol', () => {
  test('parcelle localisée → texture/pH/suggestions calculés à partir de SoilGrids', async () => {
    const admin = await registerEntreprise();
    const parcelleId = await creerParcelleLocalisee(admin.token);
    const restore = mockerFetchSol(fabriquerReponseSoilGrids());
    try {
      const res = await request(app).get(`/api/precision/sol?parcelleId=${parcelleId}`).set(bearer(admin.token));
      expect(res.status).toBe(200);
      expect(res.body.ph).toBeCloseTo(6.1, 1);
      expect(res.body.texture.argile).toBeCloseTo(25.6, 1);
      expect(res.body.texture.classe).toBeTruthy();
      expect(res.body.carboneOrganique).toBeCloseTo(10.3, 1);
      expect(res.body.azote).toBeCloseTo(0.78, 2);
      expect(Array.isArray(res.body.culturesSuggerees)).toBe(true);
      expect(res.body.culturesSuggerees.length).toBeGreaterThan(0);
    } finally { restore(); }
  });

  test('parcelleId manquant → 400 ; parcelle inexistante/autre entreprise → 404', async () => {
    const admin = await registerEntreprise();
    expect((await request(app).get('/api/precision/sol').set(bearer(admin.token))).status).toBe(400);

    const parcelleId = await creerParcelleLocalisee(admin.token);
    const autre = await registerEntreprise();
    expect((await request(app).get(`/api/precision/sol?parcelleId=${parcelleId}`).set(bearer(autre.token))).status).toBe(404);
    expect((await request(app).get('/api/precision/sol?parcelleId=999999').set(bearer(admin.token))).status).toBe(404);
  });

  test('parcelle sans localisation → 404', async () => {
    const admin = await registerEntreprise();
    const res = await request(app).post('/api/cultures/parcelles').set(bearer(admin.token)).send({ nom: 'Sans localisation', culture: 'Riz' });
    const parcelleId = res.body.parcelle.id;
    const reponse = await request(app).get(`/api/precision/sol?parcelleId=${parcelleId}`).set(bearer(admin.token));
    expect(reponse.status).toBe(404);
  });

  test('échec SoilGrids → 502', async () => {
    const admin = await registerEntreprise();
    const parcelleId = await creerParcelleLocalisee(admin.token);
    const restore = mockerFetchSol(null, { ok: false, status: 500 });
    try {
      const res = await request(app).get(`/api/precision/sol?parcelleId=${parcelleId}`).set(bearer(admin.token));
      expect(res.status).toBe(502);
    } finally { restore(); }
  });

  // Régression (trouvé en vérification navigateur réelle sur les coordonnées de Bamako,
  // probablement le fleuve Niger) : SoilGrids répond 200 avec toutes les propriétés à null
  // sur un pixel sans donnée — doit être un 404 explicite, pas un succès avec des champs vides.
  test('SoilGrids répond 200 mais sans aucune donnée (plan d\'eau/zone non couverte) → 404', async () => {
    const admin = await registerEntreprise();
    const parcelleId = await creerParcelleLocalisee(admin.token);
    const restore = mockerFetchSol(fabriquerReponseSoilGrids({ ph: null, argile: null, sable: null, limon: null, soc: null, azote: null, cec: null }));
    try {
      const res = await request(app).get(`/api/precision/sol?parcelleId=${parcelleId}`).set(bearer(admin.token));
      expect(res.status).toBe(404);
    } finally { restore(); }
  });
});

describe('GET /api/precision/ndvi', () => {
  const clePrecedente = process.env.AGRO_API_KEY;
  afterEach(() => { process.env.AGRO_API_KEY = clePrecedente; });

  test('AGRO_API_KEY non configurée → { configured: false }, pas une erreur', async () => {
    delete process.env.AGRO_API_KEY;
    const admin = await registerEntreprise();
    const parcelleId = await creerParcelleLocalisee(admin.token);
    const res = await request(app).get(`/api/precision/ndvi?parcelleId=${parcelleId}`).set(bearer(admin.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false });
  });

  function mockerFetchAgro({ ndviLectures } = {}) {
    const original = global.fetch;
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/polygons') && !u.includes('/ndvi')) {
        return { ok: true, status: 200, json: async () => ({ id: 'polyid-test-123' }) };
      }
      if (u.includes('/ndvi/history')) {
        return { ok: true, status: 200, json: async () => ndviLectures ?? [
          { dt: 1725494400, cl: 0.05, data: { mean: 0.55 } },
          { dt: 1725840000, cl: 0.1, data: { mean: 0.62 } },
        ] };
      }
      throw new Error(`URL non mockée dans ce test : ${u}`);
    };
    return () => { global.fetch = original; };
  }

  test('crée le polygone au premier appel, le réutilise ensuite (pas de 2e création)', async () => {
    process.env.AGRO_API_KEY = 'test-key';
    const admin = await registerEntreprise();
    const parcelleId = await creerParcelleLocalisee(admin.token);
    let appelsPolygonesCreation = 0;
    const restore = (() => {
      const original = global.fetch;
      global.fetch = async (url) => {
        const u = String(url);
        if (u.startsWith('https://api.agromonitoring.com/agro/1.0/polygons?')) {
          appelsPolygonesCreation++;
          return { ok: true, status: 200, json: async () => ({ id: 'polyid-abc' }) };
        }
        if (u.includes('/ndvi/history')) {
          return { ok: true, status: 200, json: async () => [{ dt: 1725840000, cl: 0.1, data: { mean: 0.7 } }] };
        }
        throw new Error(`URL non mockée : ${u}`);
      };
      return () => { global.fetch = original; };
    })();
    try {
      const premier = await request(app).get(`/api/precision/ndvi?parcelleId=${parcelleId}`).set(bearer(admin.token));
      expect(premier.status).toBe(200);
      expect(premier.body.configured).toBe(true);
      expect(premier.body.ndviActuel).toBeCloseTo(0.7, 2);
      expect(premier.body.bande).toBe('dense');
      expect(appelsPolygonesCreation).toBe(1);

      const { rows } = await pool.query('SELECT agro_polygon_id AS "agroPolygonId" FROM parcelles WHERE id = $1', [parcelleId]);
      expect(rows[0].agroPolygonId).toBe('polyid-abc');

      const second = await request(app).get(`/api/precision/ndvi?parcelleId=${parcelleId}`).set(bearer(admin.token));
      expect(second.status).toBe(200);
      expect(appelsPolygonesCreation).toBe(1); // pas de 2e création
    } finally { restore(); }
  });

  test('superficie hors bornes (1-3000 ha) → 400', async () => {
    process.env.AGRO_API_KEY = 'test-key';
    const admin = await registerEntreprise();
    const parcelleId = await creerParcelleLocalisee(admin.token, { superficie: 0.2 });
    const res = await request(app).get(`/api/precision/ndvi?parcelleId=${parcelleId}`).set(bearer(admin.token));
    expect(res.status).toBe(400);
  });

  test('pas de localisation → 404 ; parcelle d\'une autre entreprise → 404', async () => {
    process.env.AGRO_API_KEY = 'test-key';
    const admin = await registerEntreprise();
    const sansLoc = await request(app).post('/api/cultures/parcelles').set(bearer(admin.token)).send({ nom: 'Sans loc NDVI', culture: 'Soja' });
    const resSansLoc = await request(app).get(`/api/precision/ndvi?parcelleId=${sansLoc.body.parcelle.id}`).set(bearer(admin.token));
    expect(resSansLoc.status).toBe(404);

    const parcelleId = await creerParcelleLocalisee(admin.token);
    const autre = await registerEntreprise();
    const resAutre = await request(app).get(`/api/precision/ndvi?parcelleId=${parcelleId}`).set(bearer(autre.token));
    expect(resAutre.status).toBe(404);
  });

  test('invalidation du polygone après changement de latitude/superficie via PUT', async () => {
    process.env.AGRO_API_KEY = 'test-key';
    const admin = await registerEntreprise();
    const parcelleId = await creerParcelleLocalisee(admin.token);
    const restore = mockerFetchAgro();
    try {
      await request(app).get(`/api/precision/ndvi?parcelleId=${parcelleId}`).set(bearer(admin.token));
      const avant = await pool.query('SELECT agro_polygon_id FROM parcelles WHERE id = $1', [parcelleId]);
      expect(avant.rows[0].agro_polygon_id).toBeTruthy();

      await request(app).put(`/api/cultures/parcelles/${parcelleId}`).set(bearer(admin.token)).send({ latitude: 13.5 });
      const apres = await pool.query('SELECT agro_polygon_id FROM parcelles WHERE id = $1', [parcelleId]);
      expect(apres.rows[0].agro_polygon_id).toBeNull();

      await request(app).put(`/api/cultures/parcelles/${parcelleId}`).set(bearer(admin.token)).send({ nom: 'Renommée seulement' });
      const inchange = await pool.query('SELECT nom FROM parcelles WHERE id = $1', [parcelleId]);
      expect(inchange.rows[0].nom).toBe('Renommée seulement');
    } finally { restore(); }
  });

  test('échec Agromonitoring (NDVI) → 502', async () => {
    process.env.AGRO_API_KEY = 'test-key';
    const admin = await registerEntreprise();
    const parcelleId = await creerParcelleLocalisee(admin.token);
    const original = global.fetch;
    global.fetch = async (url) => {
      if (String(url).includes('/polygons')) return { ok: true, status: 200, json: async () => ({ id: 'polyid-fail' }) };
      return { ok: false, status: 500, json: async () => ({}) };
    };
    try {
      const res = await request(app).get(`/api/precision/ndvi?parcelleId=${parcelleId}`).set(bearer(admin.token));
      expect(res.status).toBe(502);
    } finally { global.fetch = original; }
  });
});
