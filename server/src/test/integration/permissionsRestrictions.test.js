// Le modèle de restrictions : l'application n'apporte aucune politique, l'entreprise écrit la
// sienne sur une page blanche. Trois règles à garantir — le propriétaire garde tout, un
// utilisateur sans rôle n'est pas restreint, et une restriction posée par l'entreprise est
// APPLIQUÉE (refus 403 depuis la bascule de l'étape 3b, 2026-11-11).
import { app, pool, request, registerEntreprise, createEmployeeLogin } from './helpers.js';
import { creerAppariementChemin } from '../../permissions/inventaireRoutes.js';
import { restrictionsUtilisateur, autoriseUtilisateur, viderCacheRoles } from '../../utils/rolesService.js';

afterAll(async () => { await pool.end(); });

const bearer = (t) => ({ Authorization: `Bearer ${t}` });

const idUtilisateur = async (email) => {
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  return rows[0].id;
};

const compter = async (entrepriseId, ressource, action) => {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM audit_log
      WHERE entreprise_id = $1 AND action IN ('permission_observee', 'permission_refusee')
        AND details->>'ressource' = $2 AND details->>'action' = $3`,
    [entrepriseId, ressource, action]
  );
  return rows[0].n;
};

// Crée un rôle portant les restrictions données et y rattache l'utilisateur.
const restreindre = async (entrepriseId, userId, nom, restrictions) => {
  const { rows: [role] } = await pool.query(
    'INSERT INTO roles (entreprise_id, nom) VALUES ($1, $2) RETURNING id', [entrepriseId, nom]
  );
  for (const [ressource, action] of restrictions) {
    await pool.query('INSERT INTO role_restrictions (role_id, ressource, action) VALUES ($1, $2, $3)', [role.id, ressource, action]);
  }
  await pool.query('UPDATE entreprise_utilisateurs SET role_id = $1 WHERE entreprise_id = $2 AND user_id = $3',
    [role.id, entrepriseId, userId]);
  viderCacheRoles();
  return role.id;
};

describe('Page blanche', () => {
  let admin;

  beforeAll(async () => { admin = await registerEntreprise(); });
  beforeEach(() => { viderCacheRoles(); });

  test("une entreprise qui s'inscrit n'a AUCUN rôle", async () => {
    // C'est la demande centrale : l'application ne propose pas de politique toute faite.
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM roles WHERE entreprise_id = $1', [admin.entrepriseId]);
    expect(rows[0].n).toBe(0);
  });

  test('le compte créateur est le propriétaire', async () => {
    const { rows: [e] } = await pool.query('SELECT proprietaire_user_id FROM entreprises WHERE id = $1', [admin.entrepriseId]);
    expect(e.proprietaire_user_id).toBe(await idUtilisateur(admin.email));
  });

  test('un salarié créé avec un compte n’est rattaché à aucun rôle', async () => {
    const employe = await createEmployeeLogin(admin.token, 'ouvrier');
    const { rows: [eu] } = await pool.query(
      'SELECT role_id FROM entreprise_utilisateurs WHERE entreprise_id = $1 AND user_id = $2',
      [admin.entrepriseId, await idUtilisateur(employe.email)]
    );
    expect(eu.role_id).toBeNull();
  });
});

describe('Tout ouvert par défaut', () => {
  let admin;
  let employe;

  beforeAll(async () => {
    admin = await registerEntreprise();
    employe = await createEmployeeLogin(admin.token, 'ouvrier');
  });
  beforeEach(() => { viderCacheRoles(); });

  test("un utilisateur sans rôle n'a aucune restriction", async () => {
    const r = await restrictionsUtilisateur(admin.entrepriseId, await idUtilisateur(employe.email));
    expect(r.roleId).toBeNull();
    expect(r.restrictions).toEqual({});
    expect(autoriseUtilisateur(r, 'factures', 'encaisser')).toBe(true);
    expect(autoriseUtilisateur(r, 'salaries', 'supprimer')).toBe(true);
  });

  test('un rôle sans restriction ne restreint rien', async () => {
    const { rows: [role] } = await pool.query(
      "INSERT INTO roles (entreprise_id, nom) VALUES ($1, 'Rôle vide') RETURNING id",
      [admin.entrepriseId]
    );
    await pool.query('UPDATE entreprise_utilisateurs SET role_id = $1 WHERE entreprise_id = $2 AND user_id = $3',
      [role.id, admin.entrepriseId, await idUtilisateur(employe.email)]);
    viderCacheRoles();

    const r = await restrictionsUtilisateur(admin.entrepriseId, await idUtilisateur(employe.email));
    expect(r.roleId).toBe(role.id);
    expect(autoriseUtilisateur(r, 'contacts', 'creer')).toBe(true);
  });
});

describe("L'entreprise écrit sa politique", () => {
  let admin;
  let employe;
  let roleId;
  let employeUserId;

  beforeAll(async () => {
    admin = await registerEntreprise();
    employe = await createEmployeeLogin(admin.token, 'ouvrier');
    employeUserId = await idUtilisateur(employe.email);

    const { rows: [role] } = await pool.query(
      "INSERT INTO roles (entreprise_id, nom, description) VALUES ($1, 'Saisie terrain', 'Créé par l’entreprise') RETURNING id",
      [admin.entrepriseId]
    );
    roleId = role.id;
    await pool.query('UPDATE entreprise_utilisateurs SET role_id = $1 WHERE entreprise_id = $2 AND user_id = $3',
      [roleId, admin.entrepriseId, employeUserId]);
  });
  beforeEach(() => { viderCacheRoles(); });

  test('une restriction posée est suivie', async () => {
    await pool.query(
      "INSERT INTO role_restrictions (role_id, ressource, action) VALUES ($1, 'contacts', 'creer') ON CONFLICT DO NOTHING",
      [roleId]
    );
    viderCacheRoles();

    const r = await restrictionsUtilisateur(admin.entrepriseId, employeUserId);
    expect(autoriseUtilisateur(r, 'contacts', 'creer')).toBe(false);
    // Seule l'action retirée est fermée : le reste de la ressource demeure ouvert.
    expect(autoriseUtilisateur(r, 'contacts', 'lire')).toBe(true);
    expect(autoriseUtilisateur(r, 'produits', 'creer')).toBe(true);
  });

  test('une restriction retirée rouvre immédiatement', async () => {
    await pool.query(
      "INSERT INTO role_restrictions (role_id, ressource, action) VALUES ($1, 'produits', 'supprimer') ON CONFLICT DO NOTHING",
      [roleId]
    );
    viderCacheRoles();
    let r = await restrictionsUtilisateur(admin.entrepriseId, employeUserId);
    expect(autoriseUtilisateur(r, 'produits', 'supprimer')).toBe(false);

    await pool.query("DELETE FROM role_restrictions WHERE role_id = $1 AND ressource = 'produits'", [roleId]);
    viderCacheRoles();
    r = await restrictionsUtilisateur(admin.entrepriseId, employeUserId);
    expect(autoriseUtilisateur(r, 'produits', 'supprimer')).toBe(true);
  });

  test('aucune restriction ne s’applique au propriétaire', async () => {
    // Garde-fou contre le verrouillage : une entreprise ne doit pas pouvoir s'enfermer dehors.
    const { rows: [roleAdmin] } = await pool.query(
      "INSERT INTO roles (entreprise_id, nom) VALUES ($1, 'Rôle piégé') RETURNING id",
      [admin.entrepriseId]
    );
    await pool.query(
      "INSERT INTO role_restrictions (role_id, ressource, action) VALUES ($1, 'entreprise', 'modifier')",
      [roleAdmin.id]
    );
    const proprietaireId = await idUtilisateur(admin.email);
    await pool.query('UPDATE entreprise_utilisateurs SET role_id = $1 WHERE entreprise_id = $2 AND user_id = $3',
      [roleAdmin.id, admin.entrepriseId, proprietaireId]);
    viderCacheRoles();

    const r = await restrictionsUtilisateur(admin.entrepriseId, proprietaireId);
    expect(r.proprietaire).toBe(true);
    expect(autoriseUtilisateur(r, 'entreprise', 'modifier')).toBe(true);
  });

  test('un rôle renommé garde ses restrictions — le nom appartient à l’entreprise', async () => {
    await pool.query("UPDATE roles SET nom = 'Chef de culture' WHERE id = $1", [roleId]);
    viderCacheRoles();
    const r = await restrictionsUtilisateur(admin.entrepriseId, employeUserId);
    expect(autoriseUtilisateur(r, 'contacts', 'creer')).toBe(false);
  });
});

describe('Le garde applique les restrictions (mode refus)', () => {
  let admin;
  let employe;
  let roleId;

  beforeAll(async () => {
    admin = await registerEntreprise();
    employe = await createEmployeeLogin(admin.token, 'ouvrier');
    roleId = await restreindre(admin.entrepriseId, await idUtilisateur(employe.email), 'Restreint', [
      ['contacts', 'creer'],
      ['devis', 'lire'],
    ]);
  });
  beforeEach(() => { viderCacheRoles(); });

  test('une action retirée est refusée (403) avec un message lisible, et rien n’est créé', async () => {
    const res = await request(app).post('/api/contacts').set(bearer(employe.token))
      .send({ nom: 'Client interdit', estClient: true });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ reason: 'restriction', ressource: 'contacts', action: 'creer' });
    expect(res.body.error).toMatch(/Clients et fournisseurs/);

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM contacts WHERE entreprise_id = $1 AND nom = 'Client interdit'", [admin.entrepriseId]);
    expect(rows[0].n).toBe(0);
  });

  test('le refus est journalisé (permission_refusee) avec le rôle en cause', async () => {
    await request(app).post('/api/contacts').set(bearer(employe.token)).send({ nom: 'Encore interdit', estClient: true });
    const { rows } = await pool.query(
      `SELECT details FROM audit_log WHERE entreprise_id = $1 AND action = 'permission_refusee'
        ORDER BY id DESC LIMIT 10`,
      [admin.entrepriseId]
    );
    const trouve = rows.map((r) => r.details).find((d) => d.ressource === 'contacts' && d.action === 'creer');
    expect(trouve).toMatchObject({ raison: 'restriction_entreprise', roleId });
  });

  test('seule l’action retirée est fermée : lire les contacts et créer une observation restent permis', async () => {
    const lire = await request(app).get('/api/contacts').set(bearer(employe.token));
    expect(lire.status).toBe(200);
    const avant = await compter(admin.entrepriseId, 'observations', 'creer');
    const obs = await request(app).post('/api/observations').set(bearer(employe.token)).send({ notes: 'Relevé de parcelle' });
    expect(obs.status).toBe(201);
    expect(await compter(admin.entrepriseId, 'observations', 'creer')).toBe(avant);
  });

  test('une lecture retirée est refusée, y compris par la recherche globale', async () => {
    const liste = await request(app).get('/api/devis').set(bearer(employe.token));
    expect(liste.status).toBe(403);

    // Le propriétaire crée un devis trouvable par son numéro / son client.
    const contact = await request(app).post('/api/contacts').set(bearer(admin.token)).send({ nom: 'Zebulon Recherche', estClient: true });
    await request(app).post('/api/devis').set(bearer(admin.token))
      .send({ clientId: contact.body.contact.id, lignes: [{ produit: 'Maïs', quantite: 1, prixUnitaire: 10, type: 'produit' }] });

    const parEmploye = await request(app).get('/api/recherche?q=Zebulon').set(bearer(employe.token));
    expect(parEmploye.status).toBe(200);
    expect(parEmploye.body.devis).toEqual([]);           // lecture des devis retirée
    expect(parEmploye.body.contacts.length).toBeGreaterThan(0); // lecture des contacts permise

    const parProprietaire = await request(app).get('/api/recherche?q=Zebulon').set(bearer(admin.token));
    expect(parProprietaire.body.devis.length).toBeGreaterThan(0);
  });

  test('le propriétaire n’est jamais bloqué ni journalisé', async () => {
    const avant = await compter(admin.entrepriseId, 'contacts', 'creer');
    const res = await request(app).post('/api/contacts').set(bearer(admin.token))
      .send({ nom: 'Client du propriétaire', estClient: true });
    expect(res.status).toBe(201);
    expect(await compter(admin.entrepriseId, 'contacts', 'creer')).toBe(avant);
  });

  test('PERMISSIONS_MODE=observation : interrupteur de repli, journalise sans refuser', async () => {
    process.env.PERMISSIONS_MODE = 'observation';
    try {
      const res = await request(app).post('/api/contacts').set(bearer(employe.token))
        .send({ nom: 'Client en observation', estClient: true });
      expect(res.status).toBe(201);
    } finally {
      delete process.env.PERMISSIONS_MODE;
    }
  });
});

describe('GET /api/roles/mes-restrictions', () => {
  test('renvoie les restrictions de l’utilisateur connecté, même privé de « roles/lire »', async () => {
    const admin = await registerEntreprise();
    const employe = await createEmployeeLogin(admin.token, 'ouvrier');

    const libre = await request(app).get('/api/roles/mes-restrictions').set(bearer(employe.token));
    expect(libre.status).toBe(200);
    expect(libre.body).toMatchObject({ proprietaire: false, roleId: null, restrictions: {} });

    const roleId = await restreindre(admin.entrepriseId, await idUtilisateur(employe.email), 'Lecture seule partielle', [
      ['devis', 'lire'], ['devis', 'creer'], ['roles', 'lire'],
    ]);
    const restreint = await request(app).get('/api/roles/mes-restrictions').set(bearer(employe.token));
    expect(restreint.status).toBe(200);
    expect(restreint.body.roleId).toBe(roleId);
    expect(restreint.body.roleNom).toBe('Lecture seule partielle');
    expect(restreint.body.restrictions).toEqual({ devis: ['creer', 'lire'], roles: ['lire'] });

    const proprio = await request(app).get('/api/roles/mes-restrictions').set(bearer(admin.token));
    expect(proprio.body).toMatchObject({ proprietaire: true, restrictions: {} });
  });
});

describe('Compte désactivé', () => {
  test('le jeton d’un salarié désactivé ne donne plus accès à rien (401), réactivé il refonctionne', async () => {
    const admin = await registerEntreprise();
    const employe = await createEmployeeLogin(admin.token, 'ouvrier');

    const avant = await request(app).get('/api/contacts').set(bearer(employe.token));
    expect(avant.status).toBe(200);

    const desactiver = await request(app).delete(`/api/salaries/${employe.salarieId}`).set(bearer(admin.token));
    expect(desactiver.status).toBe(200);

    // Même jeton, toujours valide cryptographiquement : refusé immédiatement (cache invalidé).
    for (const chemin of ['/api/contacts', '/api/auth/me', '/api/salaries/moi']) {
      const res = await request(app).get(chemin).set(bearer(employe.token));
      expect(res.status).toBe(401);
      expect(res.body.reason).toBe('compte_desactive');
    }

    const reactiver = await request(app).put(`/api/salaries/${employe.salarieId}`).set(bearer(admin.token)).send({ statut: 'Actif' });
    expect(reactiver.status).toBe(200);
    const apres = await request(app).get('/api/contacts').set(bearer(employe.token));
    expect(apres.status).toBe(200);
  });

  test('le compte propriétaire ne peut pas être désactivé', async () => {
    const admin = await registerEntreprise();
    const { rows: [u] } = await pool.query('SELECT id FROM users WHERE email = $1', [admin.email.toLowerCase()]);
    const { rows: [s] } = await pool.query(
      "INSERT INTO salaries (entreprise_id, user_id, nom, prenom, statut) VALUES ($1, $2, 'Proprio', 'Test', 'Actif') RETURNING id",
      [admin.entrepriseId, u.id]
    );
    const res = await request(app).delete(`/api/salaries/${s.id}`).set(bearer(admin.token));
    expect(res.status).toBe(400);
    const me = await request(app).get('/api/auth/me').set(bearer(admin.token));
    expect(me.status).toBe(200);
  });
});

describe('Lecture des restrictions impossible', () => {
  test('autoriseUtilisateur refuse une résolution absente ou en erreur (fail closed)', () => {
    expect(autoriseUtilisateur(null, 'contacts', 'lire')).toBe(false);
    expect(autoriseUtilisateur({ erreur: true, restrictions: {} }, 'contacts', 'lire')).toBe(false);
  });
});

describe("Appariement d'URL vers motif de route", () => {
  const apparier = creerAppariementChemin(app);

  test('une URL concrète retrouve son motif', () => {
    expect(apparier('POST', '/api/devis/42/facturer')).toBe('/api/devis/:id/facturer');
    expect(apparier('PUT', '/api/cultures/parcelles/7')).toBe('/api/cultures/parcelles/:id');
  });

  test('une route littérale prime sur un motif à paramètre', () => {
    // `/api/devis/ledger` est déclaré avant `/api/devis/:id` : si l'inventaire était trié,
    // « ledger » serait pris pour un identifiant et la permission résolue serait fausse.
    expect(apparier('GET', '/api/devis/ledger')).toBe('/api/devis/ledger');
    expect(apparier('GET', '/api/factures/grand-livre')).toBe('/api/factures/grand-livre');
  });

  test('la chaîne de requête est ignorée', () => {
    expect(apparier('GET', '/api/produits?module=Cultures')).toBe('/api/produits');
  });

  test('une URL inconnue ne correspond à rien', () => {
    expect(apparier('GET', '/api/inexistant')).toBeNull();
  });
});
