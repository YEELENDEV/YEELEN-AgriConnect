// Fabriques partagées par les tests d'intégration. Chaque test crée ses propres
// entreprises/comptes jetables (emails uniques) ; la base entière est détruite par
// globalTeardown, donc pas de nettoyage inter-test nécessaire.
import request from 'supertest';
import app from '../../app.js';
import { pool } from '../../db.js';
import { invaliderCacheAbonnement } from '../../middleware/subscriptionGuard.js';
import { viderCacheRoles } from '../../utils/rolesService.js';

export { app, pool, request };

const ACTIONS_ECRITURE = ['creer', 'modifier', 'supprimer', 'valider', 'facturer', 'receptionner', 'encaisser'];

// Rattache l'utilisateur `email` à un rôle d'entreprise qui lui RETIRE les écritures (création,
// modification, suppression et actions sensibles) sur les ressources données, la lecture restant
// permise. C'est ainsi qu'une entreprise ferme quelque chose depuis le retrait des `requireRole`
// (2026-11-11) : les tests de « l'ouvrier reçoit 403 » passent désormais par ce mécanisme réel.
export async function restreindreEcritures(entrepriseId, email, ressources, actions = ACTIONS_ECRITURE) {
  const { rows: [u] } = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  seq += 1;
  const { rows: [role] } = await pool.query(
    'INSERT INTO roles (entreprise_id, nom) VALUES ($1, $2) RETURNING id',
    [entrepriseId, `Lecture seule ${ressources.join(', ')} #${seq}-${Date.now()}`]
  );
  for (const ressource of ressources) {
    for (const action of actions) {
      await pool.query('INSERT INTO role_restrictions (role_id, ressource, action) VALUES ($1, $2, $3)', [role.id, ressource, action]);
    }
  }
  await pool.query('UPDATE entreprise_utilisateurs SET role_id = $1 WHERE entreprise_id = $2 AND user_id = $3', [role.id, entrepriseId, u.id]);
  viderCacheRoles();
  return role.id;
}

let seq = 0;
export function uniqueEmail(prefix = 'it') {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}@test.local`;
}

// Enregistre une entreprise + son compte admin. Renvoie de quoi agir en son nom.
//
// `opts.ip` : IP synthétique envoyée via X-Forwarded-For. Par défaut, une IP UNIQUE dérivée
// du compteur `seq` — indispensable depuis l'abonnement Phase 1 (2026-09-04, limite de 3
// inscriptions/24h par IP, voir routes/auth.js) : sans ça, toutes les entreprises jetables
// créées par la suite de tests partageraient la même IP de boucle locale et se bloqueraient
// mutuellement au bout de 3 appels. Un test qui veut délibérément vérifier la limite passe
// la même `opts.ip` à plusieurs appels successifs.
export async function registerEntreprise(opts = {}) {
  const email = opts.email || uniqueEmail('admin');
  const password = opts.password || 'Passw0rd!';
  seq += 1;
  // Date.now() (pas seulement seq) : `seq` repart de 0 dans CHAQUE fichier de test (module
  // isolé par Jest), mais tous les fichiers partagent la même base/le même audit_log durant
  // toute la suite — une IP dérivée du seul `seq` collision entre fichiers (deux "10.0.0.1"
  // distincts au sens de audit_log.ip_address = même compteur de limite). L'horloge réelle
  // n'est, elle, jamais réinitialisée.
  // Une part aléatoire en plus de l'horloge et du compteur. POST /register limite les
  // inscriptions par adresse IP (429) : deux fichiers de test qui démarrent dans la même
  // milliseconde tombaient sur la même IP, avec le même compteur de limite, et la suite
  // échouait sur des tests apparemment sans rapport — un describe entier tombe dès que son
  // beforeAll n'obtient pas de compte. Fragilité préexistante, rendue atteignable en ajoutant
  // des tests : le seul fait de décaler les temps de démarrage suffit à provoquer la
  // coïncidence. Avec un tirage aléatoire sur 2^24, elle redevient négligeable.
  const n = ((Date.now() + seq) ^ Math.floor(Math.random() * 16777216)) % 16777216; // 256^3
  const ip = opts.ip || `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
  const res = await request(app).post('/api/auth/register').set('X-Forwarded-For', ip).send({
    email,
    password,
    nomEntreprise: opts.nomEntreprise || `IT ${Date.now()}-${seq}`,
    typeCompte: 'entreprise',
    telephone: '+22300000000',
    pays: 'ML',
    numeroTva: 'ML00000000',
    adresse: 'Adresse de test',
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`register a échoué (${res.status}): ${JSON.stringify(res.body)}`);
  }
  // Inscription à deux étapes (2026-09-06, voir routes/auth.js:confirmer-inscription) :
  // /register ne renvoie plus de token, seulement { confirmationRequired, email }. Les tests
  // n'ont pas accès à l'email réel envoyé (EMAIL_* est blanchi en env de test, voir env.js) —
  // on confirme directement en base (même logique d'accès direct que
  // setEntrepriseSubscription plus bas) plutôt que dériver le code HOTP ici, puis on se
  // connecte pour obtenir le token.
  await pool.query(
    `UPDATE entreprises SET email_confirme = TRUE
     WHERE id = (SELECT eu.entreprise_id FROM entreprise_utilisateurs eu
                 JOIN users u ON u.id = eu.user_id
                 WHERE LOWER(u.email) = LOWER($1) LIMIT 1)`,
    [email]
  );
  const login = await request(app).post('/api/auth/login').send({ email, password });
  if (login.status !== 200 || !login.body.token) {
    throw new Error(`login après inscription a échoué (${login.status}): ${JSON.stringify(login.body)}`);
  }
  // Blocage d'accès par module (2026-09-07, voir middleware/moduleGuard.js) : une entreprise
  // fraîchement inscrite démarre avec modules_actifs = {} — sans ça, la quasi-totalité des
  // suites de test existantes (qui supposent un accès complet dès l'inscription) échouerait.
  // Par défaut, les 3 modules payants sont activés ; `opts.modulesActifs` permet de passer un
  // état différent (ex. `{}` pour les tests qui testent le blocage lui-même). Écriture directe
  // en base (même logique que email_confirme plus haut) plutôt qu'un appel PUT
  // /entreprise/modules : plus rapide, et le cache de moduleGuard est de toute façon vide à ce
  // stade (aucune route gatée n'a encore été appelée pour cette entreprise).
  const modulesActifs = opts.modulesActifs || { cultures: true, poulailler: true, pisciculture: true };
  await pool.query(
    'UPDATE entreprises SET modules_actifs = $1::jsonb WHERE id = $2',
    [JSON.stringify(modulesActifs), login.body.entreprise?.id]
  );
  return {
    token: login.body.token,
    email,
    password,
    entrepriseId: login.body.entreprise?.id,
    userId: login.body.user?.id,
  };
}

// Crée un compte de connexion + une fiche salarié dans l'entreprise de `adminToken`
// (via POST /api/salaries, branche createAccount) puis connecte cet employé.
// Renvoie { token, email, role, salarieId } — salarieId sert aux routes /salaries/:id/*.
export async function createEmployeeLogin(adminToken, role = 'ouvrier', extra = {}) {
  const compteEmail = uniqueEmail(role);
  const password = 'Passw0rd!';
  const res = await request(app)
    .post('/api/salaries')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ nom: 'Test', prenom: role, createAccount: true, compteEmail, password, role, ...extra });
  if (res.status !== 201) {
    throw new Error(`création employé a échoué (${res.status}): ${JSON.stringify(res.body)}`);
  }
  const salarieId = res.body.salarie?.id;

  // `role` ne sert plus qu'à nommer l'email : depuis le retrait des `requireRole` (2026-11-11), le
  // rôle texte ne décide plus rien côté serveur. Pour restreindre ce compte, voir
  // restreindreEcritures() ci-dessus. (L'ancien pont qui écrivait ce texte en base est retiré.)
  const login = await request(app).post('/api/auth/login').send({ email: compteEmail, password });
  if (login.status !== 200 || !login.body.token) {
    throw new Error(`login employé a échoué (${login.status}): ${JSON.stringify(login.body)}`);
  }
  return { token: login.body.token, email: compteEmail, role, salarieId };
}

// Crée un contact client et renvoie son id.
export async function createClient(token, nom = `Client ${Date.now()}`) {
  const res = await request(app)
    .post('/api/contacts')
    .set('Authorization', `Bearer ${token}`)
    .send({ nom, estClient: true });
  if (res.status !== 201) {
    throw new Error(`création contact a échoué (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.contact.id;
}

// Crée une parcelle et renvoie son id.
export async function createParcelle(token, nom = `Parcelle ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`) {
  const res = await request(app)
    .post('/api/cultures/parcelles')
    .set('Authorization', `Bearer ${token}`)
    .send({ nom, culture: 'Maïs' });
  if (res.status !== 201) {
    throw new Error(`création parcelle a échoué (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.parcelle.id;
}

// Crée un produit (stock) rattaché à une catégorie seedée à la création de l'entreprise.
// Renvoie { id, categorieId, nom }.
export async function createProduit(token, { module = 'Cultures', nom, prixDefaut, uniteId } = {}) {
  const cats = await request(app)
    .get(`/api/produit-categories?module=${module}`)
    .set('Authorization', `Bearer ${token}`);
  const categorieId = cats.body.categories?.[0]?.id;
  if (!categorieId) throw new Error(`aucune catégorie ${module} seedée: ${JSON.stringify(cats.body)}`);
  const produitNom = nom || `Article ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const res = await request(app)
    .post('/api/produits')
    .set('Authorization', `Bearer ${token}`)
    .send({ module, nom: produitNom, categorieId, prixDefaut, uniteId });
  if (res.status !== 201) {
    throw new Error(`création produit a échoué (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return { id: res.body.stock.id, categorieId, nom: produitNom };
}

// Abonnement Phase 1 (2026-09-04) : "avance le temps" d'une entreprise de test en écrivant
// directement les colonnes d'abonnement — pas d'appel HTTP, il n'existe (et n'existera) aucune
// route pour falsifier des dates arbitraires en dehors des tests. `null` efface explicitement
// une colonne (utile pour simuler un essai jamais démarré ou une entreprise déjà activée).
export async function setEntrepriseSubscription(entrepriseId, { status, trialEndsAt, activatedUntil, graceUntil } = {}) {
  const champs = [];
  const valeurs = [];
  let i = 1;
  if (status !== undefined) { champs.push(`subscription_status = $${i++}`); valeurs.push(status); }
  if (trialEndsAt !== undefined) { champs.push(`trial_ends_at = $${i++}`); valeurs.push(trialEndsAt); }
  if (activatedUntil !== undefined) { champs.push(`activated_until = $${i++}`); valeurs.push(activatedUntil); }
  if (graceUntil !== undefined) { champs.push(`grace_until = $${i++}`); valeurs.push(graceUntil); }
  if (champs.length === 0) return;
  valeurs.push(entrepriseId);
  await pool.query(`UPDATE entreprises SET ${champs.join(', ')} WHERE id = $${i}`, valeurs);
  // Le guard cache 60s par entreprise (voir subscriptionGuard.js) — sans cette invalidation,
  // une requête faite juste avant cet appel (ex: registerEntreprise() lui-même) laisserait le
  // guard lire l'ancien état pendant jusqu'à une minute, masquant l'effet de ce changement.
  invaliderCacheAbonnement(entrepriseId);
}
