import { app, pool, request, registerEntreprise, createEmployeeLogin, restreindreEcritures } from './helpers.js';
import { prochainNumeroJournal } from '../../utils/journalSequence.js';

afterAll(async () => { await pool.end(); });

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const list = async (token) => (await request(app).get('/api/journals').set(bearer(token))).body.journals;

describe('Journaux (account.journal-like) — seed, CRUD, rôles, isolation', () => {
  let admin;
  beforeAll(async () => { admin = await registerEntreprise(); });

  test('register a seedé les 5 journaux par défaut', async () => {
    const j = await list(admin.token);
    const codes = j.map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['FAC', 'BILL', 'BNK', 'CSH', 'MISC']));
    const inv = j.find((x) => x.code === 'FAC');
    expect(inv).toMatchObject({ type: 'sale', refundSequence: true });
    expect(inv.defaultAccountId).toBeTruthy(); // relié au compte 400000 seedé
  });

  test('POST : nom/code/type requis, code ≤ 5 car., code en double → 409, code normalisé en MAJ', async () => {
    expect((await request(app).post('/api/journals').set(bearer(admin.token)).send({ name: 'X', type: 'sale' })).status).toBe(400);
    expect((await request(app).post('/api/journals').set(bearer(admin.token)).send({ name: 'X', code: 'TOOLONG', type: 'sale' })).status).toBe(400);
    expect((await request(app).post('/api/journals').set(bearer(admin.token)).send({ name: 'X', code: 'X', type: 'bidon' })).status).toBe(400);

    const ok = await request(app).post('/api/journals').set(bearer(admin.token))
      .send({ name: 'Ventes export', code: 'exp', type: 'sale' });
    expect(ok.status).toBe(201);
    expect(ok.body.journal.code).toBe('EXP');

    const dup = await request(app).post('/api/journals').set(bearer(admin.token))
      .send({ name: 'Autre', code: 'EXP', type: 'sale' });
    expect(dup.status).toBe(409);
  });

  test('POST/PUT : defaultAccountId d’une autre entreprise → 400', async () => {
    const autre = await registerEntreprise();
    const compteAutre = (await request(app).get('/api/accounts').set(bearer(autre.token))).body.accounts[0].id;
    const res = await request(app).post('/api/journals').set(bearer(admin.token))
      .send({ name: 'KO', code: 'KO1', type: 'general', defaultAccountId: compteAutre });
    expect(res.status).toBe(400);
  });

  test('PUT met à jour ; DELETE puis 404', async () => {
    const j = (await request(app).post('/api/journals').set(bearer(admin.token))
      .send({ name: 'Temp', code: `T${Date.now() % 1000}`, type: 'general' })).body.journal;
    const put = await request(app).put(`/api/journals/${j.id}`).set(bearer(admin.token)).send({ name: 'Temp modifié', sequence: 99 });
    expect(put.status).toBe(200);
    expect(put.body.journal).toMatchObject({ name: 'Temp modifié', sequence: 99 });
    expect((await request(app).delete(`/api/journals/${j.id}`).set(bearer(admin.token))).status).toBe(200);
    expect((await request(app).delete(`/api/journals/${j.id}`).set(bearer(admin.token))).status).toBe(404);
  });

  test('écritures réservées admin/directeur (ouvrier → 403, lecture OK)', async () => {
    const ouvrier = await createEmployeeLogin(admin.token, 'ouvrier');
    await restreindreEcritures(admin.entrepriseId, ouvrier.email, ['referentiels_comptables']);
    expect((await request(app).get('/api/journals').set(bearer(ouvrier.token))).status).toBe(200);
    expect((await request(app).post('/api/journals').set(bearer(ouvrier.token)).send({ name: 'KO', code: 'KO2', type: 'sale' })).status).toBe(403);
  });

  test('isolation multi-tenant : B ne voit ni ne modifie le journal de A', async () => {
    const a = await registerEntreprise();
    const b = await registerEntreprise();
    const jA = (await request(app).post('/api/journals').set(bearer(a.token)).send({ name: 'De A', code: 'DEA', type: 'general' })).body.journal;
    expect((await list(b.token)).map((x) => x.id)).not.toContain(jA.id);
    expect((await request(app).put(`/api/journals/${jA.id}`).set(bearer(b.token)).send({ name: 'hack' })).status).toBe(404);
    expect((await request(app).delete(`/api/journals/${jA.id}`).set(bearer(b.token))).status).toBe(404);
  });
});

describe('prochainNumeroJournal — numérotation par journal', () => {
  let admin;
  let invJournalId;
  beforeAll(async () => {
    admin = await registerEntreprise();
    invJournalId = (await request(app).get('/api/journals').set(bearer(admin.token))).body.journals.find((j) => j.code === 'FAC').id;
  });

  test('incrémente NNNN, réinitialise par année, préfixe R pour un avoir', async () => {
    const client = await pool.connect();
    try {
      const n1 = await prochainNumeroJournal(client, invJournalId, admin.entrepriseId, '2026-03-01');
      const n2 = await prochainNumeroJournal(client, invJournalId, admin.entrepriseId, '2026-07-15');
      expect(n1).toBe('FAC/2026/0001');
      expect(n2).toBe('FAC/2026/0002');

      // année différente → compteur repart de 1
      const n3 = await prochainNumeroJournal(client, invJournalId, admin.entrepriseId, '2027-01-02');
      expect(n3).toBe('FAC/2027/0001');

      // avoir sur un journal refund_sequence → préfixe R..., séquence séparée
      const r1 = await prochainNumeroJournal(client, invJournalId, admin.entrepriseId, '2026-04-01', { refund: true });
      expect(r1).toBe('RFAC/2026/0001');
    } finally {
      client.release();
    }
  });

  test('journal d’une autre entreprise → throw JOURNAL_NOT_FOUND', async () => {
    const autre = await registerEntreprise();
    const client = await pool.connect();
    try {
      await expect(prochainNumeroJournal(client, invJournalId, autre.entrepriseId, '2026-01-01'))
        .rejects.toMatchObject({ code: 'JOURNAL_NOT_FOUND' });
    } finally {
      client.release();
    }
  });
});

// Renommage INV → FAC (2026-09-11). La migration elle-même (migrate.js:renommerJournalVenteVersFac)
// n'est pas rejouable ici — le globalSetup crée déjà les journaux en FAC — mais son invariant
// critique se teste : après un renommage de code, la numérotation doit CONTINUER et non repartir
// à 0001, sinon deux pièces du même exercice porteraient le même numéro apparent.
describe('Renommage du code de journal — continuité de la numérotation', () => {
  test('le compteur reporté fait continuer la séquence au lieu de la redémarrer', async () => {
    const admin = await registerEntreprise();
    const journalId = (await request(app).get('/api/journals').set(bearer(admin.token)))
      .body.journals.find((j) => j.code === 'FAC').id;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const n1 = await prochainNumeroJournal(client, journalId, admin.entrepriseId, '2026-05-01');
      const n2 = await prochainNumeroJournal(client, journalId, admin.entrepriseId, '2026-05-02');
      expect([n1, n2]).toEqual(['FAC/2026/0001', 'FAC/2026/0002']);

      // On rejoue exactement ce que fait la migration : reporter le compteur sur le nouveau
      // préfixe, puis renommer le code.
      await client.query(
        `INSERT INTO account_journal_sequence (journal_id, prefix, last_number)
         SELECT s.journal_id, 'VTE/' || split_part(s.prefix, '/', 2) || '/', s.last_number
           FROM account_journal_sequence s
          WHERE s.journal_id = $1 AND s.prefix LIKE 'FAC/%'
         ON CONFLICT (journal_id, prefix) DO UPDATE
           SET last_number = GREATEST(account_journal_sequence.last_number, EXCLUDED.last_number)`,
        [journalId]
      );
      await client.query("UPDATE account_journal SET code = 'VTE' WHERE id = $1", [journalId]);

      const n3 = await prochainNumeroJournal(client, journalId, admin.entrepriseId, '2026-05-03');
      // 0003 et non 0001 : c'est tout l'objet du report.
      expect(n3).toBe('VTE/2026/0003');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
