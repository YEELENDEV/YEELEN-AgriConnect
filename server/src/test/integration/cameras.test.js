import { app, pool, request, registerEntreprise, createEmployeeLogin, restreindreEcritures } from './helpers.js';

afterAll(async () => { await pool.end(); });

const bearer = (t) => ({ Authorization: `Bearer ${t}` });

// Surveillance : le serveur ne stocke ni ne relaie aucune vidéo, il ne garde que la liste des
// caméras et la manière dont chacune s'affiche. L'essentiel des règles porte donc sur l'URL,
// qui est saisie à la main et finit dans un <img src> côté navigateur.
describe('Caméras — registre de surveillance', () => {
  let admin;

  beforeAll(async () => {
    admin = await registerEntreprise();
  });

  test('création, lecture et suppression', async () => {
    const creation = await request(app).post('/api/cameras').set(bearer(admin.token)).send({
      nom: 'Entrée poulailler',
      emplacementType: 'poulailler',
      emplacement: 'portail nord',
      typeFlux: 'snapshot',
      url: 'http://192.168.1.50/snapshot.jpg',
      rafraichissement: 15,
    });
    expect(creation.status).toBe(201);
    expect(creation.body.camera.nom).toBe('Entrée poulailler');
    expect(creation.body.camera.rafraichissement).toBe(15);
    expect(creation.body.camera.actif).toBe(true);

    const liste = await request(app).get('/api/cameras').set(bearer(admin.token));
    expect(liste.status).toBe(200);
    expect(liste.body.cameras).toHaveLength(1);

    const suppression = await request(app).delete(`/api/cameras/${creation.body.camera.id}`).set(bearer(admin.token));
    expect(suppression.status).toBe(200);
    expect((await request(app).get('/api/cameras').set(bearer(admin.token))).body.cameras).toHaveLength(0);
  });

  // Le RTSP est le protocole le plus répandu sur les caméras IP, et c'est justement celui
  // qu'aucun navigateur ne sait lire. Le refuser à la saisie évite un cadre noir inexpliqué.
  test('refuse une URL rtsp:// avec un message qui explique quoi faire', async () => {
    const res = await request(app).post('/api/cameras').set(bearer(admin.token))
      .send({ nom: 'Cam RTSP', url: 'rtsp://192.168.1.50:554/stream1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/snapshot/i);
  });

  // Une URL saisie librement finit dans un attribut src : javascript: y serait une injection.
  test('refuse les schémas non http(s)', async () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'ftp://x.test/a.jpg']) {
      const res = await request(app).post('/api/cameras').set(bearer(admin.token)).send({ nom: 'X', url });
      expect(res.status).toBe(400);
    }
  });

  test('valide le nom, l URL et les valeurs de liste', async () => {
    expect((await request(app).post('/api/cameras').set(bearer(admin.token))
      .send({ url: 'http://x.test/a.jpg' })).status).toBe(400);
    expect((await request(app).post('/api/cameras').set(bearer(admin.token))
      .send({ nom: 'Sans URL' })).status).toBe(400);
    expect((await request(app).post('/api/cameras').set(bearer(admin.token))
      .send({ nom: 'X', url: 'pas une url' })).status).toBe(400);
    expect((await request(app).post('/api/cameras').set(bearer(admin.token))
      .send({ nom: 'X', url: 'http://x.test/a.jpg', typeFlux: 'rtsp' })).status).toBe(400);
    expect((await request(app).post('/api/cameras').set(bearer(admin.token))
      .send({ nom: 'X', url: 'http://x.test/a.jpg', emplacementType: 'garage' })).status).toBe(400);
  });

  // Un intervalle trop court martèlerait la caméra, un trop long n'est plus de la surveillance.
  test('borne l intervalle de rafraîchissement', async () => {
    const rapide = await request(app).post('/api/cameras').set(bearer(admin.token))
      .send({ nom: 'Rapide', url: 'http://x.test/a.jpg', rafraichissement: 0 });
    expect(rapide.body.camera.rafraichissement).toBe(2);
    const lente = await request(app).post('/api/cameras').set(bearer(admin.token))
      .send({ nom: 'Lente', url: 'http://x.test/a.jpg', rafraichissement: 99999 });
    expect(lente.body.camera.rafraichissement).toBe(300);
  });

  test('écriture réservée à admin/directeur, lecture ouverte', async () => {
    const ouvrier = await createEmployeeLogin(admin.token, 'ouvrier');
    await restreindreEcritures(admin.entrepriseId, ouvrier.email, ['cameras']);
    expect((await request(app).get('/api/cameras').set(bearer(ouvrier.token))).status).toBe(200);
    expect((await request(app).post('/api/cameras').set(bearer(ouvrier.token))
      .send({ nom: 'X', url: 'http://x.test/a.jpg' })).status).toBe(403);
  });

  test('isolation multi-tenant', async () => {
    const mienne = (await request(app).post('/api/cameras').set(bearer(admin.token))
      .send({ nom: 'À moi', url: 'http://x.test/a.jpg' })).body.camera;
    const b = await registerEntreprise();
    expect((await request(app).get('/api/cameras').set(bearer(b.token))).body.cameras).toEqual([]);
    expect((await request(app).delete(`/api/cameras/${mienne.id}`).set(bearer(b.token))).status).toBe(404);
    expect((await request(app).put(`/api/cameras/${mienne.id}`).set(bearer(b.token))
      .send({ nom: 'volée' })).status).toBe(404);
  });
});
