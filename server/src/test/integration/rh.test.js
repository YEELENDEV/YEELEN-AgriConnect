import { app, pool, request, registerEntreprise, createEmployeeLogin, restreindreEcritures } from './helpers.js';

afterAll(async () => { await pool.end(); });

const bearer = (t) => ({ Authorization: `Bearer ${t}` });

describe('RH — référentiels /api/rh', () => {
  let admin;
  beforeAll(async () => { admin = await registerEntreprise(); });

  test('admin crée département + poste rattaché ; ouvrier interdit', async () => {
    const dep = await request(app).post('/api/rh/departements').set(bearer(admin.token)).send({ nom: 'Production' });
    expect(dep.status).toBe(201);
    const depId = dep.body.departement.id;

    const poste = await request(app)
      .post('/api/rh/postes')
      .set(bearer(admin.token))
      .send({ intitule: 'Chef de culture', departementId: depId });
    expect(poste.status).toBe(201);
    expect(poste.body.poste.departementId).toBe(depId);

    const list = await request(app).get('/api/rh/departements').set(bearer(admin.token));
    expect(list.status).toBe(200);
    expect((list.body.departements || []).map((d) => d.id)).toContain(depId);

    const ouvrier = await createEmployeeLogin(admin.token, 'ouvrier');
    await restreindreEcritures(admin.entrepriseId, ouvrier.email, ['referentiels_rh']);
    const refuse = await request(app).post('/api/rh/departements').set(bearer(ouvrier.token)).send({ nom: 'Pirate' });
    expect(refuse.status).toBe(403);
  });

  test('type de congé : création admin → 201 (et défauts seedés à la création de l\'entreprise)', async () => {
    // register a déjà seedé des types par défaut (dont « Congés payés »).
    const defauts = await request(app).get('/api/rh/conges-types').set(bearer(admin.token));
    expect(defauts.status).toBe(200);
    expect(defauts.body.congesTypes.length).toBeGreaterThan(0);

    const nom = `Sans solde ${Date.now()}`;
    const res = await request(app).post('/api/rh/conges-types').set(bearer(admin.token)).send({ nom, paye: false });
    expect(res.status).toBe(201);
    expect(res.body.congeType).toMatchObject({ nom, paye: false });
  });
});

describe('RH — congés : demande self-service, décompte du solde, décision', () => {
  let admin;
  let emp;
  let typeId;

  beforeAll(async () => {
    admin = await registerEntreprise();
    emp = await createEmployeeLogin(admin.token, 'ouvrier');
    // Utilise un type de congé seedé par défaut à la création de l'entreprise.
    const types = await request(app).get('/api/rh/conges-types').set(bearer(admin.token));
    typeId = types.body.congesTypes[0].id;
    // Droit : 25 jours alloués pour 2026
    const droit = await request(app)
      .post(`/api/salaries/${emp.salarieId}/conges-droits`)
      .set(bearer(admin.token))
      .send({ typeId, annee: 2026, joursAlloues: 25 });
    expect(droit.status).toBe(201);
    expect(droit.body.droit.joursAlloues).toBe(25);
  });

  test("GET /salaries/moi renvoie la fiche liée au compte de l'employé", async () => {
    const moi = await request(app).get('/api/salaries/moi').set(bearer(emp.token));
    expect(moi.status).toBe(200);
    expect(moi.body.salarie.id).toBe(emp.salarieId);
  });

  test("l'employé demande un congé (Lun→Ven = 5 j), ne peut pas l'approuver lui-même, l'admin l'approuve, le solde décompte", async () => {
    const demande = await request(app)
      .post(`/api/salaries/${emp.salarieId}/conges`)
      .set(bearer(emp.token))
      .send({ typeId, dateDebut: '2026-06-01', dateFin: '2026-06-05' });
    expect(demande.status).toBe(201);
    expect(demande.body.conge.statut).toBe('Demandé');
    expect(demande.body.conge.nbJours).toBe(5);
    const congeId = demande.body.conge.id;

    // L'employé ne valide pas sa propre demande
    const autoApprob = await request(app)
      .put(`/api/salaries/conges/${congeId}`)
      .set(bearer(emp.token))
      .send({ statut: 'Approuvé' });
    expect(autoApprob.status).toBe(403);

    // L'admin approuve
    const approb = await request(app)
      .put(`/api/salaries/conges/${congeId}`)
      .set(bearer(admin.token))
      .send({ statut: 'Approuvé' });
    expect(approb.status).toBe(200);
    expect(approb.body.conge.statut).toBe('Approuvé');

    // Solde : alloués 25, pris 5, restant 20
    const solde = await request(app)
      .get(`/api/salaries/${emp.salarieId}/conges-solde?annee=2026`)
      .set(bearer(admin.token));
    expect(solde.status).toBe(200);
    const ligne = solde.body.solde.find((s) => s.typeId === typeId);
    expect(ligne).toMatchObject({ alloues: 25, pris: 5, restant: 20 });
  });
});

describe('RH — avances (admin) et contrats', () => {
  let admin;
  let emp;
  beforeAll(async () => {
    admin = await registerEntreprise();
    emp = await createEmployeeLogin(admin.token, 'ouvrier');
  });

  test('avance : ouvrier non lié → 403 ; admin → 201', async () => {
    const autre = await createEmployeeLogin(admin.token, 'ouvrier');
    await restreindreEcritures(admin.entrepriseId, autre.email, ['avances']);
    const refuse = await request(app)
      .post(`/api/salaries/${emp.salarieId}/avances`)
      .set(bearer(autre.token))
      .send({ montant: 10000, motif: 'x' });
    expect(refuse.status).toBe(403);

    const ok = await request(app)
      .post(`/api/salaries/${emp.salarieId}/avances`)
      .set(bearer(admin.token))
      .send({ montant: 10000, motif: 'Avance sur salaire' });
    expect(ok.status).toBe(201);
    expect(ok.body.avance.montant).toBe(10000);
  });

  test('nouveau contrat → devient le seul actif', async () => {
    const c1 = await request(app)
      .post(`/api/salaries/${emp.salarieId}/contrats`)
      .set(bearer(admin.token))
      .send({ type: 'CDD', dateDebut: '2026-01-01', salaire: 150000 });
    expect(c1.status).toBe(201);

    const c2 = await request(app)
      .post(`/api/salaries/${emp.salarieId}/contrats`)
      .set(bearer(admin.token))
      .send({ type: 'CDI', dateDebut: '2026-04-01', salaire: 180000 });
    expect(c2.status).toBe(201);

    const list = await request(app).get(`/api/salaries/${emp.salarieId}/contrats`).set(bearer(admin.token));
    expect(list.status).toBe(200);
    const actifs = list.body.contrats.filter((c) => c.actif);
    expect(actifs).toHaveLength(1);
    expect(actifs[0].type).toBe('CDI');
  });
});

describe('RH — isolation multi-tenant', () => {
  test("l'entreprise B ne voit pas l'employé de A et ne peut pas lui poser un droit", async () => {
    const a = await registerEntreprise();
    const b = await registerEntreprise();
    const empA = await createEmployeeLogin(a.token, 'ouvrier');

    const listB = await request(app).get('/api/salaries').set(bearer(b.token));
    expect(listB.status).toBe(200);
    expect((listB.body.salaries || listB.body || []).map((s) => s.id)).not.toContain(empA.salarieId);

    const typesB = await request(app).get('/api/rh/conges-types').set(bearer(b.token));
    const droitB = await request(app)
      .post(`/api/salaries/${empA.salarieId}/conges-droits`)
      .set(bearer(b.token))
      .send({ typeId: typesB.body.congesTypes[0].id, annee: 2026, joursAlloues: 10 });
    expect(droitB.status).toBe(404);
  });
});
