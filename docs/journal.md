# Journal de développement — YEELEN AgriConnect

Historique daté des correctifs, décisions techniques et chantiers livrés.
Extrait de `CLAUDE.md` le 2026-08-28 pour alléger le contexte chargé à chaque session.

---

### Audit sécurité + bascule des restrictions en refus réel (étape 3b) — 2026-11-11

Demande de l'utilisateur : revoir tout le code, retirer l'inutile et le redondant, « sécuriser au
maximum ». Le détail des correctifs de l'audit (secret JWT par défaut chargé hors Docker, XSS des
fenêtres d'impression, re-signature d'un devis facturé, secrets copiés dans l'image Docker, force
brute, MFA, CORS, en-têtes, délais réseau…) est résumé dans `CLAUDE.md`, section « Security
conventions ». Puis, sur accord explicite (« Oui, fais-le ici »), la **bascule en refus** :

- **`permissionGuard` refuse** désormais (403 `{error, reason:'restriction', ressource, action}`,
  message lisible tiré du catalogue) toute action que le rôle de l'utilisateur s'est vu retirer.
  Journal `permission_refusee` (une ligne par rôle × permission et par process). Modèle inchangé :
  tout ouvert par défaut, le propriétaire n'est jamais restreint, une route hors carte est permise.
  Interrupteur de repli d'urgence : `PERMISSIONS_MODE=observation`.
- **Comptes désactivés** : la résolution des restrictions lit maintenant
  `entreprise_utilisateurs.statut`. Avant, un salarié désactivé gardait un accès complet avec son
  jeton déjà émis (valide 7 jours). Désormais 401 `compte_desactive` sur toute route authentifiée
  (sauf les routes publiques d'authentification), cache invalidé immédiatement par
  `DELETE`/`PUT /salaries/:id`. Le propriétaire ne peut plus être désactivé (400).
- **Fail closed** : restrictions illisibles (base indisponible) → 503, et l'erreur n'est plus
  mise en cache 60 s. Le repli « tout ouvert si la base est muette » — que l'étape 3a disait déjà
  devoir disparaître à la bascule — est retiré.
- **Recherche globale** (`GET /api/recherche`) : chaque groupe (contacts/produits/devis) est filtré
  selon le droit « lire » de sa ressource ; elle contournait les restrictions. Jokers `%`/`_`
  échappés, requête bornée à 100 caractères.

**Délibérément NON fait — décision laissée à l'utilisateur** : le retrait des 63 `requireRole`.
Ils ne restreignent plus les comptes créés depuis le 2026-09-13 (rôle texte neutre `admin`), mais
bloquent encore les comptes plus anciens (en base de dev : 2 comptes « comptable » actifs, sans
rôle d'entreprise). Les retirer leur ouvrirait d'un coup les routes d'administration ; c'est
cohérent avec « tout ouvert par défaut » mais c'est une ouverture de droits, à décider
explicitement. **Toujours vrai et à garder en tête** : un salarié créé sans rôle d'entreprise a
tous les droits (choix produit « page blanche ») ; le propriétaire doit lui affecter un rôle pour
le restreindre.

**Retrait des 62 `requireRole` (même jour, sur décision explicite : « Oui, retire-les »).**
Fin de la couche historique côté serveur : plus aucun code ne lit `req.user.role`.
`middleware/requireRole.js` supprimé ; les tableaux `ecriture` des routes ne contiennent plus que
`authRequired`. **Conséquence assumée** : les comptes antérieurs au 2026-09-13 portant un rôle
texte (`comptable`, `ouvrier`… — 2 comptes « comptable » actifs en base de dev) obtiennent les
mêmes droits qu'un compte sans rôle d'entreprise, c'est-à-dire tout, tant que le propriétaire ne
leur affecte pas un rôle restreint.
- `salaries.js` : `isAdmin` (rôle texte) retiré. `resolveAccessibleSalarie` ne garantit plus que
  le cloisonnement par entreprise (les restrictions décident du reste). La règle « on ne décide
  pas de sa propre demande de congé » devient `estSaPropreDemande` : seule exception, le manager
  ou le propriétaire. **Faille au passage** : l'ancienne règle était levée par le rôle texte
  `admin` — que portent tous les comptes créés depuis le 2026-09-13 — donc n'importe quel salarié
  récent pouvait approuver ses propres congés.
- Tests : le pont de `helpers.js` qui écrivait le rôle texte en base est retiré ; les 21 tests
  « l'ouvrier reçoit 403 » passent par `restreindreEcritures(entrepriseId, email, ressources)`,
  qui affecte un vrai rôle d'entreprise retirant les écritures sur la ressource visée. Ils
  vérifient donc désormais aussi que chaque route est reliée à la bonne ressource du catalogue.
- **Frontend aligné (même jour, « Oui, aligne-les »)** : `src/components/roles.js`
  (`ROLE_DEFINITIONS`, listes d'onglets codées en dur par rôle) et son test sont supprimés ;
  l'état `role` d'`App` aussi. Seules les restrictions du rôle d'entreprise décident : onglets
  (déjà filtrés), « Gérer les options » (`modules_actifs/modifier`), boutons de gestion RH
  (`salaries/modifier`), fiche entreprise et localisation (`entreprise/modifier`), compte bancaire
  principal (`banques/modifier`), Surveillance/Équipements (`cameras|equipements/creer`).
  L'assistant de configuration n'est plus proposé qu'au **propriétaire** (avant : rôle texte
  admin/directeur, donc chez chaque salarié récent). Menu utilisateur : nom du rôle d'entreprise,
  « Propriétaire » ou « Aucun rôle » (nouveau champ `roleNom` de `mes-restrictions`) ; la liste
  des employés affiche aussi le rôle d'entreprise (`roleNom`) au lieu du texte. Vérifié dans le
  navigateur avec trois comptes jetables (ancien « comptable » sans rôle → tout visible et
  « Aucun rôle » ; rôle restreint → arrivée sur l'accueil, boutons RH masqués, fiche entreprise
  en lecture seule, zéro 403 ; propriétaire → « Propriétaire »), supprimés ensuite. Le rôle texte
  n'est plus lu nulle part ; la colonne et le champ du jeton restent, inertes.

**Masquage des écrans non consultables (même jour, sur demande : « Oui, masque-les »).**
- `GET /api/roles/mes-restrictions` (hors catalogue, sinon un rôle privé de `roles/lire` ne
  connaîtrait pas ses propres restrictions) → `{ proprietaire, roleId, restrictions }`.
- `src/lib/restrictions.jsx` : contexte React + `RESSOURCES_ONGLETS` (écran de navigation →
  ressources dont la lecture conditionne l'affichage ; `ressources` = toutes requises, `uneParmi`
  = au moins une, pour les modules composés Cultures/Poulailler/Pisciculture). Les onglets internes
  de ces modules portent leurs propres `ressources` ; `ModuleTabBar` les filtre et bascule sur le
  premier onglet visible si l'actif disparaît. Navbar, menu mobile et grille d'accueil suivent.
- `App` charge les restrictions à chaque changement d'utilisateur, les relit au retour sur l'onglet
  du navigateur et à chaque 403 `restriction` (événement `agri-restrictions-changed` émis par
  `api.js`), et retient le contenu des écrans le temps de la première lecture.
- `HomeOverview` / `NotificationsModule` n'interrogent que les sources consultables (un seul 403
  vidait tout le tableau de bord) et masquent les cartes correspondantes plutôt que d'afficher 0.

**Vérifié dans le navigateur intégré** (Vite + backend Docker reconstruit, entreprise jetable
supprimée ensuite) avec un salarié privé de la lecture de contacts/devis/finances/factures/
salariés/parcelles/achats : catégories Commercial et Finance absentes, Cultures réduit à
Stocks + Registre (bascule automatique depuis Parcelles), Poulailler sans Ventes/Achats/
Comptabilité, URL directe vers un écran masqué → accueil. **Trois défauts trouvés à l'écran et
corrigés** (invisibles aux tests unitaires) : (1) à la restauration de session `user` reste
`null` le temps de `/auth/me`, l'attente se fonde donc sur le jeton ; (2) chaque relecture
recréait un objet identique et relançait les chargements de tous les écrans — l'ancien objet est
conservé si le contenu est inchangé ; (3) un écran masqué demandé par URL se montait une fois
avant la redirection — seul un onglet présent dans `availableTabs` est rendu. Résultat mesuré :
**zéro 403** au chargement des écrans testés. Le propriétaire voit tout.

---

### Rôles par entreprise — retrait du niveau d'accès imposé — 2026-09-13

Sur demande de l'utilisateur : « enlève l'ancien sélecteur de rôle ». Il y en avait **deux** — la
création d'un salarié, et le rattachement d'un compte à un salarié existant — chacun proposant les
six rôles en dur. Les deux sont partis. Le formulaire ne demande plus qu'un rôle : celui que
l'entreprise a défini, avec « Aucun rôle — aucune restriction » par défaut.

**Conséquence, dite franchement.** Ce sélecteur alimentait la colonne texte que lisent le jeton,
les 63 `requireRole` et les onglets du frontend. Sans lui, il faut y écrire quelque chose, et la
seule valeur cohérente avec « tout ouvert par défaut » est celle qui ne bloque rien
(`ROLE_TEXTE_NEUTRE`). Autrement dit : **la couche historique ne restreint plus personne sur les
comptes créés désormais.** Elle n'est plus que du code en attente de retrait. La finir — ôter les
63 gardes et passer les restrictions en refus réel — est la suite logique.

**Correction d'un conseil donné le matin même.** J'avais recommandé d'attendre plusieurs jours
d'observation avant la bascule, au motif qu'une carte incomplète enfermerait des utilisateurs
dehors. C'était vrai du modèle rejeté (n'autoriser que ce qui est accordé) ; dans le modèle
retenu, une route absente de la carte est **autorisée**. Le risque qui justifiait d'attendre
n'existe plus.

**Trois bugs de ma main, dans le même changement** — tous du même genre : retirer une variable
sans suivre ses usages.
1. `role` encore référencé dans la validation de `POST /salaries` → `ReferenceError` à chaque
   création de compte. Toute la suite d'intégration est passée de 150 s à **1093 s** (chaque
   appel partait en 500 avant d'échouer), 50 tests rouges.
2. Deux autres références oubliées : le journal d'audit, et tout le chemin de rattachement.
3. `roleIdValide` déclaré **dans** le premier bloc `if (createAccount)` mais lu dans le second,
   après le commit — hors de portée, donc 500 de nouveau.

**Et deux diagnostics faux avant de trouver.** J'ai d'abord attribué les échecs aux tests de rôle,
puis au helper, sans jamais lire la sortie complète — que j'avais tronquée avec un `tail`. La
cause réelle (un 500 sur `POST /salaries`) était visible dès la première ligne d'un seul fichier
de test. Vérifier avant de déduire, y compris quand la déduction paraît évidente.

**Pont assumé dans `helpers.js`** : le helper de test pose désormais le rôle texte directement en
base après création, pour que les dizaines de tests de la couche historique continuent de
l'exercer jusqu'à son retrait. Le commentaire le dit et signale que ce contournement doit
disparaître avec elle.

**481/481 tests d'intégration**, `npm test` (142/142), build vert, vérifié à l'écran : le
formulaire ne montre plus qu'un seul sélecteur de rôle.

---

### Rôles par entreprise — le panneau rejoint les Ressources humaines — 2026-09-13

Retour de l'utilisateur sur la démonstration : « tu l'as mis dans Mes préférences, il serait
mieux que l'option soit présentée lors de la configuration de l'entreprise, et dans les
ressources humaines lors de la création d'un nouveau salarié ».

Le panneau quitte Mes préférences pour la tête de l'écran Employés. Un seul déplacement suffit
pour les deux emplacements demandés : l'écran d'accueil des salariés, pendant la configuration
de l'entreprise, rend déjà `EmployeesModule` — le panneau y apparaît donc automatiquement.

**Ce que ce retour a mis au jour.** Le formulaire de création de salarié imposait toujours les
six rôles en dur (`Administrateur`, `Directeur`, `Gestionnaire`…), c'est-à-dire exactement ce qui
avait été refusé, mais à un endroit que je n'avais pas suivi. Un sélecteur « Rôle (restrictions) »
le rejoint, alimenté par les rôles **de l'entreprise**, avec « Aucun rôle — aucune restriction »
en choix par défaut. `POST /api/salaries` accepte désormais `roleId`, validé contre l'entreprise
pour qu'on ne puisse rattacher personne au rôle d'une autre.

**Deux sélecteurs côte à côte, et c'est laid — mais volontaire.** L'ancien (« Rôle : Ouvrier »)
alimente encore la couche historique : la colonne texte du JWT, les 63 `requireRole` et les
onglets de navigation du frontend. Le supprimer maintenant ouvrirait d'un coup les 33 routes
réservées à l'administrateur. Il disparaîtra à la bascule, en même temps que cette couche.

**Trois faux pas de tournage, tous dus au shell**, notés parce qu'ils se répètent : un gabarit de
chaîne imbriqué dans une commande `node -e` s'est fait manger trois fois par bash (une fois
laissant `page.goto()` sans argument). Passer par l'outil d'édition de fichier plutôt que par la
ligne de commande règle le problème. Et l'insertion heuristique du panneau avait atterri sur un
`return` intérieur d'`EmployeesModule` — repéré par un échec de build, corrigé en visant le
conteneur de premier niveau, qui se trouvait déjà être une colonne.

Vérifié dans un vrai Chromium sur les deux écrans. **481/481 tests d'intégration**, `npm test`
(142/142) et build verts.

---

### Rôles par entreprise — l'écran d'administration — 2026-09-13

L'utilisateur : « fait une démo je vais voir si c'est bien ce que je veux ». Le mécanisme vivait
en base et restait invisible : pour être jugé, il lui fallait un écran. C'est le cœur de
l'étape 4, construit dans la foulée.

**`server/src/routes/roles.js`** — catalogue du vocabulaire, liste des rôles avec leurs retraits
et le nombre de personnes concernées, création, renommage, suppression, remplacement des
restrictions, affectation. Une seule garde d'accès, et elle ne vient pas d'une politique :
`proprietaireRequis`, parce que le compte qui a ouvert l'entreprise administre la serrure. Deux
règles fines : on refuse d'attribuer un rôle au propriétaire (il n'y serait pas soumis, et
l'afficher mentirait), et supprimer un rôle **libère** les personnes rattachées au lieu de les
enfermer — `ON DELETE SET NULL`, elles redeviennent non restreintes, c'est le défaut du produit.

**`src/components/RolesPanel.jsx`** — dans Mes préférences, en pleine largeur (la matrice
ressources × actions n'entre pas dans une colonne de 280 px). Le principe doit sauter aux yeux :
tout est ouvert, **on coche ce qu'on retire**. Les cases sont rouges, l'en-tête dit « cochez ce
que ce rôle ne doit PAS pouvoir faire », et une action sensible n'est proposée que sur les
ressources où elle existe — ailleurs un tiret, plutôt que de faire cocher du vide.

**Le garde-fou de l'étape 1 a servi tout de suite** : les six routes neuves ont fait échouer le
test de couverture tant qu'elles n'étaient pas déclarées au catalogue. Exactement ce pour quoi il
a été écrit.

**Vérifié dans un vrai Chromium** (les deux outils navigateur de la session étant tombés,
Playwright a pris le relais) : panneau affiché, rôle « Comptabilité seule » créé, huit retraits
cochés et enregistrés, affectation changée. Recoupé en base — les neuf lignes de
`role_restrictions` correspondent aux cases cochées.

10 tests d'intégration sur les routes, dont la garde de propriété sur les quatre points
d'écriture. **481/481**, zéro régression.

**Dette assumée** : les libellés de `RolesPanel.jsx` sont en français dans le composant, i18n
volontairement différée tant que la forme de l'écran n'est pas validée — traduire quarante
chaînes d'un écran qui peut être refait serait du travail jeté. À faire avant mise en production.

---

### Rôles par entreprise — page blanche et restrictions — 2026-09-13

Correction de cap demandée par l'utilisateur, le jour même : « il ne doit pas y avoir de
restrictions écrites en dur dans l'application ; les sections doivent être toutes ouvertes par
défaut, l'entreprise choisira sa politique ». Puis, en précision : **page blanche**, le compte
qui ouvre l'entreprise en reste le **maître**, et il créera ensuite ses rôles selon la
constitution de son entreprise.

J'avais codé six rôles avec leurs restrictions **en dur** (`rolesParDefaut.js`) — c'était
exactement ce qui est refusé : l'application décidait qu'un ouvrier ne voit pas les clients. Ce
fichier est supprimé.

**Le modèle s'inverse.** Un rôle n'est plus une liste de ce qui est *permis* mais de ce qui est
*retiré* : `role_permissions` devient `role_restrictions`. Trois règles, et rien d'autre :

1. Le **propriétaire** (`entreprises.proprietaire_user_id`, le compte créateur) garde tout,
   définitivement. Aucune restriction ne lui est opposable — sans quoi une entreprise peut se
   verrouiller dehors sans recours.
2. Un utilisateur **sans rôle** n'a aucune restriction : tout est ouvert.
3. Un **rôle** est ouvert lui aussi, et ne ferme que ce que l'entreprise lui retire.

**Distinction qui a permis de tout concilier.** Je confondais deux axes :
- la **complétude de la carte** — toute route doit être déclarée. Discipline de développeur,
  tenue par le test d'intégration. Elle reste, et c'est elle qui garantit qu'aucune route
  n'échappe au système ;
- la **politique par défaut** — tout ouvert. Choix de l'entreprise, désormais le sien.

On a donc « tout ouvert par défaut » sans perdre la garantie qu'aucune route ne passe à travers.

**Ce qui survit du travail du matin** : le catalogue (43 ressources, 8 actions), la carte des 300
routes, l'inventaire et son test, les tables, le cache. C'est du vocabulaire et de la mécanique,
pas de la politique. **Ce qui disparaît** : les six politiques imposées, leur amorçage dans
`migrate.js` et `register`, le rattachement automatique par code dans `salaries.js`, et les
colonnes `roles.code` / `roles.administration` qui ne portaient que cette idée.

**Nettoyage des données déjà semées.** La migration du matin avait créé 60 rôles et 11 080 lignes
de permissions sur 10 entreprises. Vérifié avant suppression : tous créés en 21 secondes par
cette migration, **aucun modifié** (aucun écran ne le permettait), donc les retirer restaure
exactement l'état antérieur. `nettoyerRolesImposes` ne supprime qu'un rôle **sans aucune
restriction** et portant l'un des six noms d'origine — une entreprise qui aurait entre-temps créé
un rôle homonyme avec des restrictions n'est pas touchée.

**Vérifié en conditions réelles**, backend reconstruit, avec le compte ouvrier de démonstration :
- sans rôle → `POST /api/contacts` **201**, `GET /api/salaries` **200**, **zéro** ligne au
  journal. Tout est ouvert et silencieux.
- après création d'un rôle « Saisie terrain » retirant `contacts/creer` → la requête passe
  toujours (**201**, mode observation) et est journalisée `restriction_entreprise` ; l'action non
  retirée ne produit rien.

Base après migration : **0 rôle, 0 restriction, 10 propriétaires rattachés**, table
`role_permissions` supprimée. Second passage : « rien à rattacher », « rien à retirer ».

**471/471 tests d'intégration**, zéro régression (477 avant : les deux fichiers de tests décrivant
l'ancien modèle sont remplacés par un seul, plus resserré). Tests notables : une entreprise qui
s'inscrit n'a **aucun** rôle ; un utilisateur sans rôle n'est pas restreint ; une restriction
posée est suivie et seule l'action retirée est fermée ; **aucune restriction ne s'applique au
propriétaire**, même en lui affectant un rôle piégé ; un rôle renommé garde ses restrictions.

**Reste à faire** : la bascule en refus (quand le journal aura du vrai usage), et l'écran qui
met ces options à disposition — créer un rôle, cocher ce qu'on retire, affecter les gens.

---

### Rôles par entreprise — étape 3a : les rôles vivent en base — 2026-09-13

Étape 3 **découpée en deux**. Le journal d'observation ne contenait que mes deux entrées de test
de fumée : aucun usage réel accumulé, donc aucune matière pour décider de la bascule. Le socle
est sans risque et ne dépend pas de ces données ; le refus par défaut en dépend entièrement.
D'où 3a maintenant, 3b plus tard.

**Schéma.** `roles` (entreprise_id, code, nom, description, administration) et `role_permissions`
(role_id, ressource, action), plus `entreprise_utilisateurs.role_id`. `code` garde la trace des
six rôles amorcés et **survit au renommage** — c'est ce qui permet de retrouver la correspondance
avec la colonne texte pendant la transition. La colonne `role` est conservée : elle reste la
source du JWT et le repli. Index unique sur `(entreprise_id, lower(nom))` : deux rôles de même
nom dans une entreprise n'auraient aucun sens.

**Amorçage.** `migrate.js:seedRolesParDefaut` pour les entreprises existantes, et le même
amorçage dans `register` pour les nouvelles — le créateur est rattaché à Administrateur dans la
foulée. Les deux points de création de compte salarié (`POST /salaries` et `PUT /salaries/:id`)
posent aussi `role_id` par correspondance de code. Exécuté sur la base réelle : **10 entreprises
amorcées, 16 utilisateurs rattachés**, puis « rien à amorcer » au second passage — idempotent
vérifié, pas supposé.

**`utils/rolesService.js`.** Le garde lit désormais la base. Le JWT porte le rôle sous forme de
texte figé à la connexion : dès lors qu'une entreprise peut renommer ses rôles et en changer les
permissions, ce texte n'est plus une source fiable. Même situation que les modules payants, même
réponse — cache à TTL 60 s, invalidable explicitement. Repli sur `rolesParDefaut.js` quand
`role_id` est absent ou que la lecture échoue ; **ce repli devra disparaître à la bascule**,
continuer à accorder des permissions quand la base est muette serait le contraire du but.
L'origine (`base` ou `defaut`) est journalisée, ce qui rend la transition observable.

**Vérifié en conditions réelles**, backend reconstruit, avec le compte ouvrier de démonstration :
`POST /api/contacts` → **201**, journalisé avec `origine: base` ; `POST /api/observations` →
**201**, non journalisé puisque le rôle Ouvrier porte bien cette permission en base. La décision
vient donc de la base, et rien n'est bloqué.

**Le test qui porte le chantier** : « une entreprise peut redéfinir ses règles, et le garde
suit ». On observe l'écart, on insère la permission manquante dans `role_permissions`, on vide le
cache — et l'écart disparaît. C'est la preuve que la décision vient de la donnée et non d'un
fichier, donc que l'entreprise a réellement la main. Un autre test vérifie qu'un rôle **renommé**
(« Ouvrier » → « Chef de culture ») garde ses permissions : le nom appartient à l'entreprise, la
règle reste attachée au rôle.

**Piège rencontré pour la cinquième fois** : backticks dans des commentaires SQL de `migrate.js`,
qui ferment le template literal portant la requête. Attrapé par `sqlBackticks.test.js`, qui a
nommé les trois lignes. Remplacés par des guillemets français.

8 nouveaux tests. **477/477 tests d'intégration** (469 avant), zéro régression.

**Reste à faire — étape 3b, à ne lancer qu'après lecture du journal d'observation sur de vraies
données** : bascule en refus par défaut, retrait du repli sur les rôles par défaut, retrait des
63 `requireRole`, invalidation du cache depuis les routes qui modifient un rôle. Puis étape 4 :
l'écran d'administration et la disparition de la liste de permissions du frontend.

---

### Rôles par entreprise — étape 2 : le mode observation — 2026-09-13

Le garde des permissions est en place et **ne refuse rien**. Il calcule ce qu'il refuserait et
le journalise. C'est le filet avant la bascule : une carte incomplète bloquerait de vrais
utilisateurs sur de vraies opérations, et on ne le découvrirait qu'en production.

**`server/src/permissions/rolesParDefaut.js`** — les six rôles actuels traduits en couples
ressource × action. Ce fichier a deux vies : référence du mode observation maintenant, graine
semée en base à l'étape 3 — après quoi chaque entreprise sera libre de tout renommer et
redéfinir. Choix assumé : ces définitions expriment **l'intention que l'interface laisse
entendre**, pas le comportement actuel du serveur. Les deux diffèrent, puisque 21 fichiers de
routes n'ont aucune garde ; reproduire cette permissivité accidentelle viderait le chantier de
son sens. L'écart est exactement ce que l'observation doit révéler.

**`server/src/middleware/permissionGuard.js`** — monté dans `app.js` juste après `moduleGuard`.

Deux difficultés techniques, résolues :

- **Un middleware global ignore le motif de route apparié.** `req.route` n'existe que dans le
  handler de la route, pas au niveau de l'application : impossible de savoir que
  `/api/devis/42/facturer` correspond à `/api/devis/:id/facturer`. On reconstruit donc
  l'appariement depuis l'inventaire (`creerAppariementChemin`). Conséquence directe :
  `inventaireRoutes` **conserve l'ordre d'enregistrement**, car c'est lui qui porte la priorité
  entre motifs — `/api/devis/ledger` est déclaré avant `/api/devis/:id`, et trier la liste ferait
  prendre « ledger » pour un identifiant. Un test couvre ce cas précis.
- **Le garde doit être monté avant les routes, mais les inventorier suppose qu'elles le soient
  déjà.** L'appariement est donc construit à la première requête, pas à la création.

Journalisation dans `audit_log` (action `permission_observee`), pas dans une table neuve : le
journal existe, se lit déjà par `GET /api/auth/audit-log`, et l'étape est transitoire. Une
mémoire anti-inondation évite qu'un écran en boucle sur une route refusée n'écrive des milliers
de lignes identiques — une seule par (entreprise, rôle, ressource, action) et par process.

**Vérifié en conditions réelles**, image backend reconstruite, sur un ouvrier créé pour
l'occasion : `POST /api/contacts` → **201**, `GET /api/salaries` → **200**. Rien n'est bloqué, et
les deux écarts apparaissent au journal (`contacts/creer`, `salaries/lire`). C'est le constat de
l'audit rendu tangible : l'interface cache ces deux écrans à un ouvrier, l'API les lui ouvre.

Pour lire les observations accumulées :

```sql
SELECT details->>'role' AS role, details->>'ressource' AS ressource,
       details->>'action' AS action, count(*) AS n
  FROM audit_log WHERE action = 'permission_observee'
 GROUP BY 1,2,3 ORDER BY n DESC;
```

15 nouveaux tests. Le premier est le plus important — **le garde ne bloque rien** : une
régression là casserait l'application en silence pour tous les rôles non-admin. Les autres
couvrent l'appariement d'URL (dont la priorité littéral/paramètre), la journalisation des seuls
écarts, et les six rôles par défaut, y compris qu'un rôle inconnu n'obtient **rien** — la colonne
`role` est du texte libre, une valeur inattendue ne doit pas ouvrir l'application.

**469/469 tests d'intégration** (454 avant), zéro régression — le point qui comptait, le garde
traversant désormais chaque requête de chaque test.

Étape 3 non commencée : tables `roles`/`role_permissions`, amorçage, bascule en refus par défaut
et retrait des 63 `requireRole`. À faire seulement après lecture du journal d'observation sur de
vraies données.

---

### Rôles par entreprise — étape 1 : la carte des permissions — 2026-09-13

Décision de l'utilisateur : **l'application ne doit plus imposer les noms de rôles.** Elle fixe
le vocabulaire — ressources et actions — et chaque entreprise crée ses propres rôles, les nomme
comme elle veut et décide qui voit quoi. Les six rôles actuels deviennent un modèle de départ,
renommable et supprimable.

**Le constat qui a déclenché le découpage.** Audit préalable des restrictions existantes :
`requireRole` est posé à 63 endroits (33 `admin`, 25 `admin+directeur`, 5 avec `gestionnaire`),
mais **21 fichiers de routes qui écrivent n'en ont aucun** — `achats.js` (10 écritures, dont la
réception qui écrit stock ET finances), `produits.js` (9, dont prix, rebut et transferts),
`cultures`/`poulailler`/`pisciculture` (18), `listesPrix.js`, `contacts.js`. Asymétries réelles :
un ouvrier ne voit ni Clients ni Fournisseurs à l'écran mais peut les créer et les supprimer par
l'API ; un comptable ne voit pas Cultures mais peut ajuster un inventaire.

Ce n'est pas une négligence, c'est le **taux d'échec normal** du gardiennage route par route :
chaque route ajoutée est une occasion d'oublier. Comparaison faite dans le clone de l'ERP de
référence : Odoo n'a pas ce problème parce que `check_access` est appelé depuis `create`,
`write`, `unlink` et `read` de l'ORM (`odoo/orm/models.py`), pas depuis les contrôleurs — la
porte est SOUS l'endpoint, et « j'ai oublié de garder cette route » n'existe pas comme catégorie
de bug. Il distingue par ailleurs deux niveaux que YEELEN confond : `ir.model.access` (modèle ×
groupe × 4 droits) et `ir.rule` (filtrage par ligne via domaine). YEELEN a déjà une record rule
unique, recopiée à la main partout : `WHERE entreprise_id = $1`.

**Livré à cette étape — rien n'est encore bloqué.**
- `server/src/permissions/inventaireRoutes.js` : énumère les routes **réellement montées** en
  lisant la pile Express. C'est la pièce qui rend la carte vérifiable ; une liste tenue à la main
  ne garde rien, puisqu'elle ignore ce qu'on a ajouté depuis.
- `server/src/permissions/catalogue.js` : le vocabulaire (**43 ressources** en 6 sections,
  **8 actions**) et la carte route → (ressource, action). Sur 300 routes montées, **268 sont
  soumises aux rôles** et 32 hors périmètre — chacune avec sa raison écrite, sans quoi cette
  liste deviendrait le tapis sous lequel on glisse ce qu'on n'a pas su classer.
- `server/src/test/integration/permissionsCatalogue.test.js` : 8 tests. Le principal échoue si
  une route montée n'est couverte ni par la carte ni par le hors-périmètre.

**Décisions de découpage.** Le grain ne suit pas les fichiers de routes : `salaries.js` porte six
sujets qu'une entreprise voudra distinguer (confier les congés sans ouvrir les salaires), et
`factures.js` mêle les pièces et les états comptables. Les **42 POST qui agissent au lieu de
créer** (`facturer`, `recevoir`, `annuler-reception`, `remettre-brouillon`…) sont étiquetés un
par un : une traduction mécanique `POST → créer` les aurait tous classés à tort. Quatre actions
sensibles sont exposées à part — `valider`, `facturer`, `receptionner`, `encaisser` — parce
qu'elles déplacent argent ou stock et qu'une entreprise doit pouvoir dire « il modifie un devis
mais ne le facture pas » ; les 30 autres actions sont repliées sur `modifier`, sinon la matrice
devient illisible.

**Le test a été prouvé, pas supposé.** Une route piège ajoutée à `app.js` le fait échouer en la
nommant (`POST /api/route-oubliee — route non couverte`). Premier essai : quatre tests échouaient
pour cette seule cause, avec des messages trompeurs (« chaque ressource est atteignable »).
Corrigé — les tests voisins résolvent en mode tolérant, le test dédié signale seul. Vérifié :
une cause racine, un échec.

**Contrainte rencontrée** : ce test ne peut pas vivre dans la suite unitaire. Importer `app.js`
sous babel-jest échoue sur `otplib` → `@scure/base` (déjà documenté dans CLAUDE.md). Il vit donc
dans la suite d'intégration, seule à exécuter la vraie application en ESM natif, bien qu'il
n'interroge aucune base.

**À revoir à l'étape 3, noté dans le fichier** : `GET /api/recherche` est provisoirement hors
périmètre alors qu'elle interroge plusieurs ressources d'un coup — elle renverrait des résultats
qu'un rôle restreint ne devrait pas voir. Son filtrage reste à faire.

**454/454 tests d'intégration** (446 avant, +8), zéro régression. Étapes suivantes convenues et
non commencées : mode observation, tables et bascule en refus par défaut, écran d'administration.

---

### Parcelles — contour réel tracé sur imagerie satellite — 2026-09-12

Issu de la comparaison demandée avec les ERP agricoles matures : le contour de parcelle était le
seul manque **structurel** de la liste. Les autres s'ajoutent ; celui-là conditionne tout ce qui
vient après — NDVI juste, surface réelle, travail par zone, cartes de préconisation plus tard.

**Ce qui existait vraiment** (vérifié, pas supposé) : l'onglet « Carte » affichait des pastilles
positionnées par `pos_x`/`pos_y`, deux nombres tirés par `Math.round(10 + Math.random() * 80)` à
la création de la parcelle. Une carte qui ne représentait rien. Et `agroPolygon.js` fabriquait un
carré approximatif autour de latitude/longitude pour interroger le satellite.

**Stockage : `parcelles.contour` en `jsonb`, pas PostGIS.** `pg_available_extensions` sur l'image
`postgres:18-alpine` ne renvoie aucun `postgis*` ; y passer imposerait de changer d'image, donc de
revoir la sauvegarde, le test de restauration hebdomadaire et la CI — pour un besoin qui se limite
à stocker un polygone, calculer une surface et un centroïde. Aucune requête spatiale n'est faite.

**`server/src/utils/geoParcelle.js`** : validation, surface (excès sphérique) et centroïde d'aire.
La formule est **exacte** pour un rectangle latitude/longitude, ce qui donne un test à réponse
connue plutôt qu'une tolérance choisie au doigt mouillé — vérifié à 0,000000 % d'écart contre
`R²·Δλ·(sinφ₂−sinφ₁)`, et 1,0000 ha pour un carré de 100 m de côté. La valeur absolue rend le sens
de parcours sans effet. L'auto-intersection n'est **pas** détectée : c'est un algorithme à part,
signalé en commentaire plutôt que sous-entendu couvert.

**Règle métier** : un contour tracé prime sur la superficie tapée au clavier, et renseigne
latitude/longitude depuis son centroïde — sauf si la requête fournit explicitement des
coordonnées, auquel cas la saisie explicite garde la main. Un contour redessiné invalide le
polygone Agromonitoring au même titre qu'un déplacement, et `creerPolygone` envoie désormais le
**vrai** contour ; le carré ne subsiste que pour les parcelles jamais dessinées.

**Carte** : Leaflet 1.9.4, chargé en `lazy()` — 155 Ko qui ne partent que si l'on ouvre l'onglet,
le bundle initial n'a pris que 1,4 Ko. Fond Esri World Imagery : Esri accorde explicitement le
droit de *tracer des entités pour créer des données vectorielles*, ce qui est exactement l'usage ;
attribution posée bien qu'elle ne soit que recommandée. **Ces tuiles raster sont annoncées
dépréciées et peuvent être coupées sans préavis** — d'où `VITE_TILES_SATELLITE_URL`, câblée
jusqu'aux arguments de build Docker : changer de fournisseur reste une ligne de configuration.
Bascule OpenStreetMap pour se repérer quand l'imagerie est nuageuse ou ancienne.

**Deux pièges, tous deux évités par vérification et non par relecture :**
- La migration lancée depuis l'hôte a échoué sur un tout autre message (`banque_principale_id`) —
  `server/.env` pointe sur le Postgres Windows natif (5432), pas celui de Docker (5433). Puis
  `docker exec … migrate.js` a signalé un succès **sans créer la colonne** : le conteneur exécute
  le code de l'image, et il n'y a pas de bind-mount. Il faut reconstruire le backend AVANT de
  migrer. Constaté en relisant `\d parcelles`, pas en croyant la sortie de la commande.
- `MapPin` et `notify` étaient utilisés sans exister — `notify` n'a jamais été exporté par
  `ui.jsx`. Le premier aurait cassé le rendu, le second l'enregistrement hors-ligne. Trouvés par
  un balayage systématique de chaque symbole du composant neuf, pas à la lecture.

**Ce qui devient caduc** : `pos_x`/`pos_y` ne sont plus lus nulle part (colonnes laissées en base,
plus rien ne les alimente).

**Hors périmètre, dit explicitement** : import/export shapefile et KML, zones intra-parcellaires,
cartes de préconisation à dose variable.

7 tests d'intégration (surface imposée, coordonnées explicites prioritaires, redessin recalculant
et invalidant le satellite, modification sans contour ne touchant pas au tracé, effacement
préservant la superficie, 5 géométries invalides → 400, isolation entre entreprises).
**446/446 tests d'intégration, zéro régression** (439 avant). `npm test` (142/142) et build verts.
Vérifié en navigateur réel sur une entreprise jetable, nettoyée ensuite : tracé de 4 points sur
l'imagerie, surface annoncée **901,88 ha**, recoupée en base contre la formule analytique
appliquée aux coordonnées stockées — **901,88 ha et centroïde identique au chiffre près**. Testé
aussi à 375 px (carte à 302 px de haut, aucun débordement). Images Docker reconstruites.

---

### Navigation — une seule couleur pour « sélectionné » — 2026-09-12

L'utilisateur : « j'ai constaté deux à trois couleurs différentes sur un menu qui est
sélectionné ? ». Vérifié dans le code : il y avait **trois façons** de dessiner le même état,
dans trois systèmes de couleurs.

| Où | Sélection dessinée par | Couleurs possibles |
| --- | --- | --- |
| Barre du haut (`navBtnStyle`) | voile blanc `rgba(255,255,255,.18)` | 1, neutre |
| Item de menu déroulant | `${cat.color}22` + texte `cat.color` | **5** selon la catégorie |
| Onglet de module (`ModuleTabButton`) | pastille pleine en `accentColor` | **3** : vert Cultures, ocre Poulailler, bleu Pisciculture |
| Panneau mobile (`itemStyle`) | `COLORS.greenSoft` + texte `COLORS.green` | 1, vert |

La contradiction la plus visible : Pisciculture appartient à la catégorie *Opérations*, donc
surlignée en **vert** dans le menu déroulant, puis sa barre d'onglets passait au **bleu**.
Poulailler : vert dans le menu, **ocre** dans ses onglets. En un seul geste — ouvrir le menu,
cliquer — la couleur censée dire « vous êtes ici » changeait deux fois.

Correction : une seule couleur de sélection dans toute la navigation, le vert de marque.
`accentColor` disparaît de `ModuleTabButton`/`ModuleTabBar` et de ses trois points d'appel ; le
menu déroulant adopte `greenSoft`/`green` — c'est-à-dire exactement ce que le panneau mobile
faisait déjà, ce qui referme au passage un écart bureau/mobile jamais remarqué.

**Ce qui est délibérément conservé** : les pastilles de couleur par catégorie sur l'accueil et
dans le panneau mobile (vert/bleu/ocre/rouge/violet, vérifiées intactes). La couleur y dit
« quelle famille » — son rôle légitime. Le défaut venait de lui avoir fait dire **aussi**
« où je suis » : une couleur, deux significations.

**Piège évité de justesse** : retirer la prop `accentColor` laissait une référence morte à la
ligne 4760, le bouton « Plus » du repli d'onglets — un `ReferenceError` sur un chemin que ni le
build ni les tests n'exercent (il n'apparaît qu'en dessous d'une certaine largeur). Trouvé
parce que le script de remplacement listait les occurrences restantes au lieu de se déclarer
terminé ; corrigé, puis vérifié en conditions réelles à 375 px avec un onglet actif caché dans
le repli — le bouton ressort bien en vert.

Hors périmètre, volontairement : les jauges Ambiance/Bassins (bleu/vert/ocre par grandeur
mesurée), les cartes Ventes/Achats/Solde (vert/rouge/bleu par nature du montant) et
`OptionCard` sur l'écran des modules. Ce sont des couleurs sémantiques ou décoratives, pas des
états de sélection.

Vérifié en navigateur réel sur une entreprise jetable, nettoyée ensuite, **couleurs relevées
dans le DOM et non à l'œil** : onglet actif à `rgb(63,107,59)` dans les trois modules, item de
menu actif à `rgb(231,239,223)`/`rgb(63,107,59)` dans Opérations comme dans Analyse (qui était
bleue), cinq pastilles de catégorie toujours distinctes, bouton « Plus » vert à 375 px.
`npm test` (142/142) et `npx vite build` verts ; image Docker frontend reconstruite.

---

### Aide — bulle flottante et FAQ contextuelle — 2026-09-11

L'utilisateur, juste après la livraison de la FAQ : « c'est mieux que ça soit une icône flottante
sur le côté droit en bas non ? ». Oui, et pas pour la raison évidente : l'aide ne sert que là où
le problème se pose. Aller lire pourquoi le stock n'a pas bougé obligeait à quitter l'écran des
stocks.

`FaqSection` sort de `HelpModule.jsx` dans son propre fichier : la page Aide et la bulle
montrent **le même composant**, le contenu ne peut pas diverger entre l'endroit où l'on cherche
et l'endroit où l'on est bloqué. Deux nouvelles props : `avecEntete` (le panneau a son propre
en-tête) et `groupePrioritaire`.

**`AideFlottante.jsx`** — bouton rond de 44 px (la cible tactile minimale) en bas à droite ; le
coin était libre, les notifications sortant en haut à droite (`ui.jsx`). Monté dans le shell,
chargé paresseusement, et conditionné à `screen === 'dashboard' && tab !== 'aide'` : ni sur la
connexion, ni sur l'onboarding, ni sur la page Aide où il ouvrirait le contenu déjà affiché
en dessous.

Le panneau s'ancre au même coin plutôt que d'occuper l'écran : on garde sous les yeux ce qu'on
cherche à comprendre. **Pas de fermeture au clic extérieur**, contrairement aux menus de la
navbar — le refermer au premier clic sur la page reviendrait à le refermer à chaque
vérification. Échap et le bouton suffisent. `z-index` 200 : une modale (1000) le recouvre,
vérifié par `elementFromPoint` sur le centre du bouton, pas au jugé.

**Le contexte est un réordonnancement, pas un filtre.** `GROUPE_PAR_ONGLET` remonte un groupe
en tête selon l'onglet courant. Limite assumée : le routage ne connaît que le premier niveau
(`/app/<onglet>`), jamais le sous-onglet d'un module — ouverte depuis Poulailler, la bulle ne
sait pas si l'on regarde ses Stocks ou ses Ventes. C'est précisément pourquoi elle ordonne au
lieu de masquer : une mauvaise approximation qui cache coûte bien plus cher qu'une mauvaise
approximation qui ordonne.

**Bug réel trouvé en mesurant, pas en regardant** : le panneau faisait 363 px de large au lieu
des 343 attendus. `SPACE` expose des **nombres** — React les suffixe en px pour une propriété
seule (`right: SPACE.md`), mais interpolés dans une chaîne ils produisent du CSS invalide,
silencieusement ignoré : `calc(100vw - 12 - 12)`, `padding: '8 12'`. Le panneau remplissait
donc la largeur disponible au lieu de respecter sa règle. Quatre occurrences, toutes dans les
fichiers neufs — le reste du dépôt écrit correctement `${SPACE.x}px` — dont **une déjà en
production** depuis le commit précédent : la marge sous l'intro de la FAQ ne s'appliquait pas.
Corrigées, plus un balayage de `src/` confirmant qu'il n'en reste aucune.

Vérifié en navigateur réel sur une entreprise jetable, nettoyée ensuite : bulle absente de la
connexion, de `/modules`, de l'onboarding et de la page Aide ; présente ailleurs ; couleur,
taille et `z-index` relevés dans le DOM ; réordonnancement correct depuis Cultures (groupe
Cultures en tête) et depuis Poulailler (groupe Stocks) ; Échap ferme ; « Ouvrir l'aide
complète » navigue et ferme ; recouverte par une modale ; à 375 px, panneau dans les marges,
zéro débordement horizontal et **aucun élément interactif sous le bouton** (mesuré par
intersection de rectangles). `npm test` (142/142) et `npx vite build` verts ; image Docker
frontend reconstruite.

---

### Aide — garde-fou de l'assistant + foire aux questions — 2026-09-11

L'utilisateur a posé la question autrement qu'en demandant une page : « l'IA qui est intégrée
dans l'appli peut jouer le rôle de FAQ ? ». La réponse honnête est non, et le vérifier a montré
pourquoi — l'assistant ne cherche pas, il teste des mots-clés sur la question puis répond avec
les données de l'entreprise. « Pourquoi mon stock n'a pas bougé ? » contient « stock » : il
répondait donc le tonnage en magasin, avec aplomb, à quelqu'un qui demandait une explication de
fonctionnement. Une réponse fausse mais plausible, jamais rattrapée par le repli. Décision de
l'utilisateur : les deux moitiés — le garde-fou **et** une FAQ complète.

**Garde-fou** (`AIAssistantModule`, `askAssistant`). Un test placé **avant** les tests par
mots-clés — c'est tout l'intérêt, en aval il n'aurait jamais été atteint : les tournures qui
portent sur le fonctionnement (`pourquoi`, `comment`, `à quoi sert`, `c'est quoi`, `je n'arrive
pas`, `impossible de`, et leurs équivalents anglais) renvoient `assistant.answerFonctionnement`,
qui dit ce que l'assistant sait faire et renvoie vers l'Aide. Il abandonne quelques questions
qu'il aurait su traiter ; il cesse surtout d'en inventer.

**FAQ** (`help.faq` dans les deux catalogues, rendue par `FaqSection` dans `HelpModule.jsx`) :
9 groupes, 37 questions, fr et en. Placée **avant** le glossaire des modules — on arrive dans
l'Aide avec un problème précis, pas avec l'envie de lire une définition. Chaque question est
une ligne dépliable ; un champ de recherche filtre sur la question **et** sur la réponse (le mot
qu'on a en tête — « réservé », « avoir », « rebut » — est souvent dans la réponse), insensible
à la casse comme aux accents, sans quoi un clavier sans accents ne trouve rien.

**Le contenu a été vérifié dans le code, pas rédigé de mémoire** — une FAQ fausse est pire que
pas de FAQ. Deux réponses étaient inexactes au moment de les écrire :
- La fin d'essai n'est pas « lecture seule » tout court : `subscriptionGuard` accorde 30 jours de
  grâce en lecture seule (`GRACE_DAYS`), **puis** bloque tout (`locked`). Ne dire que la première
  moitié aurait laissé croire que les données restent consultables indéfiniment.
- Annuler une réception : la FAQ anglaise omettait qu'une commande dont la marchandise est
  arrivée n'est plus annulable commercialement tant que la réception n'est pas défaite
  (`POST /achats/:id/annuler`).

Le reste a été confirmé à la source : réservation à la signature et non à la création
(`applyVenteLignesToStock`), commandes partiellement reçues exclues du prévisionnel faute de
quantités ligne à ligne (`GET /produits/previsionnel`), inventaire/rebut/transfert jamais mis en
file hors ligne (`api.js`), capitaux propres absents du plan par défaut d'où les deux lignes
calculées au passif (`GET /factures/bilan`), TVA déductible limitée aux factures fournisseurs
(`in_invoice`/`in_refund`), colonnes de la vue « Par étape » (`DEVIS_KANBAN_COLUMNS`), partage
natif contre lien wa.me (`lib/whatsapp.js`).

Vérifié en navigateur réel sur une entreprise jetable, nettoyée ensuite : rendu fr et en,
dépliage d'une question, filtre accentué (« reserve » trouve « réservée », 3 questions dans 2
groupes), cas sans résultat, et 375 px sans débordement horizontal (mesuré, pas supposé).
`npm test` (142/142) et `npx vite build` verts ; image Docker frontend reconstruite.

---

### ERP « Comptabilité » — Fiche facture : valeurs SCSS réelles d'Odoo — 2026-08-30

L'utilisateur : « pars des vraies valeurs SCSS d'Odoo pour la fiche facture ». Les
dimensions ont été **extraites du SCSS source** du clone `C:\Users\PC\reference-repos\erp-source`,
pas estimées, et documentées ligne par ligne dans `src/App.css` (bloc `.oe-invoice`, avec
la source `addons/web/static/src/...` de chaque valeur). Portée limitée à `.oe-invoice`
(le modal détail de `FacturesModule`) pour ne pas toucher le `.data-table` app-wide.

Valeurs reprises telles quelles :
- `primary_variables.scss` : `$o-font-size-base` 14px / small 13 / smaller 12,
  `$o-line-height-base` 1.5, `$o-spacer` 16, `$o-form-spacing-unit` 5, `$o-horizontal-padding`
  16, `$o-statusbar-height` 33, `$o-border-radius` 4, `$o-gray-300` #dee2e6 (bordure),
  `$o-gray-100` #f8f9fa (fond thead), `$o-main-text-color` #212529, `$o-brand-primary` #71639e.
- `statusbar_field.scss` : caret = `1em`, radius `.1rem`, chevron inactif = `.btn-secondary`
  #dee2e6 / texte #212529 ; **actif** = `$o-component-active-bg` = `mix(#71639e,#f8f9fa,20%)`
  = **#dddbe8** + bord latéral #71639e, **le texte reste #212529** (pas de fond plein
  coloré, pas de texte blanc — c'était l'erreur de la version précédente) ;
  padding chevron `(btn-padding-y+1px) (caret·1.72)` = `7px ~24px`.
- `form_controller.scss` : `.o_inner_group` = `grid-template-columns: fit-content(150px)
  minmax(0,1fr)`, `gap: 8px 16px`, `margin-bottom: 8px` ; `.o_form_label` = 14px / lh 1.5 /
  **weight 400 + opacity .66** en lecture seule ; `.oe_subtotal_footer` = `grid 1fr auto`,
  `margin-left:auto`, `border-top:1px #dee2e6`, libellés alignés à droite + `":"` +
  `padding-right:20px`, séparateur total `border-top:1px` + `font-weight:700` +
  `font-size:1.3em`.
- `list_renderer.scss` : `thead th` fond #f8f9fa / couleur #000 / `padding-top` 8px /
  `border-bottom` 1px #dee2e6 ; cellules `padding` y 8px x 4.8px (16px aux bords) ;
  `border-collapse: collapse` ; ligne `border-bottom` 1px #dee2e6.
- `notebook.scss` : `.nav-tabs` `border-bottom:1px #dee2e6`, `.nav-link` `padding:.5rem 1rem`,
  onglet actif bordé #dee2e6 avec bord bas blanc (= fond sheet).

Modal `FacturesModule` réécrit en `<dl className="oe-group">` / `<table className="oe-list">`
/ `<dl className="oe-subtotal">` / `.oe-notebook` / `.oe-statusbar`. Build front + 88 tests
verts, conteneur reconstruit (CSS + JS servis vérifiés).

### ERP « Comptabilité » — Passe d'alignement UI sur Odoo — 2026-08-30 (frontend seul)

Sur demande de l'utilisateur (« respecter la même interface qu'Odoo : forme, taille des
colonnes et des lignes, leur emplacement »), toute l'UI Comptabilité livrée pendant la
feuille de route a été recalée sur la discipline déjà en place dans l'app : la classe
partagée `.data-table` (dimensions mesurées, cf. [[project_erp_dimensioning_appwide]]),
`.flat-input` / `.field-group`, et la structure du modal devis (cf.
[[project_erp_devis_visual_alignment]]). **Aucun changement backend / schéma / test.**

- **`FacturesModule`** : liste aux colonnes dans l'ordre du tree `account.move` d'Odoo
  (`Numéro | Client | Date de facture | Échéance | Total HT | Total TTC | État paiement |
  État`), échéance annotée façon widget `remaining_days` (« J+n » / « n j de retard »,
  rouge si en retard). Modal détail refait sur le squelette de la fiche `account.move` :
  barre de statut en chevrons `MoveStatusBar`, barre d'actions dans l'ordre Odoo, en-tête
  à deux colonnes en `.field-group`, onglets notebook « Lignes de facture » /
  « Écritures comptables », bloc totaux bas-droite façon `oe_subtotal_footer`
  (Total HT · par taxe · Total TTC · Payé · Reste dû).
- **`ComptaReportsPanel` / `ComptaConfigPanel` / `TaxesPanel` / `PaymentTermsPanel`** :
  les listes en `<div>` deviennent des `.data-table` avec les colonnes des rapports Odoo
  (balance âgée `Client × non échu / 1-30 / 31-60 / 61-90 / 90+ / Total` + ligne totaux en
  gras ; journaux `Code | Nom | Type | Sécurisé` ; comptes `Code | Nom | Type |
  Rapprochable` ; taxes `Nom | Type | Montant | Incluse` ; conditions de paiement
  `Nom | Répartition`).
- **`TaxSelect`** : puces arrondies avec `×` façon widget `many2many_tags`.
- **Tableaux de lignes du devis** : colonne `Taxes` déplacée après `Remise` (ordre de la
  ligne Sale Order d'Odoo).
- i18n fr/en complétée (`factures.tab.*`, `factures.due*`, `comptaConfig.hash*`,
  `comptaReports.*`, `paymentTerms.repartition`). Build front + 88 tests verts.

### ERP « Comptabilité » — Étape 6 : balance âgée, relances, paiements autonomes — 2026-08-30 (feuille de route COMPLÈTE)

**Schéma** : `account_move.relance_niveau INT DEFAULT 0` + `.derniere_relance DATE` (suivi des
relances — pas d'envoi d'email, SMTP différé). Rien d'autre : la balance âgée et la liste des
retards se calculent à la volée.

**`utils/accountMove.js`** :
- `creerPaiementAutonome(client, {…, partnerId, amount, paymentDate, journalId, ref, sens})` :
  `account_payment` + son écriture postée (trésorerie D / créance C) **sans lettrage** → un
  crédit non alloué sur le compte client (avance / acompte hors facture). Haché si le journal
  de trésorerie est sécurisé.
- `allouerPaiement(client, {paymentId, moveId, amount, entrepriseId})` : lettre une tranche
  de la ligne `payment_term` du paiement contre celle d'une facture via
  `lettrerLignesPartenaire`, borné à `min(demandé, non-alloué, résiduel facture)`, met à jour
  le `payment_state` de la facture. Partenaire différent → 400.

**Routes** :
- `GET /api/factures/aged-receivable?date=` → par partenaire, le reste dû des `out_invoice`/
  `out_refund` postés, ventilé *non échu / 1-30 / 31-60 / 61-90 / 90+* vs `invoice_date_due`
  (`reversed` exclues, `out_refund` en négatif) + totaux.
- `GET /api/factures/overdue` → `out_invoice` postées `not_paid`/`partial` échues, avec
  `daysOverdue` / `relanceNiveau` / `derniereRelance`.
- `POST /api/factures/:id/mark-reminded` (admin/directeur) → `relance_niveau += 1`,
  `derniere_relance = aujourd'hui`.
- Nouveau `server/src/routes/paiements.js` (`/api/paiements`) : `GET /?partnerId=&unallocated=1`
  (montant non alloué = |résiduel de la ligne créance du paiement|), `POST /`, `POST
  /:id/allocate` (admin/directeur).
- aged-receivable / overdue déclarées **avant** `/:id`.

**Coupe assumée** : `payment_state='in_payment'` (Odoo : payé mais relevé bancaire pas
rapproché) non utilisé — pas d'import de relevé dans YEELEN, on garde les 4 états.

**Frontend** : nouveau `src/components/ComptaReportsPanel.jsx` (sections repliables : tableau
balance âgée partenaire × tranche ; liste des retards + bouton « Marquer relancé » ;
formulaire de paiement autonome + liste des non-alloués + sélecteur « Affecter » inline),
rendu au-dessus de `FacturesModule`. i18n `comptaReports.*` fr/en.

**Vérif** : migration ×2 sur copie restaurée (2 colonnes, comptes devis inchangés) →
appliquée. Fumée live : facture échue -40 j → tranche 31-60 = 1000, `overdue` 40 j niveau 0
→ `mark-reminded` → niveau 1 + date ; paiement autonome `BNK/2026/0001` non alloué = 600 →
`allocate` contre la facture → lettré 600, résiduel facture 400, `partial`. Nouveaux
`agedReceivable.test.js` (5) + `paiements.test.js` (7) → suite d'intégration **154 tests /
26 fichiers** verte. Front : build OK, 88 verts.

**→ La feuille de route [[project_erp_comptabilite_roadmap]] est complète (étapes 0 à 6).**

### ERP « Comptabilité » — Étape 5 : avoirs (`out_refund` + reverse) — 2026-08-30

**Aucun changement de schéma** — `reversed_entry_id`, `out_refund`, la séquence `RINV/…`
existent depuis l'étape 3. Étape code seulement.

**Refacto** : `lettrerLignesPartenaire(client, entrepriseId, {ligneFactureId, ligneContreId,
amount, date})` extrait d'`enregistrerPaiementMove` — le `account_partial_reconcile` +
`account_full_reconcile` + `matching_number` au solde, désormais sign-aware sur **les deux**
lignes (chaque résidu diminué de `amount` vers 0). Partagé par le paiement et le reverse.

**`reverseMove(client, {moveId, entrepriseId, userId, reason, date, refundMethod})`** :
l'origine doit être une facture postée (`out_invoice`/`in_invoice`) ; crée un `account_move`
(`out_refund`/`in_refund`, `reversed_entry_id` = origine, `ref` = « Annulation de : <name>
— <reason> », `invoice_origin` = nom de l'origine), copie ses lignes produit/section + liens
de taxes.
- `refundMethod: 'refund'` (défaut) → l'avoir reste **brouillon** (éditable, à poster ensuite)
- `refundMethod: 'cancel'` → `posterMove` (écriture inversée + numéro `RINV/…` + hash si
  journal sécurisé) puis `lettrerLignesPartenaire` contre la ligne créance de l'origine →
  origine `payment_state='reversed'` + `amount_residual=0`, avoir soldé.

**Route** `POST /api/factures/:id/reverse` (admin/directeur). **Garde-fous** :
`enregistrerPaiementMove` → 400 si l'origine est `reversed` ; `POST /devis/:id/remettre-
brouillon` → 400 si la facture liée a des avoirs (en plus du garde-fou hash).
`getFactureComplete` renvoie `reversedEntryName` + `reversalMoveNames`.

**Frontend** : `FacturesModule` modal détail — bouton « Créer un avoir » sur une
`out_invoice` postée → formulaire inline (motif + méthode), ouvre l'avoir créé ; l'en-tête
affiche « Avoir de : … » / « Annulée par : … ». i18n fr/en.

**Vérif** : `pg_dump`→restore→`migrate.js` ×2 (formalité, pas de delta de schéma). Fumée
live : facture postée 2×500 → reverse `cancel` → `RINV/2026/0001` posté, résiduel 0,
`matching_number` `A00001`, origine `reversed` résiduel 0, `reversalMoveNames` renseigné ;
`register-payment` sur l'origine → 400. Nouveau `factureAvoir.test.js` (7) → suite
d'intégration **144 tests / 24 fichiers** verte. Front : build OK, 88 verts.

### ERP « Comptabilité » — Étape 4 : inaltérabilité des factures postées — 2026-08-30

Calquée sur le mécanisme d'un ERP de référence : `restrict_mode_hash_table` par journal,
`inalterable_hash` chaîné + `secure_sequence_number` sans trou. **Opt-in par journal,
désactivé par défaut** — le flux pré-prod (`remettre-brouillon` qui défait une facture)
reste utilisable tant qu'une entreprise n'active pas le mode sécurisé.

**Schéma** (`migrate.js`) :
- `account_journal.restrict_mode_hash_table BOOL DEFAULT FALSE`
- `account_journal.secure_sequence_last INT DEFAULT 0` (compteur sans trou, verrou de ligne au post)
- `account_move.inalterable_hash TEXT`, `account_move.secure_sequence_number INT`

**`server/src/utils/accountMove.js`** :
- `chaineIntegriteMove(client, moveId)` : concatène les champs protégés
  (`name|date|journal_id|amount_total|partner_id` puis chaque ligne
  `account_id|debit|credit|balance` triée par id).
- `hacherMoveSiRequis(client, moveId, journalId)` : si le journal est sécurisé, attribue
  `secure_sequence_number = last+1` (verrou `FOR UPDATE` sur le journal) et
  `inalterable_hash = sha256(hash_précédent + chaîne)` chaîné à l'écriture sécurisée
  précédente du même journal. Appelé par `posterMove` (facture) **et** après l'insertion de
  l'écriture de paiement dans `enregistrerPaiementMove`.
- `verifierChaineJournal(q, journalId, entrepriseId)` : re-parcourt la chaîne, recalcule
  chaque hash et vérifie l'absence de trou → `{ ok, count } | { ok:false, brokenAt, reason }`.

**Garde-fous** : `POST /factures/:id/button-draft` et `DELETE /factures/:id` → 400 si
`inalterable_hash` non nul ; `POST /devis/:id/remettre-brouillon` → 400 si le move lié est
haché (message : « créez un avoir » — étape 5). `GET /api/factures/verify-hash?journalId=`
(admin/directeur, déclarée **avant** `/:id`). `journals.js` PUT/POST acceptent
`restrictModeHashTable` mais **seulement pour l'activer** (`=== true`) — un `false` en PUT
partiel est ignoré (on ne dé-sécurise pas un journal qui a des écritures hachées).
Corrigé au passage : 2 double-`client.release()` préexistants sur les retours anticipés de
`remettre-brouillon`.

**Frontend** : `ComptaConfigPanel` — bouton 🔒 par journal (`updateJournal({
restrictModeHashTable:true})`, confirmation, irréversible). `FacturesModule` modal détail —
puce « Sécurisée » + bouton « Vérifier l'intégrité » (→ `verify-hash`) quand le move est haché.
i18n fr/en.

**Vérif** : migration ×2 sur copie restaurée (idempotente, 4 colonnes ajoutées, comptes
devis inchangés) → appliquée. Fumée live : journal INV passé en mode sécurisé, 2 factures
postées → `secure_sequence_number` 1 puis 2, hashs distincts et chaînés ; `button-draft` →
400 ; `verify-hash` → `{ok:true, count:2}`. `factureHash.test.js` (5) → suite d'intégration
**138 tests / 23 fichiers** verte. Front : build OK, 88 verts.

### ERP « Comptabilité » — Étape 3b : `POST /devis/:id/facturer` produit une vraie facture — 2026-08-30

Rebranchement prévu à l'étape 3. `POST /api/devis/:id/facturer` **crée et poste** désormais
un `account_move` (`out_invoice`) qui reflète le devis :
- `devis.move_id` (nouvelle colonne nullable) pointe vers la facture ;
  `account_move.invoice_origin` = le numéro du devis ; les échéances sont **rattachées aux
  deux** (`echeances_paiement.devis_id` ET `.move_id`).
- Le devis garde son `statut` / son flux d'échéances comme **miroir commercial**.

**Refacto** : `server/src/utils/accountMove.js` extrait de `routes/factures.js` —
`posterMove(client, moveId, entrepriseId)` (génération de l'écriture équilibrée + numéro de
journal) et `enregistrerPaiementMove(client, {…, skipFinanceMirror, skipEcheanceAllocation})`
(paiement + lettrage). Les handlers `/post` et `/register-payment` de `factures.js` sont
maintenant de simples enveloppes — comportement inchangé, `factures.test.js` toujours vert.

**Cohérence des paiements** :
- `facturer` chemin `complet` → `enregistrerPaiementMove(…, skipFinanceMirror:true)` : le move
  se solde (`paid` + lettrage), et `syncDevisPaiement` reste la **seule** entrée `finances`
  (`source_module='Devis'`).
- `POST /devis/:id/echeances/:eid/payer` devient transactionnel et, si `devis.move_id`, appelle
  `enregistrerPaiementMove(…, skipFinanceMirror:true, skipEcheanceAllocation:true)` pour que
  `payment_state`/`amount_residual`/lettrage du move suivent les paiements d'échéances côté
  devis. (`skipEcheanceAllocation` : l'échéance précise est déjà marquée par la route devis —
  sans ça l'allocation par ordre déborderait sur l'échéance suivante ; bug attrapé par
  `devis.test.js`.)
- `POST /devis/:id/remettre-brouillon` défait aussi la facture : supprime les écritures de
  paiement lettrées + `account_payment` + entrées `finances` `'Facture'`, supprime le move
  (lignes / liens taxes / partiels cascadent), purge les `account_full_reconcile` orphelins,
  remet `devis.move_id` à NULL. Le numéro de journal consommé n'est pas restitué (trou de
  séquence accepté pour cet undo pré-production).

`getDevisComplet` renvoie `move: { id, name, state, paymentState, amountResidual, amountTotal }
| null`. Front : bouton intelligent « Facture INV/… · <état paiement> » dans le modal détail
d'un devis, qui bascule sur l'onglet Factures (`devis.voirFacture` i18n fr/en).

**Vérif** : migration répétée ×2 sur copie restaurée (idempotente, `devis.move_id` ajouté,
comptes devis inchangés) → appliquée. Fumée live : devis signé → `facturer` complet →
`INV/2026/0001` posté/`paid`, écriture équilibrée D=C=1000, `invoice_origin` = `DEV-2026-0001`
→ `remettre-brouillon` → move supprimé (404), devis en `Brouillon`. `devis.test.js` +3 →
suite d'intégration **133 tests / 22 fichiers** verte. Front : build OK, 88 verts.

### ERP « Comptabilité » — Étape 3 : `account.move` + `account.move.line` (double-partie) — 2026-08-30

4e étape de [[project_erp_comptabilite_roadmap]]. **Décision prise avec l'utilisateur au
lancement** : double-partie **complète** (écriture équilibrée + moteur de lettrage), pas le
modèle-document sur base de trésorerie. Et **`account.move` autonome cette étape** —
`POST /api/devis/:id/facturer` est **inchangé**, rebranché à l'étape 3b/4.

**Tables** (`migrate.js`, noms de champs calqués sur un ERP de référence) :
- **`account_move`** : `move_type` (entry/out_invoice/out_refund/in_invoice/in_refund),
  `state` (draft/posted/cancel), `name` (NULL → `INV/2026/0001` au post), `partner_id`,
  `invoice_date`/`invoice_date_due`/`date`, `invoice_origin`, `payment_term_id`,
  `amount_untaxed`/`amount_tax`/`amount_total`/`amount_residual`, `payment_state`
  (not_paid/partial/paid/in_payment/reversed), `reversed_entry_id` (auto-FK, pour l'étape 5).
  Index unique partiel sur `(journal_id, name) WHERE name IS NOT NULL`.
- **`account_move_line`** : `display_type` (product/line_section/line_note/tax/payment_term),
  `quantity`/`price_unit`/`discount`/`price_subtotal`/`price_total`,
  **`debit`/`credit`/`balance`/`account_id`**, `tax_line_id`,
  **`amount_residual`/`reconciled`/`full_reconcile_id`/`matching_number`**, `date_maturity`.
- **`account_move_line_taxes`** (M2M ligne↔taxe), **`account_full_reconcile`** (`name` =
  numéro de lettrage `A00001`), **`account_partial_reconcile`**
  (`debit_move_line_id`/`credit_move_line_id`/`amount`/`full_reconcile_id`),
  **`account_payment`** (délègue à sa propre `account_move`).
- `echeances_paiement` : + `move_id` nullable ; `devis_id` passe nullable.
- **Les FK `partner_id` → `contacts`** sont posées par un bloc `DO $$` **après** la création
  de `contacts` (les tables `account_*` sont créées plus tôt dans le template SQL unique que
  `contacts` — même contrainte que `devis.client_id`). Une base *fraîche* 500ait
  (`relation "contacts" does not exist`) tant que ce n'était pas corrigé — repéré par le
  `globalSetup` de la suite d'intégration.

**Génération de l'écriture au `post`** (`POST /api/factures/:id/post`, admin/directeur) :
créance (`asset_receivable`/`121000`) D = total ; produit (compte par défaut du journal, sinon
`income`/`400000`) C = HT par ligne ; une ligne de taxe par taxe (`liability_current`/`251000`)
C = montant. **Assertion Σdébit = Σcrédit** (sinon rollback + 400). `name` via
`prochainNumeroJournal` (étape 2). `out_refund` = signes inversés, préfixe `RINV/…`.

**Moteur de lettrage** (`POST /api/factures/:id/register-payment`) : crée un `account_payment`
+ son écriture (trésorerie D ↔ créance C), un `account_partial_reconcile` contre la ligne
créance de la facture, recalcule `amount_residual` des deux lignes, et au solde total crée un
`account_full_reconcile` + tamponne `matching_number` (`A00001`). Puis met à jour
`move.amount_residual`/`payment_state`, marque les échéances couvertes, et reflète dans
`finances` via `syncFacturePaiement` (`source_module='Facture'`).

**Routes** `/api/factures` : GET liste (`?moveType=&state=&partnerId=`) + GET `:id` (move +
lignes + taxes + échéances + paiements), POST/PUT (brouillon seul), `:id/post` /
`:id/button-draft` (retour brouillon si `not_paid` seulement) / `:id/cancel` /
`:id/register-payment` (admin/directeur), DELETE (brouillon/annulé seul, règle Odoo).

**Frontend** : nouveau `src/components/FacturesModule.jsx` (liste + formulaire brouillon avec
`TaxSelect` + modal détail montrant les lignes comptables / échéances / paiements +
post/cancel/retour-brouillon/suppression/enregistrer-paiement), onglet nav « Factures » gaté
sur la permission `finances` + `activated.finances`. `taxesLigneCalc` extrait de `App.jsx`
vers **`src/lib/taxes.js`** (partagé avec `DevisModule`). i18n `factures.*` + `nav.factures` +
`common.all` fr/en.

**Répétition migration** : `pg_dump agri_app` → base jetable → `migrate.js` ×2 (idempotent
au 2e passage) → tables créées, `echeances_paiement.devis_id` nullable + `move_id` ajouté,
comptes devis inchangés → appliqué à `agri_app`. Fumée live : brouillon 10×1000 + TVA 18 %
→ post `INV/2026/0001`, débit = crédit = 11800 → paiement 11800 → `paid`, résiduel 0,
`matching_number` `A00001`, entrée `finances` « Banque 11800 ». Tests : `factures.test.js`
(10) → suite d'intégration **130 tests / 22 fichiers** verte. Front : build OK, 88 verts.

### ERP « Comptabilité » — Étape 2 : journaux + plan de comptes + séquences — 2026-08-30

3e étape de [[project_erp_comptabilite_roadmap]] (après validité/conditions de paiement à
l'étape 0 et `account.tax` à l'étape 1). **Objets de configuration uniquement** : aucun
`account.move`, aucune écriture au grand livre, aucun changement du calcul devis/factures ni
de `finances`. C'est le socle que l'étape 3 (`account.move`) consommera. La décision
« double-partie complète vs modèle-document sur base de trésorerie » reste reportée à
l'entrée de l'étape 3.

**Schéma** (`server/src/db/migrate.js`, noms de champs calqués sur un ERP de référence) :
- **`account_account`** : `code`, `name`, `account_type` (les 19 valeurs Odoo, CHECK),
  `reconcile`, `active`, `UNIQUE(entreprise_id, code)`.
- **`account_journal`** : `name`, `code` (≤5 car.), `type` (sale/purchase/cash/bank/general),
  `sequence`, `refund_sequence`, `default_account_id` (FK `ON DELETE SET NULL`),
  `UNIQUE(entreprise_id, code)`.
- **`account_journal_sequence`** : compteur `(journal_id, prefix, last_number)`,
  `UNIQUE(journal_id, prefix)`.

**Seed** (`server/src/utils/comptaDefauts.js`, importé par `routes/auth.js` à l'inscription
**et** `migrate.js:seedComptaConfigForExistingEntreprises` rétroactivement) :
- `COMPTES_DEFAUT` = plan **générique** (codes `121000` Clients / `211000` Fournisseurs /
  `101401` Banque / `101402` Caisse / `400000` Ventes / `500000` Coût des ventes /
  `251000` TVA collectée / `131000` TVA déductible) — **pas un PCG national**, portée mondiale
  (cf. [[feedback_global_scope_not_local]]).
- `JOURNAUX_DEFAUT` = `INV` (sale, refund_sequence) / `BILL` (purchase, refund_sequence) /
  `BNK` (bank) / `CSH` (cash) / `MISC` (general), chacun relié à son compte par défaut.

**Numérotateur** : `server/src/utils/journalSequence.js:prochainNumeroJournal(client, journalId, entrepriseId, date, {refund})`
→ `CODE/AAAA/NNNN` (ou `RCODE/AAAA/NNNN` pour un avoir si le journal a `refund_sequence`).
L'année est dans le préfixe → remise à zéro annuelle automatique (nouveau préfixe = nouveau
compteur). Incrément sous verrou de ligne (`INSERT ... ON CONFLICT DO NOTHING` puis
`UPDATE ... RETURNING`) dans la transaction de l'appelant → deux pièces concurrentes sur le
même journal ne peuvent pas recevoir le même numéro. **Aucun appelant pour l'instant** —
l'étape 3 (`account.move`) le branchera.

**Routes** : `/api/journals` + `/api/accounts` — GET ouvert (scoping entreprise),
POST/PUT/DELETE gated `requireRole('admin','directeur')`, même patron que `routes/taxes.js`.
`journals.js` valide que `defaultAccountId` (si fourni) appartient à l'entreprise → 400 sinon.

**Frontend** : `ComptaConfigPanel` (repliable, dans `DevisModule` à côté de `PaymentTermsPanel`/
`TaxesPanel`) : liste journaux + comptes, ajout/suppression. i18n `comptaConfig.*` fr/en
(libellés des 19 `account_type` + 5 types de journal).

**Répétition migration** : `pg_dump agri_app` → base jetable → `migrate.js` ×2 (idempotent au
2e passage) → 9×8 comptes + 9×5 journaux seedés, 9×4 journaux avec compte par défaut résolu,
compteur vide, **totaux devis inchangés** → appliqué à `agri_app`. Fumée live : inscription
→ 5 journaux + 8 comptes seedés, `POST /api/journals` code `exp` → normalisé `EXP`. Tests :
`journals.test.js` + `accounts.test.js` (13) → suite d'intégration **120 tests / 21 fichiers**
verte. Front : build OK, 88 tests verts.

### ERP « Comptabilité » — Étape 1 : `account.tax` (taxes réutilisables) — 2026-08-30

2e étape de [[project_erp_comptabilite_roadmap]] (après l'étape 0 : validité devis + conditions
de paiement). Objectif : remplacer le `%` brut par ligne (`devis_lignes.taux_taxe`) par de
vraies taxes réutilisables, calquées sur `account.tax` d'un ERP de référence.

**Schéma** (`server/src/db/migrate.js`) :
- `devis_lignes.taux_taxe` **retirée**. `migrateTaxeDevisLignesVersAccountTax()` : pour chaque
  `(entreprise_id, taux_taxe)` distinct avec `taux > 0`, crée une `account_tax` `percent`
  nommée « TVA {taux} % » et relie les lignes concernées via la jointure, puis
  `ALTER TABLE devis_lignes DROP COLUMN taux_taxe`. Garde d'idempotence sur l'existence de la
  colonne (même patron que `migrateRemiseToPourcentage` / `migrateTaxeDevisVersLignes`). **0
  ligne réelle concernée en prod** → no-op de fait. Grep complet de `migrate.js` fait pour
  écarter une résurrection par un `ADD COLUMN IF NOT EXISTS` traînant (le piège récurrent,
  cf. [[feedback_migrate_stale_resurrection_bug]]).
- **`account_tax`** : `entreprise_id`, `name`, `type_tax_use` (sale/purchase/none),
  `amount_type` (percent/fixed/group/division), `amount NUMERIC(16,4)`, `price_include`,
  `include_base_amount`, `active`, `sequence`, `description`, `invoice_label`,
  `UNIQUE(entreprise_id, name)`.
- **`devis_lignes_taxes`** : jointure `(devis_ligne_id, tax_id)` — Many2many comme
  `sale.order.line.tax_id`. Cascade sur suppression de ligne.

**Portée du calcul (étape 1)** : `percent` (base × taux) et `fixed` (montant × quantité,
taxe à l'unité), plus `price_include` (le prix saisi est TTC → extraction de la base) et
`include_base_amount` (la taxe s'ajoute à la base des suivantes — taxe en cascade).
`group`/`division` passent le CHECK mais calculent 0 (repris avec les repartition lines
d'`account.move`, étape 3). **Aucune taxe seedée par défaut** (portée mondiale — pas de TVA
pays codée en dur, cf. [[feedback_global_scope_not_local]]).

**Calcul unique partagé** : `server/src/utils/taxeCompute.js:appliquerTaxesLigne(baseHT, quantité, taxes)`
→ `{ base, taxeTotale, parTaxe }`. Utilisé par `routes/devis.js:calculerTotal` (total stocké
dans `devis.total`) **et** `utils/devisPdf.js` (colonne « Taxes » + récap HT / par taxe / TTC).
Total ligne = `base + taxeTotale` dans tous les cas (pour une taxe classique `base == baseHT` ;
pour `price_include`, `base < baseHT`).

**Routes** : `/api/taxes` GET (ouvert, scoping entreprise) + POST/PUT/DELETE gated
`requireRole('admin','directeur')` — même patron que `routes/paymentTerms.js`. `devis.js`
`POST`/`PUT` acceptent `lignes[].taxIds` (validés contre l'entreprise appelante via
`filtrerTaxIds` — un id étranger/inexistant est ignoré en silence, pas d'erreur) et écrivent
`devis_lignes_taxes` (helper `insererLignes`, factorisé entre POST et PUT). `getDevisComplet`
agrège `taxIds` par ligne + renvoie un tableau `taxes` (référentiel) sur le devis. La route
PDF publique par token recharge aussi `taxIds` + référentiel.

**Frontend** (`src/App.jsx` `DevisModule` + nouveaux composants) : l'input `%` par ligne
devient un `TaxSelect` (menu de cases à cocher, patron `many2many_tags`) ; nouveau
`TaxesPanel` (référentiel repliable, patron `PaymentTermsPanel`) ; recalcul client-side via
`taxesLigneCalc` qui réplique `appliquerTaxesLigne` ; i18n `taxes.*` fr/en ; libellé colonne
« Taxe (%) » → « Taxes ».

**Répétition migration** : `pg_dump agri_app` restauré dans une base jetable → `migrate.js`
×2 (idempotent au 2e passage) → `taux_taxe` absente des deux tables, `account_tax` +
`devis_lignes_taxes` présentes, **totaux devis inchangés** (0 taxe = pas de recalcul) →
appliqué à `agri_app`. Fumée live : devis 10×1000 + « TVA 18 % » → total 11800 ; `taxIds`
renvoyés, référentiel joint. Tests : `taxes.test.js` (6) + bloc « Étape 1 » dans
`devis.test.js` (8 : percent, price_include, fixed, 2 taxes, cascade, remise-avant-taxe,
id étranger ignoré, PUT recalcule). Suite d'intégration : **107 tests / 19 fichiers**, verte.
Front : build OK, 88 tests verts.

Fait en passant : `appliquerTaxesLigne` extrait de `routes/devis.js` vers `utils/taxeCompute.js`
pour être partagé avec le PDF (évite une 3e copie de l'algorithme).

### Calendrier & Récoltes — now backed by the database (fixed 2026-08-13)

Both modules used to be pure `localStorage` (`agri-calendar-${farmId}` / `agri-recoltes-${farmId}`, `farmId` = the logged-in user's email) — see the browser-pass entry above for why that was a real multi-tenant bug, not just a nice-to-have. Fixed by extending the schema and following the exact remote-with-local-fallback pattern `AchatModule` already established (`App.jsx:1086-1214`: try the API, fall back to `storageGet`/`storageSet` only if the network call itself fails — keeps the app usable offline without it being the primary store):
- **`calendar_events`** — new table (`server/src/db/migrate.js`), `entreprise_id`/`user_id`/`date`/`type`/`title`/`description`. New `server/src/routes/calendar.js` (`GET`/`POST` only — the UI has no edit/delete, so neither does the route).
- **`recoltes`** — turned out to already exist as an **orphaned table** (confirmed via `\d recoltes` in the live DB and `grep`ping every route file: zero queries against it anywhere), alongside an equally-orphaned `cultures` catalog table (`recoltes.culture_id` FKs to it) — both leftovers from an earlier architecture, abandoned once the app settled on `parcelles.culture` as free text. Reused rather than shadowed with a same-purpose table under a different name: extended it with `user_id`/`parcelle`/`culture`/`qualite`/`destination` columns to match what the `HarvestsModule` form actually captures; `culture_id`/`unite`/`observations` (pre-existing columns) stay unused. New `server/src/routes/recoltes.js`, same `GET`/`POST`-only shape.
- `AgriculturalCalendarModule` and `HarvestsModule` in `App.jsx` rewired accordingly (`getCalendarEvents`/`createCalendarEvent`, `getRecoltes`/`createRecolte` in `src/lib/api.js`, writes go through `safeRequest` for the existing offline-queue mechanism). Verified via the browser: created one of each as the test entreprise, confirmed both rows landed correctly `entreprise_id`-scoped via direct `psql` queries, then cleaned up along with the rest of the test data.
- Not addressed, out of scope for this fix: neither module has an edit/delete UI today (so neither do the new routes) — add both if that UI need ever comes up. Both `HarvestsModule` and the Cultures/Poulailler achat forms also silently no-op on a missing required field with no visible error (confirmed hitting this on `Destination` while testing) — a pre-existing UX rough edge, not unique to these two modules, not touched here.

### Traçabilité parcelle → récolte → vente (added 2026-08-13)

Gap-analysis against mature agricultural ERPs (des ERP agricoles établis (Agrivi, Cropio)...) found Récoltes/Devis/Finances were disconnected islands — no way to tell which parcelle's harvest a given sale came from. Full context and the two options considered are in memory `project_tracabilite_parcelle_vente`; the user picked the lightweight option (nullable FK tags, no stock/quantity enforcement) over building real lot-depletion tracking, deliberately deferring the latter until the Devis state machine has a stable production track record.

**Investigation finding that simplified the work**: the app has two superficially-parallel "vente" code paths — `cultures_mouvements`/`MovementTab` and `devis_lignes`/`DevisModule` — but only the second is actually live. `MovementTab` (`App.jsx:174-549`) and `createCulturesMouvement`/`updateCulturesMouvement`/`deleteCulturesMouvement` (`src/lib/api.js`) are dead code: imported/defined but never rendered or called anywhere. Both Cultures' and Poulailler's "Ventes" tabs render `<VentesWithDevis>` → `DevisModule`, so `devis_lignes` was the only real anchor point needed.

- `recoltes.parcelle_id` (nullable FK → `parcelles.id`) and `devis_lignes.recolte_id` (nullable FK → `recoltes.id`) added in `server/src/db/migrate.js`. The pre-existing free-text `recoltes.parcelle` column is kept alongside `parcelle_id` for display/fallback, not replaced.
- **Tenant-isolation validation added on both new FKs** — `server/src/routes/recoltes.js`'s `POST /` and `server/src/routes/devis.js`'s `POST /`/`PUT /:id` (via a shared `validerRecolteIds` helper in `devis.js`) verify the referenced `parcelle`/`recolte` actually belongs to `req.user.entrepriseId` before storing the id, silently storing `null` otherwise rather than erroring — mirrors the seriousness the codebase already gives this class of bug (see the `achats_lignes` cross-tenant deletion hole documented above). Verified with real cross-tenant curl calls (two throwaway entreprises, one token per company): a devis ligne referencing another company's `recolteId`, and a récolte referencing another company's `parcelleId`, both came back `null` in the response and in the DB — no leak, no 500.
- Frontend: `HarvestsModule`'s "Parcelle" field is now a `<Select>` sourced from `getParcelles()` (with an "Autre parcelle" free-text fallback) instead of a free-text `Field`, and `DevisModule`'s per-ligne form gained an optional "Récolte liée" `<Select>` sourced from `getRecoltes()`. Both mirror `AchatModule`'s existing fournisseur-dropdown pattern (`App.jsx:1116-1125` load, `~1307-1316` JSX, `~1136-1138` derived display name) verbatim rather than inventing a new one. The devis detail modal resolves `ligne.recolteId` against the already-loaded `recoltes` list and shows a small "🌾 Parcelle A — 13/08/2026" line under the product name when set — traceability that's actually visible, not just stored.
- Accepted limitation: `DevisModule` has no `moduleType` prop (unlike `AchatModule`), so the "Récolte liée" dropdown shows up even when creating a devis from the Poulailler screen, where it's simply not relevant/usable. Not fixed — would need threading a prop through `VentesWithDevis` for no real benefit yet.

### Navigation — sticky header, and a `category` field prepping future grouping (added 2026-08-13)

User feedback (real product/design opinion, not a bug report): the top nav is 15 flat chips (`availableTabs`) that already wrap to 2-3 rows and, worse, weren't pinned — scrolling into any module's content lost access to switching tabs entirely, forcing a scroll back to the top every time. Compared unfavorably to des ERP établis (SAP Business One, NetSuite), which group nav into a sidebar/mega-menu and always keep it reachable.

Two changes, deliberately scoped to **not** change the visible layout beyond making it pinned (a real IA redesign — sidebar, grouped mega-menu — was explicitly deferred until there's real usage data to base groupings on):
- **`category` field added to every `availableTabs` entry** (`App.jsx`, `~line 4269`) — `'operations'` (Calendrier/Récoltes/Cultures/Poulailler/Notifications/Observations), `'analyse'` (Assistant IA/Prévisions/Rapports), `'commercial'` (Clients/Fournisseurs), `'finance'` (Finances), `'rh'` (Employés), or `null` for Accueil/Profil. **Nothing reads this field yet** — pure data-prep so a future grouped-nav UI (sidebar or otherwise) is a rendering change on top of already-categorized data, not a data-modeling change bundled with a risky visual redesign.
- **Header made `position: sticky`**: the topbar + online/sync-status row + the nav-chip row were restructured into one shared sticky wrapper (previously the nav-chip row lived inside `dashboard-shell`, a separate, non-sticky sibling — moved to render inside the same wrapper as the topbar, conditioned on `screen === 'dashboard'`, so all three stay pinned together without needing to hand-calculate stacked `top` offsets for multiple independent sticky elements).
  - **Real bug hit and fixed along the way**: `.topbar`'s `backdrop-filter: blur(10px)` (paired with `background: rgba(255,255,255,0.96)`) caused a genuine Chromium rendering glitch once the element became `position: sticky` — inconsistent/stale paints during scroll (topbar appearing to detach, render at the wrong vertical position, or leave blank gaps), reproduced via automated scrolling and confirmed via `getBoundingClientRect()` mismatches against what was actually painted. This is a known bug class (`backdrop-filter` + `position: sticky` compositing in Chromium). Fixed by dropping `backdrop-filter` and making the background fully opaque (`#FFFFFF`) — the blur was pointless anyway once the whole sticky header got its own solid `COLORS.bg` background from the wrapper.
  - Verified via real scrolling (both the module-selection screen and actual dashboard/module content) after the fix: header stays correctly pinned, no repaint artifacts, tab-switching works mid-scroll, `npm test` still green.

### `Card` silently dropped `onClick` — broke selecting anything but the first Client/Fournisseur (fixed 2026-08-13)

User-reported: in Clients, clicking any card other than the first did nothing — the detail panel on the right never updated. Root cause in `src/components/ui.jsx`: `export function Card({ children, style })` only destructured `children`/`style` and forwarded neither `onClick` nor any other prop to the underlying `<div>` — so `<Card onClick={() => setSelectedId(client.id)}>` (`ClientsModule`, `App.jsx`) silently did nothing on every card. The *first* client only ever appeared selected because `ClientsModule`'s load effect auto-selects `loaded[0].id` on mount — not because clicking worked.

Same copy-pasted pattern, same bug, in `FournisseursModule` (`App.jsx`) — confirmed and fixed identically. Grepped for any other `<Card ... onClick` usage in `App.jsx`; these two were the only ones (everything else that needs click behavior already uses `<button>`/`<Button>`, which do handle `onClick` correctly).

Fixed by widening `Card`'s signature to `{ children, style, ...rest }` and spreading `{...rest}` onto the `<div>` — mirrors the pattern `Button` in the same file already uses (`{...rest}`), so `Card` now transparently forwards `onClick` and anything else callers pass, instead of only the two props someone happened to need when it was first written. Verified with 3 throwaway clients and 2 fournisseurs: clicking any non-first card now updates the detail panel and its selection border correctly.

### Hosting/HTTPS — deployable config ready, going live still blocked on the user (2026-08-13)

User decided the approach: a VPS (**DigitalOcean**, chosen over a managed PaaS like Railway/Render specifically to reuse the existing docker-compose stack as-is) with **Caddy** in front for automatic HTTPS (zero-config Let's Encrypt — no manual certbot). No domain picked yet, so nothing is actually deployed publicly; what's below is prepared and locally verified, waiting on the user to create the DigitalOcean account/Droplet and buy a domain — account creation and purchases aren't something to do on someone's behalf.

- **`docker-compose.prod.yml`** (new, override file — `docker-compose.yml` itself is untouched) — adds a `caddy` service (image `caddy:2-alpine`, publishes `80`/`443`, persists Let's Encrypt state in `caddy_data`/`caddy_config` named volumes so certs survive restarts and don't hit Let's Encrypt's rate limits), and strips the direct host-port publishing from `db`/`backend`/`frontend` so only Caddy is reachable from outside the Droplet — otherwise the raw HTTP backend/frontend and even Postgres itself would still be sitting open on the public internet, defeating the point of adding HTTPS. Removing a list-typed key (`ports:`) in a Compose override needs the `!reset []` tag (plain `ports: []` does **not** work — verified empirically: Compose's default list-merge behavior left the base ports untouched, silently). Local dev is unaffected: plain `docker-compose up` (no `-f docker-compose.prod.yml`) still publishes `5433`/`4000`/`8090` exactly as before.
- **`Caddyfile`** (new) — routes `/api/*` to `backend:4000`, everything else to `frontend:80`, both under one `{$DOMAIN}` (env var, set in `.env` once a domain exists). Putting frontend and backend on the same public origin means production `VITE_API_URL` becomes `https://<domain>/api` — frontend and backend share an origin in prod, sidestepping the cross-origin `cors()`-wide-open situation that exists in local dev (`:8090` vs `:4000`) rather than needing to lock CORS down separately.
- **Verified locally** (`DOMAIN=localhost docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d`, then torn back down): Caddy started, correctly fell back to its internal local CA for TLS (expected — Let's Encrypt only works for real publicly-resolvable domains, so this is what confirms the config is right without owning a domain yet), HTTP→HTTPS redirect returned `308`, the frontend served over HTTPS returned `200`, and `POST /api/auth/login` through `/api/*` reached the real Express backend (confirmed via its actual JSON error body, not a Caddy-level error page). Confirmed `db`/`backend`/`frontend` no longer had any `ports:` block in the merged config. Afterward, reverted to plain `docker-compose up` and confirmed `:8090`/`:4000` both serve normally again — no regression to local dev.
- **Deploy command once there's a Droplet + domain**: `DOMAIN=<domain> docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` (with `.env`/`server/.env` populated with real prod values, `DOMAIN=<domain>` added to the root `.env`, and `VITE_API_URL=https://<domain>/api` for the frontend build arg).
- **Still needed from the user, in order**: (1) create a DigitalOcean account + Droplet (Ubuntu, smallest plan is enough to start), (2) buy a domain and point its DNS `A` record at the Droplet's IP, (3) install Docker/Docker Compose on the Droplet and clone the repo there, (4) fill in `.env`/`server/.env` with real production secrets. Happy to walk through each step live once the user's ready — didn't pre-write a detailed step-by-step here since exact steps depend on choices not made yet (Droplet region, registrar).

### `observations` table now created by `migrate.js` (fixed 2026-08-13)

Closed the process gap flagged repeatedly above: the `CREATE TABLE observations` statement (already FK-fixed to `users`, not `utilisateurs`) from `migrations/001_create_observations_table.sql` is now folded directly into `server/src/db/migrate.js`. Any environment that runs the documented migration command gets this table automatically now — no more manual `psql -f` step. Verified by rebuilding the backend image and re-running `migrate.js` against the dev DB: succeeded with no error (idempotent — the table already existed from the earlier manual fix, so this mainly confirms the `CREATE TABLE`/FK syntax is valid, which is what matters for a genuinely fresh database). `migrations/001_create_observations_table.sql` itself is now superseded/historical, not deleted.

### "Configurer votre entreprise" — reappears every login until admin/directeur actually validates it (fixed 2026-08-13, corrected same day)

User-reported: after finishing (or skipping) the post-registration "Configurer votre entreprise" onboarding screen (banques/salariés wizard, `screen === 'onboarding-choice'` in `App.jsx`), it kept coming back on every subsequent login and every page reload — forever, not just for new entreprises.

**First attempt was wrong, corrected the same day after clarifying the actual requirement with the user.** The initial fix persisted a one-time "done" flag in `localStorage` (`agri-onboarding-done`) — any exit from the wizard (skip or complete) marked it permanently done and it never showed again. That's not what was actually wanted: the real spec is (a) only **admin**/**directeur** should ever see this screen, never other roles, and (b) it should keep reappearing **every login** until the entreprise's banking and staffing setup is genuinely resolved — either real data exists, or the director explicitly confirms it isn't needed. A one-time browser flag can't express "resolved" as an ongoing fact about the entreprise, and `localStorage` is scoped to one browser anyway — the same director logging in from a second device would wrongly see it again. Landed on a fully server-driven design instead, per explicit user instruction ("tout doit passer par le serveur").

- **`entreprises.banque_non_requise` / `entreprises.salarie_non_requis`** (both `BOOLEAN NOT NULL DEFAULT FALSE`, `server/src/db/migrate.js`) — explicit "I don't need this" confirmations, one per wizard step.
- **`server/src/routes/entreprise.js`**: `GET /onboarding-status` (any authenticated user of the entreprise) computes `{ banqueOk, salarieOk }` — `banqueOk` = at least one row in `banques` for the entreprise **OR** `banque_non_requise`; `salarieOk` = at least one non-`Inactif` row in `salaries` **OR** `salarie_non_requis`. `PUT /onboarding-status` (`requireRole('admin', 'directeur')`, same gate as the `finances` write routes) sets either flag, `COALESCE`-style partial update like the existing `PUT /entreprise` in the same file. `src/lib/api.js` wrappers: `getOnboardingStatus()`, `updateOnboardingStatus(payload)`.
- **`App.jsx`**: new shared `checkOnboardingNeeded(uiRole)` helper (called from both `handleAuth` and the mount-time token-check effect, replacing the old `storageGet`/`storageSet` calls) — for any role other than `admin`/`directeur` it sets `isOnboarding(false)` **without calling the API at all** (verified via the browser's network tab: zero requests to `/entreprise/onboarding-status` when logged in as `ouvrier`); for admin/directeur it fetches the real status and sets `isOnboarding(!(banqueOk && salarieOk))`. `goToDashboard` no longer marks anything as done — completion is recomputed fresh from the server on every login, not memorized at exit, which is exactly what makes "Plus tard" naturally mean "ask me again next time" instead of "never ask again."
- The wizard's two "Passer cette étape" buttons (`onboarding-banques`, `onboarding-salaries`) were relabeled into real, persisted confirmations instead of silent skips: **"Je n'ai pas de compte bancaire (caisse uniquement)"** calls `updateOnboardingStatus({ banqueNonRequise: true })`, **"Je travaille seul, pas de salarié à ajouter"** calls `updateOnboardingStatus({ salarieNonRequis: true })` — both before advancing to the next screen. The "Suivant"/"Terminer" buttons are untouched: if the director adds a real bank account or employee through `BanquesModule`/`EmployeesModule` on those same screens, `banqueOk`/`salarieOk` are already `true` next login purely from the real data, no confirmation click needed.
- Verified end-to-end with throwaway entreprises: fresh admin registration → wizard shown → clicked both confirmation buttons → `psql` confirmed both columns flipped to `true` → reload and explicit logout/login both skipped the wizard. Repeated via direct API calls with a *second* throwaway entreprise using real data instead of confirmations (`POST /api/banques` + `POST /api/salaries`, no confirmation calls) — `GET /onboarding-status` still correctly returned `{banqueOk:true, salarieOk:true}`. Created an `ouvrier`-role employee login in the first entreprise and confirmed logging in as them lands straight on the dashboard with no wizard and no `/onboarding-status` network call. All test data cleaned up after.

### Employés — coordonnées de contact + formulaire de modification (fixed 2026-08-13)

User-reported: impossible to edit an already-registered employee's info at all. Root cause: `EmployeesModule` (`App.jsx`) had an "Ajouter un employé" form and a list, but the list only ever had a delete (`Trash2`) button — no edit UI existed, even though `PUT /api/salaries/:id` already worked server-side. On top of that, the user specifically wanted contact fields (email/téléphone/adresse) added, which didn't exist in the `salaries` schema at all before this fix.

- **`salaries.email` / `salaries.telephone` / `salaries.adresse`** (all nullable `TEXT`, `server/src/db/migrate.js`) — the employee's *personal* contact info, distinct from the login-account email on `users` (joined via `entreprise_utilisateurs`).
- **`server/src/routes/salaries.js`**: `SALARIE_COLUMNS` extended with `s.email, s.telephone, s.adresse`; the pre-existing joined login-account email (`u.email`) renamed from `email` to `compteEmail` in the SELECT alias to avoid a name collision with the new personal `email` column — this also required renaming the account-creation request field in `POST /` (was `email`, now `compteEmail`) so "create a login for this employee" and "this employee's personal email" can't be confused in the request body. `POST /` and `PUT /:id` both now accept/persist `email`, `telephone`, `adresse`.
- **`src/App.jsx` (`EmployeesModule`)**: add-form gained "Email personnel"/"Téléphone"/"Adresse" fields (and its account-creation email field was relabeled "Email de connexion", bound to `form.compteEmail`). A real edit flow was built from scratch: a gear-shaped (`Settings2`, chosen deliberately over the codebase's usual `PencilLine` pencil icon — user explicitly asked for a non-pencil alternative, offered a few options via `AskUserQuestion`, they picked the gear) button per employee row opens a modal pre-filled with all fields (including the new contact ones) and saves via `updateSalarie` (id, payload) — the first real caller of that function, which had been imported but dead code until now. The employee-list row display was updated to show `emp.telephone`/`emp.email` (personal) and, separately, `emp.compteEmail` prefixed "Connexion :" when the employee has a linked login account.
- Verified end-to-end, both via direct API calls and a real browser click-through (throwaway entreprise, cleaned up after): created an employee with all three contact fields via the UI, confirmed they saved and displayed correctly, then opened the edit modal, changed téléphone/adresse, saved, and confirmed both the UI list and a direct `psql` query reflected the update. `npm test` (root) and `server/npm test` still green.

### Cultures Stocks + universal modal-edit + gear icon + Calendrier edit (2026-08-13)

User-requested batch: (1) a "Stocks" tab in Cultures & irrigation (Poulailler already had one), (2) the ability to correct a stock quantity in both modules (Poulailler previously had **no edit at all**, only add/delete), (3) `PencilLine` (crayon) replaced by `Settings2` (engrenage) everywhere as the "modifier" icon — user explicitly rejected the pencil after being shown alternatives via `AskUserQuestion`, matching the choice already made for `EmployeesModule` earlier the same day, (4) every "Modifier" action opens a **separate window**, not an inline form, (5) Calendrier gains the ability to edit an event (previously add-only).

- **DB** (`server/src/db/migrate.js`): new `cultures_stocks` table, identical shape to `poulailler_stocks` but with `entreprise_id` (`NOT NULL`) present from creation. **Real bug found and fixed while modeling the new table**: `poulailler_stocks.entreprise_id` exists live (`NOT NULL`, FK'd) but was never created by this script — only `user_id` was ever added via `ALTER TABLE`; `entreprise_id` must have been added out-of-band at some point (same class of gap as `salaries`/`observations` documented elsewhere in this file). A genuinely fresh DB running the documented migration would have crashed the moment `routes/poulailler.js` touched the stocks table. Fixed by adding `entreprise_id` to the `CREATE TABLE` (fresh installs) plus a nullable `ALTER TABLE ADD COLUMN IF NOT EXISTS` fallback + index (already-migrated installs) — not forced `NOT NULL` via migration to avoid breaking any existing rows on an install that hit this gap.
- **Backend**: `routes/poulailler.js` gained `PUT /stocks/:id` (didn't exist before — stock quantities were add/delete only). `routes/cultures.js` gained a full `GET/POST/PUT/DELETE /stocks` set mirroring Poulailler's, with its own `STOCK_COLUMNS`. `routes/calendar.js` gained `PUT /:id` (previously GET/POST only, per the existing "no edit UI, so no route" convention documented above — that convention no longer applies, edit UI now exists).
- **`StocksTab` generalized** (`src/App.jsx`) rather than duplicated — same pattern already used for `AchatModule`'s `moduleType` prop. New `STOCK_API` lookup table maps `moduleType` (`'Poulailler'` | `'Cultures'`) to its `{get,create,update,remove}` functions; `CULTURES_STOCK_CATS = ['Semences', 'Engrais', 'Produits phytosanitaires', 'Autre']` replaces Poulailler's categories when `moduleType === 'Cultures'`. The Poulailler-specific `DEFAULT_STOCKS` seeding (3 fake starter items) only fires for `moduleType === 'Poulailler'` — Cultures starts genuinely empty rather than seeding invented agricultural data. `CulturesModule` gained a `Stocks` tab (`Package` icon) between Carte and Ventes.
- **Universal modal-edit refactor**: `MovementTab`, `DevisModule`, `AchatModule`, `ClientsModule`, `FournisseursModule` all previously reused their single "Ajouter..." form for editing too (repopulate + relabel button to "Mettre à jour") — the *only* prior modal-edit precedent in the whole app was `EmployeesModule` (built earlier the same day). All five now follow that same precedent: a separate `editForm`/`editingId`/`editSubmitting` state trio, `startEdit`/`cancelEdit`/`saveEdit` (or `submitEditForm`) functions, and a `position: fixed` overlay modal — the add-form goes back to being purely for adding, never repurposed for editing. `StocksTab`'s brand-new edit capability was built the same way from the start, for consistency. `MovementTab`'s edit modal still requires the mandatory "raison de la modification" `window.prompt()` for remote (non-local) rows, same as before — only *where* the form renders changed, not the audit-trail requirement. `DevisModule`'s edit modal reimplements the full multi-ligne product-row editor (add/remove/update ligne, récolte-liée selector) inside the modal, since a devis edit needs the same rich form as creation.
- **Icon swap**: `PencilLine` import removed entirely from `App.jsx` (was only used by the 5 components above) — `Settings2` is now the sole "modifier" icon across the whole app, consistent with `EmployeesModule`/`StocksTab`.
- **Calendrier** (`AgriculturalCalendarModule`): the "Prochaines activités" card (next 6 *upcoming* events only) is now "Tous les événements" — all events, past and future, in a scrollable list — specifically so a data-entry error on an already-past event is still reachable to fix, not just future ones. Each row gets a gear button opening an edit modal (date/type/titre/description), wired to the new `updateCalendarEvent`.
- Verified via direct API calls (stock CRUD both modules incl. a cross-tenant `PUT` correctly 404ing instead of leaking) and a real browser click-through (throwaway entreprise, cleaned up after): added + edited a Cultures stock item via its new modal, edited a client via its new modal (confirmed the add-form stayed empty/independent throughout), and fixed a typo'd calendar event via its new modal — all three round-tripped correctly through the UI, toast, and list re-render. `npm run build`, root `npm test`, and `server/npm test` all still pass.

### Achats never synced to Finances, and Comptabilité showed nothing real (fixed 2026-08-13)

User-reported: purchases made in Cultures/Poulailler never showed up in either the module's own "Comptabilité" sub-tab or in the global Finances module. Root cause: `AchatModule` (the actual multi-lignes purchase form users interact with) writes to `achats_documents`/`achats_lignes`, a table introduced later than — and never connected to — two older mechanisms that predate it:
- `routes/achats.js` never called `financeSync.js` at all, so no purchase ever created a `finances` row, regardless of module.
- `ComptabiliteTab`'s `remoteVentes`/`remoteAchats` props (in both `CulturesModule` and `PoulaillerModule`) were still wired to `getCulturesMouvements`/`getPoulaillerMouvements` — the `cultures_mouvements`/`poulailler_mouvements` tables, which are dead code fed by nothing (`MovementTab`, the only thing that ever wrote to them, isn't rendered anywhere — see the "Traçabilité" section above, which already flagged this for ventes; it turns out achats have the exact same disconnect). So the sub-tab was structurally incapable of showing a real purchase, no matter how many were made.

**Finances sync** (`server/src/utils/financeSync.js`, `server/src/routes/achats.js`): added `syncAchatDocumentFinance`/`updateAchatDocumentFinance` — document-level siblings of the existing `syncFinanceEntry`/`updateFinanceEntry`, which take a pre-computed `total` instead of `quantite × prixUnitaire` (an `achats_documents` row is multi-line, so there's no single quantite/prixUnitaire to work from). Wired into `POST /achats` (create → `-total` finance entry), `PUT /achats/:id` (update → finance entry's montant/description updated in place, same `updateFinanceEntry` philosophy of preserving history instead of delete+recreate), and `DELETE /achats/:id` (removes the finance entry via the existing generic `removeFinanceEntry` — the delete route now selects `module` before deleting the document, needed to find the matching finance row).

**Comptabilité reconnected to real data** — but ventes and achats needed different treatment, discovered while planning: `achats_documents` has a `module` column (`'Cultures'`/`'Poulailler'`), so achats can be correctly split per module; `devis` (the real ventes source, via `DevisModule`) has **no module column at all** — a limitation already called out as deliberately accepted in the Traçabilité section above (no `moduleType` prop on `DevisModule`). Presented this to the user as a real decision (same-total-everywhere vs. add a module column to devis vs. leave ventes broken) — chose **same total everywhere**: no schema change, `Ventes` in both Cultures's and Poulailler's Comptabilité tabs shows the entreprise's whole sales figure, not a per-module split.
- `GET /api/achats/ledger?module=X` (new, `routes/achats.js`) — flattens `achats_lignes` (joined to `achats_documents` for `date`/`fournisseur_nom`) into the flat `{id, date, produit, partenaire, quantite, prixUnitaire}` shape `ComptabiliteTab` already expects, scoped by module.
- `GET /api/devis/ledger` (new, `routes/devis.js`) — same flattening for `devis_lignes` (joined to `devis`/`clients`), entreprise-wide (no module filter, per the decision above), **excluding `Brouillon`** devis — a draft isn't a committed sale yet, so it shouldn't count as a "vente" in this ledger (mirrors the general principle already used for Finances: money/sales only get recorded once a transaction is real, not while still provisional).
- `src/lib/api.js`: `getAchatsLedger(module)`, `getVentesLedger()`. `App.jsx`: both `ComptabiliteTab` call sites (`CulturesModule`, `PoulaillerModule`) rewired from the dead `getCulturesMouvements`/`getPoulaillerMouvements` to these new ledgers.
- **Deliberately not touched**: the "Historique des modifications et suppressions" button inside `ComptabiliteTab` still reads from `mouvementHistorique.js`'s log of edits/deletes on the old `cultures_mouvements`/`poulailler_mouvements` rows — it was already disconnected from real achats/ventes before this fix (nothing ever wrote to that historique for `achats_documents`/`devis` edits) and remains so; fixing it would mean extending the audit-log mechanism to achats/devis edits, out of scope for what was asked here.
- Verified end-to-end: direct API test (create achat → `finances` shows `-total` immediately; update → finance entry's montant updates in place; delete → finance entry removed; `achats/ledger` correctly module-scoped, confirmed empty when queried under the other module) plus a devis test (Brouillon excluded from `devis/ledger`, appears immediately after `valider-manuel` moves it to `Signé`, with the client's full name resolved correctly as `partenaire`) plus a full real-browser pass (registered a throwaway entreprise, created a real achat through `AchatModule`'s UI, confirmed it appeared correctly in both the Comptabilité sub-tab and the Finances module). All test data cleaned up after.

### Finances module misclassified auto-synced achats as revenue (fixed 2026-08-14)

Follow-up to the achats→Finances sync fix above, caught by the user immediately after: their new achat *did* land in Finances (confirmed the sync itself worked), but rendered in **green with `+-29 975 FCFA`** instead of red with `-29 975 FCFA`, and didn't count toward the "Dépenses" total/chart. Root cause in `src/modules/finances.jsx` (frontend-only, no backend change needed): `isDepense` was determined purely by `categorie` membership in `CATEGORIES_DEPENSES` (`['Depenses diverses', 'Carburant', 'Salaire', 'Entretien']`) — but `syncFinanceEntry`/`syncAchatDocumentFinance`/`syncDevisPaiement` (all pre-existing or added in the section above) always use `categorie = 'Caisse'` or `'Banque'` for auto-synced entries, since that field doubles as "which account did the money move in/out of" for those rows, encoding revenue-vs-expense purely in the sign of `montant` instead (positive for vente/paiement, negative for achat) — a genuinely different convention from manually-entered rows, where `montant` is always stored as a positive magnitude and Caisse/Banque vs. a Dépenses-category is what carries the sign. The display logic only ever handled the manual-entry convention.

Fixed by combining both signals: `isDepenseEntry = (e) => CATEGORIES_DEPENSES.includes(e.categorie) || Number(e.montant) < 0`, then using `Math.abs(Number(entry.montant))` everywhere a magnitude is displayed or summed (the row's amount cell, `totalDepenses`, `totalRevenus`, and both mini-chart datasets) instead of the raw signed value — this uniformly handles both storage conventions without ever double-applying the sign. `totalCaisse`/`totalBanque` (and `soldesParBanque`) were deliberately left summing the **signed** `montant` as before — those represent a running account balance, where an achat correctly needs to subtract and a vente correctly needs to add, so the sign must stay real there; only the revenue/expense *classification and display* needed fixing, not the balance math.

Verified via a real browser pass (throwaway entreprise, achat created via `AchatModule`'s UI): the row now shows a red "Caisse" badge and `-30 000 FCFA` in red (no more `+-`), "Depenses" card reads `30 000 FCFA`, "Benefice net" reads `-30 000 FCFA`, and the achat appears in the "Depenses recentes" mini-chart. All test data cleaned up after.

**Backfilled 2026-08-15**: of the achats predating the original sync fix in the user's real entreprise (`entreprise_id = 1`), only **one** actually turned out to be missing a `finances` row on inspection (not two, as first estimated) — `achats_documents.id = 4` (Cultures, fournisseur "vfgfdg", 28 000 FCFA, created 2026-08-13 21:27:42). The other two documents in that entreprise (`id = 7`, `id = 9`, both Poulailler) were created after the 23:40 fix and were already correctly synced. Backfilled by hand with a direct `INSERT INTO finances` mirroring `syncAchatDocumentFinance`'s exact shape (`type = 'Banque'`, `montant = -28000.00`, same `banque_id` the other synced entries use), using the document's **original** `created_at` timestamp rather than today's date, so it sorts correctly in Finances history. Verified the row exists (`finances.id = 78`) with the right values.

### Rapports/Prévisions read dead `localStorage` keys, and a real nginx caching bug found while verifying the fix (2026-08-15)

Gap-analysis against the roadmap flagged `ReportsModule`/`ForecastingModule` (the "Rapports"/"Prévisions" tabs) as suspicious: unlike every other module already migrated to the real backend, both still read via `storageGet` from `localStorage` keys (`poulailler-ventes-${farmId}`, `poulailler-achats-cultures-${farmId}`, `poulailler-clients-${farmId}`, `poulailler-finances-${farmId}`, `cultures-parcelles-${farmId}`, etc.) that nothing has written to since the app moved to `achats_documents`/`devis`/`finances` — the same dead-data pattern already fixed elsewhere (Calendrier/Récoltes, Achats↔Finances sync). Confirmed both were rendering empty/fallback-default numbers instead of real figures.

**Fixed** by rewiring both to the real endpoints already used elsewhere in the app: `getAchatsLedger('Cultures'|'Poulailler')` + `getVentesLedger()` (entreprise-wide, excludes `Brouillon`, same source `ComptabiliteTab` already uses) + `getRecoltes()` for `ReportsModule`; `getParcelles()` + `getPoulaillerStocks()` + `getVentesLedger()` + `getRecoltes()` + `getFinances()` for `ForecastingModule`. Both gate the achats/parcelles/stocks calls on `activated.cultures`/`activated.poulailler` (mirroring `HomeOverview`'s existing pattern) since those are ungated for ventes/récoltes/finances. `ForecastingModule`'s revenue/expense split also carried the **same pre-fix bug** the Finances module had (`categorie` was compared against `['Caisse','Banque']`/`['Dépenses diverses',...]` — the manual-entry-only convention, which misses auto-synced achats/ventes entirely since those use `categorie='Caisse'|'Banque'` with the sign carrying the classification) — fixed in the same pass by reusing the corrected `isDepenseEntry` convention from `finances.jsx` (`CATEGORIES_DEPENSES.includes(categorie) || montant < 0`). `ForecastingModule`'s "chiffre d'affaires historique généré par les clients" note (previously read a nonexistent `client.historique` array) now sums the real `getVentesLedger()` total.

**A second, more consequential bug was found while verifying this fix in the browser, not in the code being reviewed**: after rebuilding and redeploying the `frontend` Docker image multiple times, the running app kept showing the *old* pre-fix numbers no matter how many times the page was reloaded — confirmed via `docker exec` that the container was serving the correct freshly-built JS bundle (new content hash each time), and via a direct `fetch(..., {cache:'no-store'})` from the browser that the server-side `index.html` correctly referenced the new hash — yet `document.querySelector('script[type="module"]').src` on the *live* page kept resolving to a stale bundle hash from an earlier build. Root cause: `nginx.conf` served `index.html` with no `Cache-Control` header at all, so the browser applied HTTP heuristic caching and kept reusing an old cached copy of `index.html` (which embeds the current build's hashed script filename) indefinitely across reloads, never re-requesting it from the server. Since Vite already content-hashes everything under `/assets/*`, this is backwards: `index.html` (the one file that must always be revalidated) was cacheable, while the hashed assets (safe to cache forever) had no explicit long-lived cache policy either.

**Fixed in `nginx.conf`**: `/assets/` now gets `Cache-Control: public, max-age=31536000, immutable` (safe — a new build always gets a new filename); `/` (i.e. `index.html` via the SPA fallback) now gets `Cache-Control: no-cache` (always revalidates with the server, so a new deploy is picked up on next load without users needing a hard-refresh). This is a real, previously-unnoticed **production deployment bug** independent of the Rapports/Prévisions fix — without it, every future `docker-compose up -d --build frontend` deploy (including the eventual real Jalon 4 production rollout) would leave already-open browser tabs/returning users stuck on stale JS until they manually hard-refreshed. Verified by curling both routes post-fix and confirming the headers; the stale-bundle behavior could still be reproduced against the *browser's pre-existing cache entry* from before the header fix (expected — the fix only prevents *future* staleness, it can't retroactively invalidate what a browser already cached under the old, header-less responses) but resolved cleanly with a cache-busted URL, confirming real production users (whose browsers never cached the old header-less responses) won't hit this.

Verified end-to-end in the real browser (production Docker build, real entreprise data, not throwaway test data): Prévisions now shows real figures (e.g. "34 431 361 FCFA" ventes prévues, "831 316 585 FCFA" de chiffre d'affaires client historique, matching the real `devis/ledger` total exactly); Rapports (Mensuel) shows "1 325 375 FCFA" ventes / "2 579 491 FCFA" achats (the achats figure matches "Dépenses du mois" on the dashboard exactly) / "1 000 kg" récoltes (matches the one real `recoltes` row). `npm run build`, `npx vite build`, and root `npm test` all still pass.

**`AIAssistantModule` and `NotificationsModule` fixed the same day**, same dead-`localStorage`-key pattern, same real-endpoint rewiring:
- `AIAssistantModule` ("Assistant IA" Q&A facts): `getParcelles()`/`getPoulaillerStocks()` (gated on `activated.cultures`/`activated.poulailler`, matching `ForecastingModule`'s pattern) + `getVentesLedger()` + `getFinances()`, with the same corrected `isDepenseEntry` revenue/expense classification. The "client qui achète le plus" fact used to read a `client.historique` array that only ever existed in the old `poulailler-clients-*` localStorage shape and has no backend equivalent — replaced with an aggregation of `getVentesLedger()` by `partenaire` (the client's full name string, as returned by the ledger — no separate id/prenom/nom to key on), summing `quantite × prixUnitaire` per name and taking the top spender. `facts.bestClient` shape changed from `{prenom, nom, total}` to `{nom, total}` accordingly (the one string interpolation reading it was updated to match).
- `NotificationsModule` ("Notifications" alert list): `getParcelles()`/`getPoulaillerStocks()`/`getPoulaillerLivraisons()` (same `activated`-gated pattern — this module didn't receive `activated` as a prop before, now does, threaded through from its `App.jsx` render call) + `getDevisListe()`. The "client n'a pas payé" alert used to read `c.detteRestante` — a field that only ever existed on the fictional localStorage client shape (`clients` table has no debt/balance column at all, confirmed via `\d clients`). Replaced with a real signal: devis whose `statut` is `'Non payé'` or `'Payé partiellement'` (the app's actual unpaid-invoice states, see the Devis state machine described earlier in this file), showing the client name, devis numéro, and total.

Verified end-to-end against the real entreprise data (not throwaway test data) in the browser (production Docker build — see the caching note above for why a cache-busted URL was needed to see the fresh bundle during this same testing session): "Quel client achète le plus ?" returned a real aggregated name+total from actual ventes; "Quel est mon bénéfice ce mois-ci ?" returned "29 301 399 FCFA (31 880 890 FCFA de revenus, 2 579 491 FCFA de dépenses)" — matching the dashboard's own figures exactly; Notifications showed "Sol sec — Parcelle B nécessite un arrosage", matching the dashboard's "1 parcelle à arroser" alert. `npx vite build` and root `npm test` both pass.

### Forum de feedback — MVP Must-have, built as a simple submission form, not a community forum (2026-08-15)

User's actual need (their words): just collect suggestions/frustrations/recommendations from real farmers to drive the backlog iteratively — not a public forum with threads/voting. Recommended and built the minimal version: a submission form (any authenticated user, any role) + a simple triaged list (only the platform owner, not each entreprise's admin).

**Key architectural decision, confirmed with the user**: this is the first feature in the app that needs to be visible *across* entreprises — everything else is strictly cloisonné by `entreprise_id` (see the Multi-tenant model section above), but feedback about the app itself needs to reach *the developer*, not stay siloed inside each customer's company. Rather than hardcoding a specific email as "the owner" (fragile — the user explicitly flagged they might not keep their current login email after their training), added `users.is_platform_admin` (`BOOLEAN NOT NULL DEFAULT FALSE`, `server/src/db/migrate.js`) — a flag on a normal user row, orthogonal to the existing entreprise-scoped `role` system, not a new role tier. Whoever needs to see cross-tenant feedback in the future is just one `UPDATE users SET is_platform_admin = TRUE WHERE id = ...` away, no code/redeploy needed. Bootstrapped onto the user's actual working account, `admin@agriconnect.com` (`users.id = 7`, `entreprise_id = 1`) — not `ousmane.niakate@iprec.fr`, which turned out to not match any account in this app's `users` table at all (that's the user's Claude-session identity, unrelated to their AgriConnect login).

- **`feedback` table** (`server/src/db/migrate.js`): `entreprise_id` (FK, cascade), `user_id` (FK, set-null), `type` (`'Suggestion'|'Frustration'|'Bug'|'Autre'`, default `'Suggestion'`), `message`, `statut` (`'Nouveau'|'Lu'|'Traité'`, default `'Nouveau'`, for the platform owner's triage), `created_at`.
- **`server/src/middleware/requirePlatformAdmin.js`** — mirrors `requireRole.js`'s shape but checks `req.user.isPlatformAdmin` (a JWT claim, not a live DB read — same convention `role` already uses, meaning a flag change only takes effect on the affected user's *next login*, not their current session).
- **`server/src/routes/feedback.js`**: `POST /` (`authRequired` only — any role, any entreprise, matching the "capture the most signal" decision) inserts scoped to the caller's own `entreprise_id`/`user_id`. `GET /` (`requirePlatformAdmin`) deliberately has **no** `entreprise_id` filter — reads every entreprise's feedback, joined to `entreprises`/`users` for context (`entrepriseNom`, `userEmail`). `PATCH /:id` (`requirePlatformAdmin`) updates `statut` only.
- **`server/src/routes/auth.js`**: `register`/`login`/`GET /me` all now embed `isPlatformAdmin` (JWT claim + response body) — `register` always `false` (brand-new accounts), `login`/`me` read the real `users.is_platform_admin` value. `GET /me` needed `u.is_platform_admin` added to its `SELECT`.
- **Frontend**: `src/components/FeedbackModule.jsx` (new, follows the `ObservationListView.jsx` extraction precedent rather than growing `App.jsx` further) — everyone sees the submission form; the `isPlatformAdmin` prop (threaded from `App.jsx`'s own `isPlatformAdmin` state, itself set from `login`/`register`/`me` responses and reset to `false` on logout) additionally renders the full cross-tenant list with a per-row `statut` `<select>`. New ungated `{ id: 'feedback', ... }` tab entry in `availableTabs`, same treatment as `Observations`/`Profil` (no role/`activated` gating — every user should be able to leave feedback).
- Verified end-to-end against the real `admin@agriconnect.com` account after a fresh login (needed to pick up the new `isPlatformAdmin: true` JWT claim — the token issued *before* the DB flag was set still carried `false` and would have been silently rejected by `requirePlatformAdmin` despite `/me` reporting the flag correctly, since the middleware trusts the JWT claim, not a fresh DB lookup): submitted a real "Suggestion" feedback row, confirmed it appeared instantly in the "Tous les retours reçus" list with correct entreprise/user/date, changed its `statut` to "Traité" via the dropdown and confirmed the change persisted in the DB. Test row deleted after. `npx vite build`, root `npm test`, and `server/npm test` all pass.

### Doc utilisateur minimale — page "Aide" statique dans l'app, pas un tuto interactif (2026-08-15)

Same MVP-minimal reasoning as the feedback forum: user wanted the smallest useful thing now, and let the (newly-built) feedback forum surface where users actually get stuck before investing in a real guided tour — a contextual/interactive onboarding was explicitly named as the alternative, deliberately deferred.

- **`src/components/FeedbackModule.jsx`-style extraction, no backend at all**: `src/components/HelpModule.jsx` (new) is pure static content — a hardcoded `SECTIONS` array (one entry per module: Tableau de bord, Calendrier, Récoltes, Cultures & irrigation, Poulailler, Clients & Fournisseurs, Finances & Banques, Devis & Factures, Salariés, Observations, Assistant IA, Prévisions & Rapports, Notifications, Feedback, Profil & sécurité), rendered as a single-open-at-a-time accordion (click a section header to expand it, collapses whichever was open — plain `useState` holding one open `id`, no library). New ungated `{ id: 'aide', ... }` tab in `availableTabs`, same treatment as `Observations`/`Feedback`/`Profil` (no role/`activated` gating).
- **Real, unrelated bug found and fixed while building this**: `src/index.css`'s `#root` rule (a leftover from the original Vite scaffold) sets `text-align: center` globally, and `Card` (`src/components/ui.jsx`) never resets it — so any Card content that doesn't explicitly set its own `textAlign` inherits centered text. This already affects the (already-shipped, user-accepted) `FeedbackModule`/`ObservationListView` intro text too, just not enough to be visually jarring there. Fixed locally in `HelpModule.jsx` only (explicit `textAlign: 'left'` on the intro `Card` and on each accordion section's content) rather than touching the global `#root` rule — removing `text-align: center` app-wide is the real fix but is out of scope for this task and untested against every other screen (e.g. `LoginScreen`'s centered card layout might be relying on it); flagged here, not fixed globally.
- Verified in the browser (production Docker build): all 15 sections present, accordion opens/closes correctly (single-open behavior confirmed by opening "Cultures & irrigation" while "Tableau de bord" was open — the first closed automatically), text renders left-aligned. `npx vite build` and root `npm test` pass.

### Inventaire matériel (Équipements) — premier chantier du Jalon 2 (2026-08-15)

MVP roadmap's Should-have "simple equipment inventory" item. Confirmed scope with the user before building: a fiche per equipment (nom/catégorie/état/date d'acquisition/valeur/notes) plus a maintenance-history sub-resource, and write access (create/update/delete equipement + maintenance entries) restricted to `admin`/`directeur`/`gestionnaire` — read access open to any authenticated user of the entreprise, matching how the tab itself is gated (see below), so in practice only those three roles ever see it at all.

- **DB** (`server/src/db/migrate.js`): `equipements` (`entreprise_id`, `user_id`, `nom`, `categorie`, `etat` default `'Fonctionnel'`, `date_acquisition`, `valeur`, `notes`) + `equipements_maintenance` (`equipement_id` FK `ON DELETE CASCADE`, `user_id`, `date`, `description`, `cout`) — mirrors the `cultures_stocks`/`observations` shape exactly (`entreprise_id NOT NULL REFERENCES entreprises ON DELETE CASCADE`, indexed).
- **Backend** (`server/src/routes/equipements.js`, mounted at `/api/equipements`): full CRUD on equipements (`requireRole('admin','directeur','gestionnaire')` on write, `authRequired` only on `GET`) + `GET/POST /:id/maintenance` and `DELETE /maintenance/:maintenanceId`. Every maintenance route verifies the parent `equipement` belongs to `req.user.entrepriseId` **before** touching `equipements_maintenance` (a `findOwnedEquipement` helper, or a `DELETE ... USING equipements e WHERE ... e.entreprise_id = $2` join for the delete) — deliberately following the lesson already documented above from the `achats_lignes` cross-tenant deletion hole, rather than repeating it. Verified with real cross-tenant curl calls (two throwaway entreprises): every cross-tenant read/write/delete attempt on another company's equipement or maintenance entry came back 404, never a leak.
- **Frontend**: new `src/components/EquipementsModule.jsx` (extraction pattern, like `ObservationListView`/`FeedbackModule`/`HelpModule`) — add-form Card, table list, a separate edit modal (`Settings2` icon, universal modal-edit convention) gated behind a `canManage` prop, and a detail modal (`Wrench` icon, open to everyone) showing maintenance history with its own inline add-form (also `canManage`-gated) and delete buttons. New `equipements` permission key added to `ROLE_DEFINITIONS` (`src/components/roles.js`) for `admin`/`directeur`/`gestionnaire` only — gates both the tab's visibility (`roleConfig.permissions.includes('equipements')` in `App.jsx`'s `availableTabs`) and the `canManage` prop (`['admin','directeur','gestionnaire'].includes(role)`, passed at the `{tab === 'equipements' && ...}` render site). Unlike Cultures/Poulailler/Finances, this tab is **not** gated by the `activated` module-toggle system — equipment tracking is a role-scoped utility, not a farm-activity module a company opts in/out of.
- Verified end-to-end via a real browser click-through (throwaway entreprise "Equip Browser Test SARL", registered/exercised/fully deleted after — `entreprises`/`users` rows both cleaned up, same as every other pass documented in this file): added an equipement via the UI, confirmed it listed with the correct état badge color, opened the maintenance modal and added an intervention (date defaulted to today, cost formatted correctly), then deleted the equipement and confirmed the list emptied. `npx vite build`, root `npm test`, and `server/npm test` all pass.
- Not built in this pass (explicitly out of scope, matches the Jalon 2 backlog): equipment-to-parcelle/poulailler affectation, PDF/CSV export of the inventory. RH enrichie (présences/congés/avances) — the other named Jalon 2 chantier — is untouched.

### RH enrichie — présences/congés/avances (second chantier du Jalon 2, 2026-08-15)

Second half of the MVP roadmap's "richer HR" Should-have (the first half, equipment inventory, is documented above). Investigation before building found the `salaries` table already had `presence`/`avances`/`conges` columns, but they're flat fields — a single current-status enum and two manually-typed running totals, no dates, no history, no workflow — exactly the gap the roadmap flags. Confirmed scope with the user before building: real per-day presence log, a congé workflow with an actual Demandé→Approuvé/Refusé state (not an already-decided log entry — the user explicitly chose the fuller option), and an avances ledger — all three admin-only to write (matching the existing `requireRole('admin')` gate already on every other `salaries` write route, stricter than Équipements' three-role gate), and all three **additive**, coexisting with the existing flat fields rather than replacing them (the user explicitly chose not to touch the existing add/edit employee form in this pass).

- **Found and fixed in passing**: `salaries` itself was never created by `migrate.js` — same class of gap as `poulailler_stocks.entreprise_id` documented above (a live table that grew out-of-band, with the migration script never updated to match). A genuinely fresh database would have 500'd on the very first `/api/salaries` call. Fixed by adding a `CREATE TABLE IF NOT EXISTS salaries` to `migrate.js` matching the live schema exactly (verified via `\d salaries` against the running DB first) — harmless on an already-migrated install (`IF NOT EXISTS`), fixes it for a fresh one.
- **DB** (`server/src/db/migrate.js`): `salaries_presences` (`salarie_id` FK cascade, `date`, `statut`, `notes`, `UNIQUE(salarie_id, date)` — a day is a single upserted row, not an append-only log, so re-marking today just corrects it rather than accumulating duplicates), `salaries_conges` (`date_debut`, `date_fin`, `motif`, `statut` default `'Demandé'`, `decided_by`/`decided_at`), `salaries_avances` (`date`, `montant`, `motif`).
- **Backend** (`server/src/routes/salaries.js`, extended rather than a new file — the user already had this file open, and it keeps every `salaries`-scoped route in one place): `GET/POST /:id/presences` (POST is an `ON CONFLICT (salarie_id, date) DO UPDATE` upsert), `GET/POST /:id/conges` + `PUT /conges/:congeId` (statut transition, admin-only, stamps `decided_by`/`decided_at`) + `DELETE /conges/:congeId`, `GET/POST /:id/avances` + `DELETE /avances/:avanceId`. Every route verifies the parent `salarie_id` belongs to `req.user.entrepriseId` first (`findOwnedSalarie` helper, or an `UPDATE/DELETE ... USING salaries s WHERE ... s.entreprise_id = $N` join) — same ownership-first pattern used for Équipements' maintenance sub-resource, for the same reason (the `achats_lignes` cross-tenant lesson documented above). **A real bug caught before it shipped, not after**: the first draft of `PUT /conges/:congeId`'s `RETURNING` clause reused the `CONGE_COLUMNS` constant via two chained `.replace()` calls to table-qualify it for the `UPDATE ... FROM` join — but `salaries_conges` and `salaries` both have `statut` and `created_at` columns, so the un-replaced occurrences of those two names in the returned row would have thrown "column reference is ambiguous" the first time this route actually ran. Caught by re-reading the query before testing (not by the test itself); fixed by writing the qualified column list out explicitly instead of string-hacking a shared constant across a join.
- **Frontend**: new `src/components/EmployeeRhModal.jsx` — a "Fiche RH" modal per employee (new `ClipboardList` icon added to each `EmployeesModule` row, alongside the existing edit/delete icons) with an in-modal 3-way section switch (Présences/Congés/Avances, plain `useState` holding the active section — same single-open pattern as `HelpModule`'s accordion). Congés shows Approuver/Refuser (`Check`/`X` icons) only while `statut === 'Demandé'`, so a decided request's buttons disappear rather than staying clickable. `EmployeesModule` now receives a `role` prop (threaded from `App.jsx`'s `{tab === 'employees' && <EmployeesModule farmId={user} role={role} />}` — it didn't receive one before this) to compute `canManageRh = role === 'admin'`, gating every write control in the modal (matching the backend's `requireRole('admin')`); read (viewing history) is open to whoever can already open `EmployeesModule` (admin/directeur/gestionnaire, per the `employees` permission).
- Verified end-to-end: real HTTP calls (Node `fetch`, not curl — curl's `-d` mangled accented UTF-8 like `'Présent'`/`'Approuvé'` in this shell, a shell-encoding artifact confirmed harmless by re-running the same calls through Node) against two throwaway entreprises confirmed the presence upsert (same-day re-mark updates in place, doesn't duplicate), the congé create→approve flow (`decidedBy` correctly stamped with the acting admin's user id), and cross-tenant isolation (every attempt to read/approve/delete another company's employee's présences/congés/avances came back 404). Also a full real-browser click-through (throwaway entreprise "RH Browser Test SARL", registered/exercised/fully deleted after): added an employee, opened the Fiche RH, logged a presence, requested and approved a congé, logged an avance and confirmed the running total updated. `npx vite build`, root `npm test`, and `server/npm test` all pass.
- Not built in this pass (explicitly out of scope): reconciling the new ledgers with the existing flat `presence`/`avances`/`conges` fields (e.g. making them computed/read-only) — deliberately deferred, see the scope decision above; no employee self-service (an `ouvrier` logged in as themselves still can't see or request their own congé — only admin/directeur/gestionnaire can reach `EmployeesModule` at all, so a congé "request" is really an admin logging one on an employee's behalf, same real-world flow as the rest of this module).

### Navigation — sidebar groupée par catégorie, remplace les 17 chips à plat (2026-08-15)

Follow-up to the "Navigation — sticky header" entry above: the `category` field added then to `availableTabs` was pure data-prep with nothing reading it yet. User feedback this time was a straight aesthetic complaint ("moche de voir tous les menus les uns à côté des autres") — by now 17 tabs (post-Équipements/Feedback/Aide) wrapped to 3 rows. Presented three concrete options via an interactive HTML comparison artifact (grouped sidebar / two-tier horizontal tabs / floating mega-dropdown, all built with the app's real tab labels and palette so the user could click through each) before writing any code — see memory `project_navigation_grouped_sidebar` for the full comparison and the two options not picked, kept on file in case of a future change of mind. User picked the **grouped sidebar**.

- **`SidebarNav` component** (`src/App.jsx`, defined just above `export default function App`) — a left rail with a pinned section (tabs where `category` is `null`: Accueil/Feedback/Aide/Profil) and one collapsible group per `NAV_CATEGORIES` entry (new module-level constant next to `COLORS`: `operations`→green, `analyse`→blue, `commercial`→ochre, `finance`→red, `rh`→purple `#9B6BD6`, matching the taxonomy the `category` field already used). Groups with zero matching tabs (e.g. `finance` when Finances is deactivated) render nothing. Collapse state is local `useState` per group, not persisted — reopens expanded on next load, deliberately kept simple rather than wiring it through `localStorage`.
- **Layout restructure**: the nav-chip row (previously the third row inside the sticky header wrapper) is gone; the header wrapper now holds only the topbar (logo/user/logout) and the online/sync-status row. Below it, `{screen === 'dashboard' && ...}` now renders a `.dashboard-layout` flex row (`SidebarNav` + `.dashboard-shell` content pane) instead of `.dashboard-shell` alone — `.dashboard-shell`'s old `max-width:1500px; margin:0 auto` moved onto the new `.dashboard-layout` wrapper (it's now the flex row that gets centered/capped, `.dashboard-shell` itself is just `flex:1; min-width:0`).
- **Keeping the sidebar visible while scrolling** (the whole reason the header became sticky in the first place, back in the "sticky header" entry above) needed the sidebar's own `position: sticky; top: <header height>` — hand-calculating that offset would break the moment the header's content wraps to another line (long email, narrow viewport), so it's measured live instead: a `headerRef` on the sticky header wrapper + a `ResizeObserver` writing into `headerHeight` state, which `SidebarNav` receives as its `top` prop (`maxHeight: calc(100vh - headerHeight)`, `overflowY: auto`, so an overlong sidebar scrolls internally rather than pushing the page).
  - **Real bug shipped in the first pass, caught by an actual scroll test, not code review**: the `ResizeObserver` effect had `useEffect(..., [])` — runs once on mount. But `screen` is `'login'` on first mount, so the sticky header `<div ref={headerRef}>` (rendered only when `screen !== 'login'`) doesn't exist in the DOM yet; the effect's own `if (!headerRef.current) return` bailed immediately and never ran again, leaving `headerHeight` stuck at `0` for the rest of the session. Visually this didn't look broken at the top of the page (a `top: 0` sidebar looks identical to a correctly-offset one before any scrolling), but scrolling down revealed it: the sidebar, stuck at `top: 0`, sat directly *underneath* the also-`top:0`, higher-`z-index` header, hiding Accueil/Feedback/Aide/Profil behind it — looked exactly like the pinned items had vanished or the sidebar had scrolled internally (confirmed via `getBoundingClientRect()`/`getComputedStyle` mid-bug: `top: "0px"`, no actual internal `scrollTop`, i.e. correctly rendered, just occluded). Fixed with a one-line dependency change, `[]` → `[screen]`, so the observer (re)attaches once the header div actually exists. A lesson worth remembering for any future `ResizeObserver`/`useRef` pairing gated behind conditional rendering: mounting-effect-with-empty-deps assumes the ref target exists at first render, which isn't true here (or anywhere else a ref'd element is behind a conditional).
- **Mobile fallback**: below 760px, `.sidebar-nav` drops its sticky positioning and fixed width (`position: static`, `width: 100%`) and stacks above the content (`.dashboard-layout` switches to `flex-direction: column`) — kept deliberately simple (no attempt to lay the grouped structure out horizontally, which the two-tier-tabs option that wasn't chosen would have suited better) since this is a smaller, lower-priority piece of the change.
- Verified end-to-end via a real browser click-through (throwaway entreprise "Sidebar Visual Test SARL", all modules activated to populate every category group, cleaned up after — note this entreprise had auto-seeded `parcelles`/`poulailler_stocks` rows, which aren't `ON DELETE CASCADE` from `entreprises` per the cleanup caveat documented earlier in this file, so those needed deleting explicitly before the entreprise itself would drop): all 17 tabs render in their correct groups, clicking a tab both selects it (green highlight) and loads its module content, collapsing/expanding a group works, and — after the fix above — the sidebar stays correctly pinned just below the header through a full scroll of a tall module (Cultures & irrigation, 3 parcelles + historique). `npx vite build` and root `npm test` pass.

### `#root`'s leftover Vite-scaffold CSS made the whole app shrink-to-fit per page (fixed 2026-08-15)

User-reported straight after the sidebar landed: "la taille de la page des menus n'est pas les mêmes" — different tabs visibly had different overall page widths, cutting off the topbar's right-side content (user email/role badge/logout icon) on narrower pages. Not a perception issue — confirmed by zooming into a screenshot mid-scroll: on the Feedback tab (one narrow form card), the whole white app area including the topbar ended around x≈1180 with the dark backdrop showing through past it, while Accueil (wide dashboard card grid) filled the full 1500px cap.

Root cause: `src/index.css`'s `#root` rule — a leftover from the original Vite scaffold, already flagged elsewhere in this file for its unrelated `text-align: center` side effect — also still had `width: 1126px; display: flex; flex-direction: column;`. `.app-shell` (`src/App.jsx`, the top-level rendered div) has its own `max-width: 1500px; margin: 0 auto`. Inside a column flex container, an item's horizontal `margin: auto` overrides `align-items: stretch` (the flex default) per spec — the item gets sized to its own shrink-to-fit content width instead of stretching to the container's cross size, then centered via the auto margins. So `.app-shell`'s rendered width was actually just whatever its *widest content row* needed, which varies enormously per tab (a 5-across stat-card grid on Accueil vs. one ~550px form card on Feedback) — and the sidebar+topbar shrank right along with it. This didn't cause a visibly broken layout with the old flat chip row (chips just wrapped to fewer/more rows depending on available width, which read as normal responsive wrapping) but became blatant with the new fixed-width sidebar, since the whole left rail and the topbar's right-aligned content would shift or get clipped depending on which tab was open.

Fixed by stripping `#root` down to `max-width: 100%; text-align: center; min-height: 100svh; box-sizing: border-box;` — dropped `width: 1126px` (the actual cause), `display: flex; flex-direction: column` (not needed for anything `.app-shell` relies on, and removing it is what stops the auto-margin/stretch conflict for good rather than just this one instance of it), and `border-inline` (a 1px side border sized for the old fixed-width reading column; with `#root` now full-bleed it would've drawn a vertical line down each edge of the viewport instead). `text-align: center` was deliberately left alone — same already-documented, out-of-scope-for-now issue as before, unrelated to this bug.

Verified via a real browser pass (throwaway entreprise, all modules activated): Accueil and Feedback (previously the most extreme width mismatch — a full card grid vs. a single narrow form) now render at the exact same width, topbar included, confirmed by direct visual comparison of both screenshots. `npx vite build` and root `npm test` pass.

### Stocks reliés aux Achats/Ventes — plus deux îlots séparés (2026-08-15)

User asked for a gap-analysis of Achats/Ventes in Cultures/Poulailler against des ERP établis (type SAP B1). Investigation found the core gap: `cultures_stocks`/`poulailler_stocks` and the achats/devis (ventes) flows were completely disconnected — recording a purchase never increased stock, recording a sale never decreased it; only `StocksTab`'s manual edit ever touched `quantite`. Consequence: the low-stock alerts in `NotificationsModule` read real stock data but that data never reflected actual purchase/sale activity, only whatever was typed by hand. Also confirmed missing (deliberately **not** built in this pass, next step if the need holds up in practice): no product catalog (both `achats_lignes.produit` and `devis_lignes.produit` are free text retyped every line, no reusable list, no default/catalog price) and no purchase-order/commitment concept on the achats side (`achats_documents` has no `statut`, every row is already-happened, unlike `devis`'s real lifecycle).

Fixed the stock-disconnect specifically (smallest viable version, matching the project's usual minimal-first approach) — matching by product name, not by a catalog id (since none exists yet):

- **`server/src/utils/stockSync.js`** (new, mirrors `financeSync.js`'s pattern: plain `pool.query` calls, catch-and-log rather than throw, called after the main transaction commits): `applyAchatLignesToStock`/`reverseAchatLignesFromStock` (module-scoped — `achats_documents.module` picks `cultures_stocks` or `poulailler_stocks`) and `applyVenteLignesToStock`/`reverseVenteLignesToStock` (devis has no module column, so it checks both stock tables by name and stops at the first match). All four are no-ops when a line's `produit` doesn't match any existing stock row — a free-text product that isn't stock-tracked is a legitimate case, not an error.
- **`achats.js`**: `POST /` applies stock after `syncAchatDocumentFinance`. `PUT /:id` now fetches the *old* `module` + lines before overwriting them, reverses the old effect, then applies the new one (handles a module change between Cultures/Poulailler correctly, same idea as `updateFinanceEntry`'s update-in-place philosophy). `DELETE /:id` fetches lines before deleting them, reverses after.
- **`devis.js`** — chose the **"Signé"** transition as the stock-commitment point (not creation, which is always `'Brouillon'`; not facturation, which never touches lines): it's the moment `devis_lignes` becomes immutable (`PUT`/`DELETE` only allow `['Brouillon','Devis']`) and the moment the ventes ledger already treats as a real sale. Wired into both paths that reach `'Signé'` — `POST /:id/valider-manuel` and the unauthenticated `POST /public/:token/signer` (needed to add `entreprise_id` to that route's own `SELECT`, since it has no `req.user` to read it from). `POST /:id/remettre-brouillon` reverses the stock **only if** the devis's statut before the reset was `'Signé'` or later (`Facturé`/`Non payé`/`Payé partiellement`/`Payé` — a new `STATUTS_APRES_SIGNATURE` list) — resetting from `'Envoyé'` or earlier never decremented stock in the first place, so there's nothing to give back. `facturer` itself needs no hook (never touches lines, decrement already happened at signature) and `DELETE /devis/:id` needs none either (only allowed pre-signature, before any stock ever moved).
- Verified end-to-end via real HTTP calls (Node `fetch`, not curl — same accent-mangling shell issue as the RH-enrichie pass, confirmed harmless the same way) against throwaway entreprises: an achat's create/update/delete cycle moved stock +5 → +3 (net delta, not a flat re-apply) → back to baseline exactly; a devis's Brouillon→Signé→remise-en-brouillon→re-Signé cycle left stock untouched while Brouillon, decremented once at Signé, fully restored at remise-en-brouillon, and decremented again (not double-decremented) on re-signing — confirming no leak across the reversal/reapply cycle. Also verified the **public** e-signature path decrements correctly (real `/envoyer` → `/public/:token/signer` round-trip; hit the already-known "email not configured in this Docker env" limitation getting the token, worked around by reading `token_public` directly from the DB after the expected 500, per the already-documented devis-email caveat above) and that cross-tenant isolation holds — two companies with an identically-named stock item ("Riz"), only the signing company's stock moved. `npx vite build`, root `npm test`, `server/npm test` all pass.

### Catalogue produit — prix par défaut sur les stocks, autocomplete dans Achats/Devis (2026-08-15)

Direct follow-up to the "Stocks reliés aux Achats/Ventes" fix above — user initially agreed to defer this until that fix proved out, then immediately asked to proceed anyway in the same session. Deliberately did **not** create a new `produits` table: an article already in `cultures_stocks`/`poulailler_stocks` already *is* a reusable product (name, category, unit) — it only lacked a default price. Building a separate catalog table would have meant two parallel product lists to keep in sync (and two things to reconcile against the stock-name-matching sync from the previous fix); extending the existing stock tables keeps exactly one source of truth.

- **DB**: `prix_defaut NUMERIC(12,2)` (nullable) added to both `cultures_stocks` and `poulailler_stocks` via `ALTER TABLE ADD COLUMN IF NOT EXISTS`.
- **Backend** (`routes/cultures.js`, `routes/poulailler.js`): `STOCK_COLUMNS` now selects `prix_defaut::float8 AS "prixDefaut"`; `POST`/`PUT /stocks` accept and persist `prixDefaut` (nullable — `''`/`null`/`undefined` all normalize to SQL `NULL`, matching the "optional" field convention already used elsewhere, e.g. `achats_documents.notes`).
- **Frontend — `StocksTab`**: new "Prix par défaut (FCFA)" field in both the add-form and the edit modal, plus a new column in the stocks table (`—` when unset) so the price is actually visible without opening the edit modal.
- **Frontend — `AchatModule`/`DevisModule`**: chose a native HTML `<datalist>` (a single text `<input list="...">`) over rebuilding the fournisseur/parcelle/récolte `<Select>` + `__autre__`-sentinel pattern already used elsewhere in the app. That pattern needs a separate transient "custom text mode" flag per line to know when to show a free-text fallback field, which would have meant extending the `ligne` shape (`{produit, quantite, prixUnitaire}`) in four separate forms (add + edit, in each of two components) just to track UI mode. A `datalist` gets the same result — pick from a list *or* type anything — in one input, no new per-line state, and works identically whether the user picks a suggestion or free-types a non-catalog product. `AchatModule` (already `moduleType`-aware) sources its list from that module's own stocks; `DevisModule` (no module concept, per the traçabilité-parcelle-vente entry above) merges both `cultures_stocks` and `poulailler_stocks`. In both, the produit field's `onChange` checks the new value against the loaded catalog (case-insensitive exact match) and — only if `prixUnitaire` is still empty, so it never clobbers a price the user already typed — fills it from that item's `prixDefaut`. Wired into all four line-editing surfaces (`AchatModule` add-form + edit-modal, `DevisModule` add-form + edit-modal); the two free-text product fields in `MovementTab` (confirmed dead code, never rendered — see the Achats↔Finances entry above) were deliberately left untouched.
- Verified end-to-end: direct API calls confirmed `prixDefaut` round-trips through create/update/list on both stock endpoints, including staying `null` when omitted. A real browser pass (throwaway entreprise) created a stock item "Engrais NPK" at 15 000 FCFA default, then in the Achats form typed the exact same name into the produit field — `prixUnitaire` auto-filled to `15000` immediately, confirmed visually. `npx vite build`, root `npm test`, `server/npm test` all pass.

### Passe de vérification post-déploiement local (2026-08-16)

À la demande de l'utilisateur ("vérifie que l'app fonctionne bien en prod"), vérification de bout en bout de la stack Docker locale en mode production — reconstruite `docker-compose up -d --build` à partir exactement du code déjà poussé sur `origin/main` (commit `75d7eee`, working tree propre au moment du test), pas d'un environnement hébergé en ligne : celui-ci n'existe toujours pas (bloqué sur la création du compte DigitalOcean/Droplet + l'achat d'un nom de domaine par l'utilisateur, voir la section Hébergement/HTTPS plus haut).

- **Démarrage** : les 4 services (`db`, `backend`, `frontend`, `backup`) démarrent proprement ; `node src/db/migrate.js` s'exécute sans erreur ; logs backend/frontend propres (aucune erreur au démarrage) ; `curl` confirme `200` sur `http://localhost:8090` (frontend) et `http://localhost:4000/` (backend).
- **Passage navigateur réel** (entreprise jetable "Prod Check SARL", inscription → tableau de bord → parcours de plusieurs modules touchés pendant la session → nettoyage complet après) :
  - Sidebar groupée : rendu correct, tous les groupes/items présents, navigation fonctionnelle.
  - Largeur de page cohérente entre pages courtes et longues (Accueil vs Feedback comparés côte à côte) — confirme que le correctif `#root` tient dans un environnement rebuild à froid, pas seulement dans la session où il a été fait.
  - Équipements et Fiche RH (présences/congés/avances) : les deux accessibles et fonctionnels.
  - **Stocks ↔ Achats** : créé un article "Semences Maïs" à 20 en stock avec un prix par défaut de 5 000 FCFA ; dans le formulaire d'achat, taper le nom exact de l'article a préempli automatiquement le prix unitaire (catalogue produit) ; après enregistrement de l'achat (5 unités), le stock est passé de 20 à **25** — confirme que la synchronisation stocks↔achats fonctionne de bout en bout dans un environnement rebuild à froid, pas seulement via les appels API directs utilisés pour la valider au moment de l'implémenter.
  - Aucune erreur dans la console du navigateur pendant tout le parcours.
- **Limite de cette vérification** : couvre la stack locale uniquement (ce qui tourne sur cette machine), pas un déploiement réel — reste à faire une fois l'hébergement effectivement en place.

### Rapprochement stock par identifiant + historique des mouvements (2026-08-16)

Direct follow-up to the ERP gap-analysis artifact — the two items flagged as genuinely high-impact (not "bloat ERP"): the stock↔achats/ventes sync added the day before matched purely by product name, and adjusted `quantite` in place with no record of individual movements. Both fixed together since a reliable audit trail needs to know exactly *which* stock row moved, not infer it from a name string each time.

- **DB**: `achats_lignes.stock_id` and `devis_lignes.stock_id`/`stock_module` (all nullable, no DB-level FK — see below for why) + a new append-only `stock_mouvements` table (`entreprise_id`, `stock_module`, `stock_id`, `stock_nom` — a snapshot, survives a later rename/delete of the article, `delta`, `raison`, `document_type`/`document_id`, `user_id`, `created_at`).
- **Why no FK constraint on `stock_id`**: it can point into `cultures_stocks` *or* `poulailler_stocks` depending on context, and Postgres has no clean way to declare a foreign key conditional on another column's value — the two tables would need merging into one to get a real constraint, which is a much larger change (every route/frontend piece already reading `cultures_stocks`/`poulailler_stocks` separately, cf. `StocksTab`, `NotificationsModule`, `ForecastingModule`, etc.) for a benefit this fix doesn't need. Instead, `server/src/utils/stockSync.js` resolves the row by `stock_id` first (fast, exact) and falls back to the existing case-insensitive name match only when `stock_id` is absent (legacy lines, or a free-text product never linked to the catalog) — additive, not a breaking change to the previous day's sync.
- **How `stock_id` gets populated without changing the input mechanism**: the produit field is still the single `<datalist>`-backed text input from the "Catalogue produit" work (deliberately kept, for the same reason as before — no per-line UI-mode state). Its `onChange` already computed a `match` against the catalog to prefill price; it now also writes `match.id` (and, for `DevisModule`, `match._stockModule` — catalog items tagged by source table when the two stock lists are merged) into the ligne's `stockId`/`stockModule` fields, clearing them back to `null` the moment the text no longer matches exactly. Wired into all four line-editing surfaces (`AchatModule`/`DevisModule` × add-form/edit-modal) — same set touched by the catalog work.
- **Tenant isolation on the new ids**: `achats.js`'s `validerStockIds` and `devis.js`'s `validerStockLigneIds` mirror the existing `validerRecolteIds` pattern (silently store `null` for a `stockId` that doesn't belong to the caller's entreprise, never reject the whole request) — same lesson as the `achats_lignes` cross-tenant hole documented earlier in this file.
- **Movement logging, wired at every point stock already changed** (five `raison` values, one per call site): `achat_creation`/`achat_modification`/`achat_suppression` in `achats.js` (the `PUT` handler now also fetches the *old* lines' `stock_id` before overwriting them, so the reversal is exact-by-id too, not a re-guess by name), `devis_signature` (both `valider-manuel` and the unauthenticated public e-signature route — the latter needed `entreprise_id` added to its own `SELECT` since it has no `req.user`) and `devis_remise_en_brouillon` in `devis.js`.
- **Frontend — `StocksTab`**: new `History` icon per row (leftmost of the three action icons, read-only — this is deliberately an append-only audit log, no edit/delete UI, same posture as `mouvementHistorique.js`'s existing history views) opening a modal listing that article's movements (raison, timestamp, signed delta in green/red) via new `GET /cultures/stocks/:id/mouvements` / `GET /poulailler/stocks/:id/mouvements` routes — same maintenance-history-modal shape already established for `EquipementsModule`.
- Verified end-to-end via real HTTP calls (Node `fetch`) against a throwaway entreprise: an achat with an explicit `stockId` correctly resolved and logged (`+10`, raison `achat_creation`); a devis Brouillon→Signé→remise-en-brouillon→re-Signé cycle produced exactly the right three-then-more movements in order with no drift (delta sum always matched the actual stock delta from baseline); an achat with **no** `stockId` (old-style free-text) still resolved via the name fallback and logged correctly, confirming the previous day's flows keep working unchanged; cross-tenant `GET .../mouvements` from a second throwaway entreprise returned an empty list, never another company's history. A real browser pass (separate throwaway entreprise) confirmed the UI end-to-end: created a stock item, opened its (empty) history, made a purchase through the Achats form with the datalist match, and watched the history modal show "Achat enregistré" with the correct timestamp and `+5`. `npx vite build`, root `npm test`, `server/npm test` all pass.

### Cycle de vie des Achats : Brouillon → Commandé → Reçu (2026-08-16)

Third round on the ERP gap-analysis, user's explicit pick ("ce qui se rapproche le plus d'un ERP de référence") from the "à discuter au cas par cas" tier — closes the biggest structural asymmetry between Ventes and Achats: a devis has always had a real lifecycle (`Brouillon→Envoyé→Signé→Facturé`), but an achat was always "already happened" the moment it was created (stock/finance synced immediately in `POST /achats`). Mirrors a reference ERP's RFQ→PO→Receipt shape, deliberately trimmed to 3 states rather than a fuller model (no partial receipts, no separate vendor-bill step) — matches the project's usual minimal-first approach and the "maybe, not urgent" framing this item had in the comparison artifact.

- **DB**: `achats_documents.statut` (`Brouillon`/`Commandé`/`Reçu`, `DEFAULT 'Reçu'`) + `date_reception`. The `DEFAULT 'Reçu'` is deliberate and asymmetric: it back-fills every *pre-existing* row to match their real state (already synced before this change), while `POST /achats` explicitly inserts `'Brouillon'` for anything created going forward — the column default only ever applies to history, never silently to a new row.
- **Where stock/finance now actually fire**: moved out of `POST /achats` entirely, into a new `POST /:id/recevoir` — the only place `syncAchatDocumentFinance`/`applyAchatLignesToStock` are called from now. `POST /:id/commander` (Brouillon→Commandé) is a pure statut flip with zero side effects, mirroring devis's Envoyé transition. `POST /:id/annuler-reception` (Reçu→Commandé) reverses both (`removeFinanceEntry` + `reverseAchatLignesFromStock`), mirroring `remettre-brouillon`.
- **A real simplification this enabled**: since `PUT`/`DELETE` are now only reachable pre-`Reçu` (guarded — 400 error otherwise, mirroring devis's own `['Brouillon','Devis']` edit guard), neither one ever needs to touch stock or finance anymore — nothing was synced yet at that point in the lifecycle. This *removed* the reverse-then-reapply stock/finance dance `PUT` used to do (from the previous day's stock-linking work) and the reversal calls `DELETE` used to make — both routes got shorter and simpler, not more complex, as a side effect of adding the state machine. `updateAchatDocumentFinance` (in `financeSync.js`) is now unused dead code as a result — left in place rather than deleted, matching the codebase's existing tolerance for a few no-longer-called exports (e.g. `updateBanque`/`updateSalarie`, documented elsewhere in this file).
- **A labeling bug caught before shipping, not after**: the first draft of `/recevoir`/`/annuler-reception` reused the old `achat_creation`/`achat_suppression` `raison` values for the stock-movement log — meaning cancelling a reception (the document still exists, just un-received) would have shown "Achat supprimé" in the history modal, which is actively misleading since nothing was deleted. Caught on review before the browser pass; introduced two accurate new values (`achat_reception`, `achat_annulation_reception`) instead, and kept the old ones in the frontend's label map only for backward-compatible display of history rows logged before this change.
- **Frontend (`AchatModule`)**: new "Statut" column (badge: ochre `Brouillon` / blue `Commandé` / green `Reçu`) in the achats table; row actions are now statut-conditional — `Brouillon` shows a "Commander" button, `Commandé` shows "Marquer reçu", `Reçu` shows "Annuler réception"; the edit (`Settings2`) and delete (`Trash2`) icons only render while `['Brouillon','Commandé'].includes(statut)`, matching the backend guard exactly rather than letting a 400 be the only thing stopping an edit attempt.
- Verified end-to-end via real HTTP calls: created an achat (statut `Brouillon`, stock/finance untouched) → confirmed `recevoir` from `Brouillon` is correctly rejected (400) → `commander` → `Commandé` (still untouched) → `recevoir` → `Reçu` (`dateReception` set, stock +10, one finance entry created) → confirmed `DELETE` on a `Reçu` document is rejected (400, "annulez la réception d'abord") → `annuler-reception` → back to `Commandé` (stock restored to baseline, finance entry gone) → stock history showed exactly `achat_reception:+10` then `achat_annulation_reception:-10`, in order, no drift. A real browser pass (throwaway entreprise) walked the full UI cycle — Brouillon badge → click "Commander" → Commandé badge → click "Marquer reçu" → Reçu badge with the exact toast text, edit/delete icons gone, only "Annuler réception" left. `npx vite build`, root `npm test`, `server/npm test` all pass.

### Listes de prix par client (2026-08-16)

Fourth round on the ERP gap-analysis. User's pick from the two dimensions offered (par client vs par quantité): client-specific pricing, additive on top of the existing `prix_defaut` — a sale with no negotiated price for that client just uses the article's normal default, exactly like before this change.

- **DB**: `client_prix` (`entreprise_id`, `client_id`, `stock_module`, `stock_id`, `prix`, `UNIQUE(client_id, stock_module, stock_id)` — at most one negotiated price per client+article, so re-saving the same pair corrects it rather than piling up duplicates). Same no-FK-on-`stock_id` situation as everywhere else in this file (two possible target tables) — app-validated ownership instead.
- **Backend** (`routes/prixClient.js`, new, mounted at `/api/prix-client`): `GET /?clientId=X` (joins each of `cultures_stocks`/`poulailler_stocks` separately per module, matching the pattern already used for the stock-movement history reads), `POST /` (upsert via `ON CONFLICT DO UPDATE`, validates both the client and the stock article belong to the caller's entreprise before writing — same ownership-first posture as everywhere else this session), `DELETE /:id`.
- **Frontend — `ClientPrixSection`** (new sub-component, rendered inside `ClientsModule`'s existing detail panel for the selected client): a small add-form using the same datalist-driven produit picker as `AchatModule`/`DevisModule` (built from the same merged Cultures+Poulailler catalog), plus a list of that client's overrides with delete. Placed directly on the client record because that's where a negotiated price conceptually belongs — no new top-level nav entry needed.
- **Frontend — `DevisModule`**: two client-scoped price maps (`clientPrixMap` for the add-form, `editClientPrixMap` for the edit-modal — the two forms can have two *different* clients open at once, so one shared map would leak prices across them), refetched via `getPrixClient` whenever `form.clientId`/`editForm.clientId` changes. A new `prixPourMatch(match, prixMap)` helper — negotiated price if one exists for that client+article, else the article's `prixDefaut`, never the reverse — replaces the direct `match.prixDefaut` check in both produit `onChange` handlers, so selecting a catalog item now prefills the *right* price for whichever client is already selected on that form, still only when `prixUnitaire` is empty (never overwrites a price the user already typed).
- Verified end-to-end via real HTTP calls: created a client-specific price (500 default → 350 negotiated), confirmed a second client's price list stayed empty (no cross-client leak) and a devis for the negotiated client's the right client came back at 350; re-POSTing the same client+article updated in place rather than duplicating; deletion round-tripped correctly; cross-tenant `GET`/`POST` against another company's client or stock article both correctly 404'd. A real browser pass (throwaway entreprise) confirmed the full path visually: added "Tomates Prix" at 500 FCFA default, opened a client's "Prix négociés" panel and set 350 for that article, then in a new devis for that same client typed the exact article name — the unit price field filled in with 350, not 500. `npx vite build`, root `npm test`, `server/npm test` all pass.

### Produits unifiés (fusion cultures_stocks/poulailler_stocks) — étape 1 d'un alignement structurel sur un ERP de référence (2026-08-18)

Point de départ : question de l'utilisateur sur l'intérêt réel de fusionner `cultures_stocks`/`poulailler_stocks`. Après une comparaison honnête avantages/inconvénients, l'utilisateur a demandé une inspection en direct de son propre compte ERP réel (`le compte ERP de l'utilisateur`, société SAS SCORECONECT — 1171 produits, 6161 contacts, 7193 devis/commandes) via l'extension Chrome, puis a explicitement élargi l'objectif : faire ressembler les structures de données de l'app à celles d'un ERP de référence, de façon exhaustive mais **exécutée par étapes vérifiées une à une** — voir la mémoire `project_erp_full_architecture_alignment` pour la feuille de route complète (étape 1 ci-dessous faite, étapes 2-4 — contacts unifiés, listes de prix, lignes de devis enrichies — identifiées mais pas encore conçues) et `project_erp_reference_account` pour le détail de ce qui a été observé sur un ERP de référence.

**Conception** (voir le plan complet dans la session correspondante pour le détail SQL) :
- `produits` (nouvelle table) unifie `cultures_stocks`/`poulailler_stocks` — `SERIAL` propre, `module` (`Cultures`/`Poulailler`), colonnes de provenance `legacy_table`/`legacy_id` (`UNIQUE`) servant à la fois de trace d'audit et de clé de correspondance pour le repointage.
- `produit_categories` (nouvelle table) remplace le texte libre non validé qu'était `categorie` — **vraie ressource CRUD par entreprise** (pas une liste figée globale), inspirée de l'inspection d'un ERP de référence (Inventaire > Configuration > Catégories de produits, 19 catégories réellement gérées par l'utilisateur là-bas). Pré-remplie avec les 7 libellés déjà utilisés dans l'app (Semences/Engrais/Produits phytosanitaires/Autre, Aliment/Œufs/Volailles vivantes/Autre).
- `produits.user_id` harmonisé sur `ON DELETE SET NULL` partout (`cultures_stocks` l'avait déjà, `poulailler_stocks` avait `ON DELETE CASCADE` — décision explicite de l'utilisateur : un utilisateur supprimé ne doit plus jamais supprimer l'inventaire qu'il a créé).
- Surface API consolidée : `/api/produits` + `/api/produit-categories` remplacent entièrement `/api/cultures/stocks*`/`/api/poulailler/stocks*` (pas de shim de compatibilité — décision explicite de l'utilisateur, cohérente avec l'objectif de ressemblance structurelle).

**Migration des données** (`server/src/db/migrate.js:mergeStocksIntoProduits`, fonction séparée du bloc SQL principal avec sa propre transaction explicite `BEGIN`/`COMMIT`/`ROLLBACK` — le bloc SQL principal, lui, n'a jamais eu de transaction globale) : fusionne les deux tables, repointe `achats_lignes`/`devis_lignes`/`stock_mouvements`/`client_prix` vers les nouveaux ids via une jointure sur `legacy_table`/`legacy_id`, vérifie (comptes + zéro orphelin sur les 4 tables référentes) avant `COMMIT`, puis renomme (ne supprime pas) `cultures_stocks`/`poulailler_stocks` en `*_legacy_<date>` comme filet de sécurité.

**Deux bugs réels trouvés en répétant la migration sur une copie de sauvegarde restaurée** (avant de toucher la production — voir Vérification ci-dessous), ni l'un ni l'autre visible en relisant le code une seule fois :
- **Idempotence cassée** : relancer `migrate.js` une seconde fois recréait des tables `cultures_stocks`/`poulailler_stocks` vides (`CREATE TABLE IF NOT EXISTS` du bloc SQL principal ne sait pas qu'une fusion a déjà eu lieu), ce qui faisait échouer la vérification post-fusion à chaque redéploiement futur. Corrigé en basant la garde d'idempotence sur l'existence d'une table `*_legacy_%` (robuste même si le bloc principal recrée une coquille vide) plutôt que sur l'existence de `cultures_stocks` elle-même ; les coquilles vides sont supprimées immédiatement si détectées.
- **Catégories manquantes pour toute nouvelle entreprise** : la fusion ne crée les 7 catégories par défaut que pour les entreprises qui avaient déjà du stock au moment de la migration — une entreprise inscrite après coup se serait retrouvée avec une liste de catégories vide, bloquant de fait l'ajout du moindre article tant qu'un admin n'en crée pas une à la main. Corrigé en ajoutant le même seed dans `POST /api/auth/register` (`CATEGORIES_PRODUITS_PAR_DEFAUT`, même liste que `migrate.js`, dans la même transaction que la création de l'entreprise).

**Backend** : `routes/produits.js` (nouveau, CRUD + historique des mouvements) et `routes/produitCategories.js` (nouveau, CRUD) remplacent le bloc `/stocks*` supprimé de `routes/cultures.js`/`routes/poulailler.js`. `utils/stockSync.js` collapse `STOCK_TABLES` (dupliqué indépendamment dans 5 fichiers avant cette fusion) en une seule cible `produits` — le repli par nom (`findStockRow`) gagne un filtre `module` pour qu'un "Riz" Cultures ne matche jamais un "Riz" Poulailler, un id étant désormais non-ambigu à lui seul contrairement au nom. `routes/achats.js`/`routes/devis.js` : `validerStockIds`/`validerStockLigneIds` gagnent un filtre `module` explicite — nécessaire depuis l'unification de l'espace d'ids (avant, un id ne pouvait appartenir qu'à une seule des deux tables, donc jamais "valide mais mauvais module"). `routes/prixClient.js` : la boucle sur 2 tables devient une seule jointure.

**Frontend** : `src/lib/api.js` — `getProduits`/`createProduit`/`updateProduit`/`deleteProduit`/`getProduitMouvements` + `getProduitCategories`/`createProduitCategorie`/`updateProduitCategorie`/`deleteProduitCategorie` remplacent les deux jeux de fonctions parallèles. `StocksTab` (`src/App.jsx`) : les constantes figées `STOCK_CATS`/`CULTURES_STOCK_CATS` disparaissent, remplacées par un chargement via `getProduitCategories(moduleType)` + une petite UI inline "Gérer les catégories" (ajout/suppression, même esprit que le reste de l'app — pas de nouvelle page dédiée). `DevisModule`/`ClientPrixSection` : la fusion manuelle des deux catalogues + tagging `_stockModule` disparaît (un seul appel `getProduits()`, chaque item porte déjà son `module`) — corrige au passage un bug de collision de clé React déjà repéré dans le `<datalist>` de `DevisModule` (keyé par `item.id` seul, alors que les ids pouvaient collisionner entre les deux anciennes tables). `AIAssistantModule`/`ForecastingModule`/`HomeOverview`/`NotificationsModule` : `getPoulaillerStocks()` → `getProduits('Poulailler')`.

**Vérification** (suivant le protocole du plan approuvé — répétition avant production, pas de raccourci) :
- **Répétition complète sur une copie restaurée** : dump explicite pris avant toute action (`backups/pre_produits_migration_2026-08-18.dump`), restauré dans un conteneur Postgres jetable, `migrate.js` exécuté deux fois de suite dessus (la deuxième exécution a révélé le bug d'idempotence ci-dessus), puis un backend complet lancé contre cette copie pour une passe HTTP complète (voir ci-dessous) — c'est cette répétition qui a permis de trouver les deux bugs avant qu'ils n'atteignent la production.
- **Migration réelle** : appliquée via `docker-compose run --rm backend node src/db/migrate.js` (image fraîchement construite, avant redémarrage du backend réel — respecte le séquencement "schéma+fusion doit terminer avant que le nouveau backend ne serve du trafic") contre la vraie base de production. Résultat vérifié directement en base : 3 `produits` (1 Cultures + 2 Poulailler, correspondant exactement aux données réelles de l'entreprise 1), 8 `produit_categories`, zéro orphelin sur `achats_lignes`/`devis_lignes`/`stock_mouvements`/`client_prix`.
- **HTTP réel contre la production** (entreprise jetable, nettoyée après — cascade incomplète comme d'habitude, nettoyage manuel de `devis`/`clients` avant `entreprises` en plus des tables listées dans la note de nettoyage plus haut dans ce fichier) : CRUD produits/catégories, cycle achat Brouillon→Commandé→Reçu→annulation avec vérification exacte des quantités et de `stock_mouvements`, devis avec des lignes des deux modules dans un même document (confirme la non-collision d'ids), isolation cross-tenant (lecture/écriture/suppression d'une autre entreprise → 404 ou liste vide, jamais de fuite), rejet correct d'un `stockId` valide mais du mauvais module, catégorie protégée contre la suppression tant qu'un produit l'utilise (409) puis suppression réussie une fois l'article retiré.
- **Navigateur réel** (entreprise jetable "Browser Verify Produits SARL", nettoyée après) : onglet Stocks (ajout d'article, catégorie affichée correctement, modale d'historique), gestionnaire de catégories inline (ajout d'une catégorie confirmé visuellement), formulaire Achats — taper le nom exact d'un article a bien préempli le prix unitaire depuis le nouveau catalogue `produits`. Aucune erreur dans la console du navigateur liée à l'app.
- `npx vite build`, `npm test` (racine), `server/npm test` tous verts après chaque étape de code.

Pas encore fait dans cette passe (étapes 2-4 de la feuille de route ERP, voir la mémoire correspondante) : contacts unifiés (`clients`/`fournisseurs` → une seule ressource type `un modèle de contact standard`), vraies listes de prix nommées et réutilisables (remplaçant `client_prix`), lignes de devis enrichies (remise %, lignes de section/note, quantités livrée/facturée séparées).

### Contacts unifiés (fusion clients/fournisseurs) — étape 2 de l'alignement ERP (2026-08-18)

Suite de l'étape 1 (`produits`, commit `58c150f`). Cette fois l'utilisateur a explicitement demandé, à l'inverse de ma recommandation initiale, de **tenter un rapprochement automatique** des fiches `clients`/`fournisseurs` existantes qui représentent déjà la même entité (aujourd'hui deux fiches sans aucun lien) — voir mémoire `project_erp_full_architecture_alignment` pour la feuille de route complète.

**Conception** :
- `contacts` unifie `clients`/`fournisseurs` avec deux booléens indépendants `est_client`/`est_fournisseur` (`CHECK (est_client OR est_fournisseur)`) — contrairement à `produits.module` (un enum, un article n'est que Cultures OU Poulailler), un contact réel peut légitimement être les deux à la fois, ce qui est le but même de la fusion.
- **Rapprochement à deux niveaux** : tier 1 (SIRET identique non vide, confiance haute) puis tier 2 (nom+prénom identiques, seulement si la correspondance est non-ambiguë — un seul candidat de chaque côté, sinon on ne devine pas). Chaque paire fusionnée journalisée en clair pendant la migration. **Sur les vraies données de production, zéro paire candidate trouvée** (8 clients / 2 fournisseurs, aucun nom ni SIRET en commun) — la logique de rapprochement a été testée positive/négative avec des paires synthétiques dans un environnement jetable avant de conclure ça, donc "zéro fusion" reflète l'état réel des données, pas un bug du matching.
- **Anti-collision d'ids** : contrairement à `produits.legacy_table`/`legacy_id` (une seule origine possible), un contact fusionné vient des deux tables à la fois — deux colonnes nullables séparées `legacy_client_id`/`legacy_fournisseur_id` (chacune `UNIQUE`) à la place.
- **Différence structurelle avec l'étape 1** : `devis.client_id`, `client_prix.client_id`, `achats_documents.fournisseur_id` sont de **vraies contraintes FK** (contrairement à `stock_id`, qui n'en a jamais eu) — il a fallu les supprimer avant de repointer les colonnes puis en recréer de nouvelles vers `contacts(id)` avec les mêmes `ON DELETE` qu'avant (noms de contraintes retrouvés dynamiquement via `pg_constraint`, aucune n'étant nommée explicitement dans le schéma d'origine).
- **Harmonisation** (même raisonnement qu'à l'étape 1 pour `produits.user_id`) : `contacts.entreprise_id` en `CASCADE` (`clients.entreprise_id` n'avait aucun `ON DELETE`), `contacts.user_id` en `SET NULL` (`clients.user_id` était `CASCADE`) — changement de comportement réel, vérifié en répétition avant production.
- **Surface API** : nouvelle ressource `/api/contacts` (`GET ?type=client|fournisseur`), remplace `/api/business/clients*`/`/api/business/fournisseurs*` (bloc supprimé de `business.js`, qui garde `finances` intact).
- **Frontend** : `ClientsModule`/`FournisseursModule` (quasi identiques octet pour octet) fusionnés en un seul `ContactsTab({ type })`, même principe que `StocksTab({ moduleType })` à l'étape 1. Case à cocher "Est aussi fournisseur"/"Est aussi client" dans le formulaire d'ajout et la modale d'édition. `roles.js` inchangé — l'asymétrie `comptable` (voit Clients, pas Fournisseurs) reste garantie par les mêmes clés de permission, qui pilotent simplement quel `type` est rendu.

**Idempotence de la migration corrigée dès l'écriture initiale cette fois** (bug trouvé à l'étape 1 par une répétition, anticipé ici directement) : garde basée sur l'existence d'une table `clients_legacy_%`, pas sur l'existence de `clients` elle-même (le bloc SQL principal recrée sans le vouloir une coquille vide à chaque relance de `migrate.js` une fois la vraie fusion faite).

**Un vrai bug SQL trouvé et corrigé pendant la répétition** (avant de toucher la production) : la requête d'insertion des contacts fusionnés (tier 1, SIRET) référençait `client_id`/`fournisseur_id` dans une sous-requête sans les aliaser depuis `cl2.id`/`fo2.id` — "column client_id does not exist". Corrigé en explicitant les alias.

**Vérification** :
- Étape supplémentaire propre à cette migration (au-delà de la répétition déjà systématique) : la requête de rapprochement elle-même testée en isolation (lecture seule) sur une copie des vraies données avant d'écrire la fonction de fusion complète, avec des paires synthétiques insérées temporairement pour confirmer les détections positives (SIRET, nom non ambigu) et négatives (nom ambigu — 1 client vs 2 fournisseurs du même nom, correctement exclu) — la logique n'a été considérée fiable qu'après ces deux confirmations.
- Répétition complète (dump explicite, conteneur Postgres jetable, `migrate.js` lancé deux fois — idempotence confirmée dès la première tentative), y compris la création d'un nouveau devis et d'un nouvel achat contre la copie migrée pour confirmer que les nouvelles contraintes FK acceptent bien les nouveaux ids `contacts`.
- Migration réelle appliquée en production (10 contacts, 0 rapprochement — cohérent avec la prévisualisation), zéro orphelin sur `devis`/`client_prix`/`achats_documents`.
- HTTP réel contre la production (entreprises jetables, nettoyées après) : CRUD contacts, contact double-rôle visible dans les deux listes filtrées, devis/achat/`client_prix` fonctionnels sur des contacts réels, suppression bloquée par un devis renvoie toujours `409` avec le message mis à jour, isolation cross-tenant.
- Navigateur réel (entreprise jetable "Browser Verify Contacts SARL", nettoyée après) : contact double-rôle créé depuis l'onglet Clients avec la case "Est aussi fournisseur", confirmé visible et correctement étiqueté dans les deux onglets Clients ET Fournisseurs (couleur d'accent, libellés adaptés par type) — le comportement central que cette étape devait permettre. Aucune erreur console liée à l'app.
- `npx vite build`, `npm test` (racine), `server/npm test` tous verts.

Reste à faire (étapes 3-4 de la feuille de route ERP) : listes de prix nommées et réutilisables (remplaçant `client_prix`), lignes de devis enrichies (remise %, sections/notes, quantités livrée/facturée séparées).

### Listes de prix nommées et réutilisables (remplace client_prix) — étape 3 de l'alignement ERP (2026-08-18)

Suite des étapes 1 (`produits`, commit `58c150f`) et 2 (`contacts`, commit `5354940`). `client_prix` (une ligne = un prix négocié pour **un seul client**, jamais réutilisable) remplacée par `listes_prix`/`listes_prix_lignes` — un objet nommé assignable à plusieurs contacts à la fois, comme le champ "Liste de prix" d'une commande dans un ERP de référence.

**Contexte de risque** : `client_prix` était **vide en production** au moment de cette migration (zéro ligne, vérifié directement — les seules lignes passées étaient des données de vérification déjà nettoyées lors des étapes 1/2), ce qui a beaucoup réduit le risque côté données.

**Bug trouvé en préparant le plan, avant même d'écrire du code** : `server/src/db/migrate.js` avait deux fonctions (`mergeStocksIntoProduits`, `mergeClientsFournisseursIntoContacts`) qui touchaient `client_prix` sans condition, en s'appuyant sur le fait qu'elle existait toujours (jamais renommée, seulement modifiée sur place par les étapes précédentes). Cette étape supprime le `CREATE TABLE IF NOT EXISTS client_prix` du bloc SQL principal (une base neuve n'en a plus besoin) — **sans corriger ces deux fonctions, une base neuve aurait planté dès le premier `migrate.js`** (`relation "client_prix" does not exist"), un échec pire que celui visé par le changement. Corrigé en gardant chaque instruction touchant `client_prix` derrière un test `to_regclass('public.client_prix') IS NOT NULL`, dans les deux fonctions.

- **DB** : `listes_prix` (`entreprise_id`, `nom`, `UNIQUE(entreprise_id, nom)`) et `listes_prix_lignes` (`liste_prix_id`, `stock_id`, `prix`, `UNIQUE(liste_prix_id, stock_id)`) — **contrairement à l'ancienne `client_prix`, pas de colonne `stock_module`** : depuis la fusion produits (étape 1), `stock_id` est non-ambigu à lui seul, et `listes_prix_lignes.stock_id` a même une vraie contrainte `FOREIGN KEY REFERENCES produits(id)` (impossible avant, `client_prix` datant d'avant cette fusion). `contacts.liste_prix_id` (nullable, `ON DELETE SET NULL`) assigne une liste à un contact — `NULL` = pas de liste, chaque article garde son `prix_defaut`.
- **Migration** (`migrateClientPrixToListesPrix`, appelée après la fusion contacts) : idempotente sur l'absence de `client_prix` (couvre à la fois "déjà migrée" et "base neuve qui ne l'a jamais créée"). Chemin réel (0 ligne) : `DROP TABLE` direct. Chemin défensif non exercé par les vraies données (>0 lignes, ex. autre environnement) : une liste par client concerné nommée "Tarifs {nom}" (dédoublonnée si besoin), ses lignes copiées sans `stock_module`, le contact réassigné.
- **Backend** : nouvelle ressource `server/src/routes/listesPrix.js` (`/api/listes-prix` — CRUD des listes + leurs lignes, suppression d'une ligne via jointure `USING listes_prix`, même pattern que la suppression d'une intervention de maintenance dans `equipements.js`). `routes/prixClient.js` supprimé entièrement. `routes/contacts.js` : `liste_prix_id` ajouté à `CONTACT_COLUMNS`, nouvelle route `GET /:id/prix-effectifs`. **Piège réel dans `PUT /contacts/:id`** : le pattern `COALESCE($n, colonne)` déjà utilisé pour tous les autres champs ne permet jamais d'écrire explicitement `NULL` — or "désassigner une liste" est une écriture légitime de `NULL`, que `COALESCE` aurait silencieusement ignorée en gardant l'ancienne valeur pour toujours. Corrigé avec `Object.prototype.hasOwnProperty.call(req.body, 'listePrixId')` pour distinguer "non fourni" de "fourni à null", et un `CASE WHEN` au lieu d'un `COALESCE` pour cette seule colonne.
- **Frontend** : `ClientPrixSection` (par contact) remplacée par `ListesPrixManager` (par entreprise, panneau repliable même esprit que "Gérer les catégories" de `StocksTab` à l'étape 1) — gère toutes les listes et leurs lignes, indépendamment de tout contact sélectionné. `ContactsTab` gagne un sélecteur "Liste de prix" (gated `type === 'client'`) dans le formulaire d'ajout et la modale d'édition, plus une ligne en lecture seule dans le détail du contact. `DevisModule` : `loadClientPrixMap` appelle `getContactPrixEffectifs` au lieu de `getPrixClient` ; la map passe de la clé composite `${module}:${id}` à `stockId` seul (simplification permise depuis la fusion produits, l'ancienne `client_prix` datant d'avant).
- **Vérification** : au-delà de la répétition standard (dump, conteneur jetable, `migrate.js` ×3 pour confirmer l'idempotence), une répétition **supplémentaire contre une base totalement neuve** (jamais migrée) a spécifiquement exercé le chemin où les deux fonctions corrigées tournent sans que `client_prix` ait jamais existé — c'est le seul moyen de vérifier que le bug trouvé est bien corrigé, pas juste contourné. HTTP réel : liste créée, assignée à 2 contacts différents, prix identiques confirmés via `prix-effectifs` et préremplissage devis, désassignation explicite (`listePrixId: null`) vérifiée, suppression de liste confirmée détacher les contacts (`ON DELETE SET NULL`) sans les supprimer, nom de liste dupliqué → 409, isolation cross-tenant. Navigateur réel (entreprise jetable) : `ListesPrixManager` (création, dépliage, ajout/suppression de ligne), sélecteur "Liste de prix" dans la modale d'édition confirmé fonctionnel (un premier essai de clic sur l'option d'un `<select>` natif via l'automatisation avait raté la sélection — pas un bug de l'app, confirmé en refaisant via le clavier). `npx vite build`, `npm test` (racine), `server/npm test` tous verts.

Reste à faire (étape 4 de la feuille de route ERP) : lignes de devis enrichies (remise %, sections/notes, quantités livrée/facturée séparées).

### Lignes de devis enrichies (remise %, sections, quantités livrée/facturée) — étape 4 et dernière de l'alignement ERP (2026-08-18)

Suite des étapes 1 (`produits`, commit `58c150f`), 2 (`contacts`, commit `5354940`) et 3 (`listes_prix`, commit `3d2b5f6`). Inspirée de la commande réelle SO8934 inspectée en direct sur le compte ERP de l'utilisateur (mémoire `project_erp_reference_account`) : trois enrichissements de `devis_lignes`, jusqu'ici une simple table à plat sans notion de remise en pourcentage, de ligne non-produit, ni de suivi post-signature.

**Choix délibéré, cohérent avec la philosophie minimale du projet** : `quantite_livree`/`quantite_facturee` sont des champs de suivi **manuels**, pas un vrai moteur de workflow — l'app n'a aucun concept de livraison partielle ni de facturation par ligne (la facturation reste un événement au niveau du document entier). Reproduire le calcul automatique d'un ERP de référence (basé sur de vrais mouvements de stock/factures) aurait été disproportionné ; on affiche et permet de corriger l'information sans la dériver d'un vrai sous-système.

**Point de conception** : ces deux champs n'ont de sens qu'après signature, mais la modale d'édition classique (`editForm`/`PUT /devis/:id`) n'est accessible qu'en `Brouillon`. Plutôt que d'ouvrir l'édition post-signature (ce qui aurait aussi rouvert la porte à modifier prix/quantités d'un document déjà engagé), ils sont éditables uniquement depuis la **popup de détail en lecture seule** (accessible à tout statut), via une route dédiée sans verrou de statut.

**Conversion `remise` (montant fixe) → `remise_pourcentage`** : une seule ligne réelle en production avait une remise non nulle (`devis_lignes.id=33`, `devis_id=16`, sous-total 45×555=24 975, `remise=10.00`) → convertie en `remise_pourcentage=0.04%`, avec un écart résiduel documenté et accepté de 0.01 FCFA (limite de précision `NUMERIC(5,2)`) sur cette seule ligne historique — le total du devis lui-même (`devis.total`) n'est jamais touché par cette conversion, vérifié avant et après migration (`24 965.00` inchangé).

- **DB** (`server/src/db/migrate.js`) : `devis_lignes` gagne `remise_pourcentage NUMERIC(5,2) DEFAULT 0`, `type TEXT DEFAULT 'produit'` (`CHECK (type IN ('produit','section'))`), `quantite_livree`/`quantite_facturee NUMERIC(12,2) DEFAULT 0` ; l'ancienne `remise NUMERIC(12,2)` retirée de la `CREATE TABLE` d'origine. Un backfill de cohérence met `quantite_facturee = quantite` pour toute ligne produit d'un devis déjà `Facturé`/`Non payé`/`Payé partiellement` avant cette étape (sinon incohérent avec ce que `POST /:id/facturer` applique désormais pour toute future facturation) — `quantite_livree` n'est volontairement **pas** rétro-remplie, aucun événement de livraison n'existant dans l'app pour l'inférer.
- **Bug de migration trouvé pendant la répétition, même classe qu'aux étapes 1-3** : une instruction `ALTER TABLE devis_lignes ADD COLUMN IF NOT EXISTS remise NUMERIC(12,2) DEFAULT 0` **préexistante à cette session** (datant de l'introduction initiale de `remise`, jamais touchée par les étapes 1-3) recréait silencieusement la colonne juste retirée à chaque relance de `migrate.js`, avant que `migrateRemiseToPourcentage()` s'exécute — qui la retrouvait alors "encore là", reconvertissait 0 ligne (fraîchement à zéro) et la re-supprimait, masquant la casse d'idempotence derrière un message de succès à chaque fois. La leçon déjà tirée aux étapes précédentes ("vérifier toutes les instructions qui pourraient ressusciter un objet retiré, pas seulement celle qu'on modifie") s'applique donc aussi à du code que la session en cours n'avait pas écrit. Corrigé en supprimant cette instruction et en retirant `remise` de la `CREATE TABLE` d'origine pour cohérence totale avec la convention des étapes 1-3.
- **`migrateRemiseToPourcentage()`** : idempotente sur l'existence de la colonne `remise` (`information_schema.columns`). Calcule `remise_pourcentage = ROUND((remise / NULLIF(quantite*prix_unitaire,0)) * 100, 2)`, vérifie l'écart maximal entre l'ancien total et le nouveau (tolérance 0.02, couvre l'écart de 0.01 documenté ci-dessus), lève une erreur (`ROLLBACK`) si dépassée, puis `DROP COLUMN remise`.
- **Backend** (`server/src/routes/devis.js`) : deux helpers `normalizeLigne`/`ligneTotal` (défense en profondeur côté serveur — une section a toujours `quantite`/`prixUnitaire`/`remisePourcentage` à 0 et `recolteId`/`stockId`/`stockModule` à `null`, quoi que le client envoie). `getDevisComplet`, `GET /public/:token`, `GET /public/:token/pdf` : SELECT gagne `type, remise_pourcentage` (remplace `remise`) ; `getDevisComplet` seul expose aussi `quantite_livree`/`quantite_facturee` (routes publiques exclues — champs de suivi interne, pas destinés au client). `POST /`, `PUT /:id` : total recalculé via `ligneTotal`, INSERT à 10 colonnes (`type`/`remise_pourcentage` remplacent `remise`). `GET /ledger` : ajoute `AND dl.type = 'produit'` — une section n'entre jamais dans la Comptabilité comme vente fantôme, vérifié en navigateur (voir plus bas). `POST /:id/facturer` : nouvel `UPDATE devis_lignes SET quantite_facturee = quantite WHERE devis_id = $1 AND type = 'produit'` dans la même transaction — seul événement réel de "ceci est facturé" que l'app modélise, symétrique au mouvement de stock déjà déclenché à la signature. Nouvelle route `PATCH /:id/lignes-quantites` (`requireRole('admin')`, aucun verrou de statut — réinscriptible même après l'auto-remplissage de `facturer`), qui met à jour librement `quantite_livree`/`quantite_facturee` par ligne. `server/src/utils/stockSync.js` : **aucun changement nécessaire** — une ligne de section a `quantite=0` donc `delta` falsy, le garde-fou déjà en place (`if (!nom || !delta) return;`) la neutralise sans code supplémentaire, confirmé par la sync stock qui ne bouge que sur la ligne produit (95 après signature, jamais affectée par la section).
- **`server/src/utils/devisPdf.js`** : colonne "Remise" relabellée "Remise (%)", affichée en `%` au lieu de FCFA. Une ligne `type==='section'` s'affiche en gras sur toute la largeur, sans les colonnes numériques (skip du reste de l'itération). `quantite_livree`/`quantite_facturee` volontairement **jamais imprimés** — champ de suivi interne non garanti à jour, pas destiné à figurer sur un document que le client pourrait prendre pour un bordereau de livraison officiel. Le test existant (`devisPdf.test.js`, lignes sans `type`/`remisePourcentage`) passe sans modification (`undefined` retombe proprement sur les valeurs par défaut).
- **Frontend** (`src/App.jsx`, `DevisModule`) : `emptyLigne` gagne `type: 'produit'`/`remisePourcentage` (remplace `remise`) ; nouveau `emptySectionLigne`. Bouton "Ajouter une section" à côté de "Ajouter une ligne" (formulaire d'ajout et modale d'édition). Rendu conditionnel par ligne : une section n'affiche qu'un champ titre + bouton supprimer, un produit garde la grille complète avec "Remise (%)". `totalForm`/`totalEditForm` sautent les sections et appliquent la formule pourcentage via un `ligneTotal` local (miroir du helper backend). Popup de détail : en-tête `Produit | Qté | P.U. | Remise (%) | Livré | Facturé | Total`, une section s'affiche en une seule cellule pleine largeur en gras, les lignes produit gagnent deux champs Livré/Facturé éditables (state local `quantitesEdit`, peuplé à l'ouverture depuis les valeurs serveur) visibles uniquement hors `Brouillon`, plus un bouton "Enregistrer les quantités" appelant la nouvelle route puis rafraîchissant la popup. `src/lib/api.js` : `updateDevisLigneQuantites(id, lignes)`.
- **Vérification** : répétition complète contre une copie restaurée de la production réelle (dump explicite, conteneur jetable, `migrate.js` ×3) — confirme `devis_lignes.id=33 → remise_pourcentage=0.04`, `quantite_facturee=45.00` rétro-rempli (devis 16, `statut='Facturé'`), `devis.total` inchangé (`24 965.00`), colonne `remise` disparue, idempotence sur les runs suivants ; migration réelle appliquée en production avec un résultat identique. HTTP réel (throwaway) : devis section+produit+remise 10%/20% → total exact à la FCFA près dans les deux sens (création et `PUT`), validation manuelle → mouvement de stock uniquement sur la ligne produit (jamais la section), `facturer` → `quantite_facturee` auto-remplie sur la ligne produit seule, `GET /ledger` exclut la section, `PATCH lignes-quantites` persiste et n'est jamais réinitialisé par les autres routes, route publique (`GET /public/:token`, `POST /public/:token/signer`, `GET /public/:token/pdf`) correctement exposée avec `type`/`remisePourcentage` et sans les champs de suivi interne, `remettre-brouillon` restitue exactement le stock décrémenté à la signature. PDF (privé et public) généré sans erreur y compris sur la ligne réelle historique `id=33`. Navigateur réel (entreprise jetable "Browser Verify Devis SARL", nettoyée après) : création d'un devis avec section + remise 20% (total live-recalculé à 16 000 FCFA), popup de détail affichant correctement la section en gras et les champs Livré/Facturé, édition et persistance de `Livré=2` confirmée après fermeture/réouverture de la popup, "Valider et facturer" → `Facturé=4` auto-rempli en préservant `Livré=2`, Comptabilité confirmant une seule ligne de vente (la section n'apparaît jamais). `npx vite build`, `npm test` (racine), `server/npm test` tous verts à chaque étape.

**feuille de route ERP terminée** — les 4 étapes (`produits`+catégories, `contacts` unifiés, `listes_prix` nommées, lignes de devis enrichies) sont toutes conçues, exécutées et vérifiées en production. Rien n'est identifié comme prochaine étape de cette initiative ; toute suite (ex. facturation fournisseur, comptabilité en partie double) serait une nouvelle décision produit, pas la continuation d'un plan déjà arrêté.

### RH complète — alignement sur le module RH open source de l'ERP (2026-08-27/28)

Gros chantier : le module Employés passe d'une fiche à plat (nom/poste texte/salaire/champs `presence`/`avances`/`conges` plats) à une vraie RH. 6 volets, tous **additifs** (les colonnes/tables RH pré-existantes ne sont pas retirées) — voir la mémoire correspondante pour la feuille de route et les 5 simplifications assumées vs l'ERP (pas de moteur de paie — `hr_payroll` est Enterprise, absent du clone ; contrats = table dédiée pas le modèle « versions » ; validation congé 1 niveau ; calendrier de travail minimal ; feuilles de temps imputées directement parcelle/poulailler).

- **DB** (`server/src/db/migrate.js`, bloc « RH complète ») : `departements`, `postes`, `jours_feries`, `conges_types`, `conges_droits`, `salaries_contrats`, `salaries_temps` (toutes `entreprise_id NOT NULL ON DELETE CASCADE`) + colonnes sur `salaries` (`poste_id`, `departement_id`, `manager_id` auto-réf., `photo` base64, état civil/contact urgence/pièce identité, `date_depart`/`motif_depart`, `cout_horaire`, `heures_hebdo`, `jours_travailles` CSV) + `salaries_conges` enrichie (`type_id`, `nb_jours`, `demi_jour_debut`/`_fin`) + `equipements.salarie_id`. 3 fonctions d'amorçage idempotentes (`seedCongesTypesForExistingEntreprises`, `migratePostesFromSalaries` : crée un `postes` par intitulé texte distinct + relie `poste_id` ; `migrateContratsFromSalaries` : un CDI amorcé depuis `salaries.salaire`). `salaries` elle-même n'avait jamais été créée par `migrate.js` (même trou que `poulailler_stocks.entreprise_id`) — `CREATE TABLE IF NOT EXISTS` ajouté. Register (`auth.js`) seede aussi les 4 types de congés par défaut.
- **Calcul de la durée d'un congé** : `server/src/utils/congesJours.js` — jours ouvrés hors dimanche + jours fériés (`jours_feries` par entreprise, aucune liste pré-remplie — appli multi-continents) + calendrier `jours_travailles` du salarié si renseigné, demi-journées `-0,5`. **Congé approuvé → lignes de présence `'Congé'` posées automatiquement** sur chaque jour ouvré ; retirées au refus / repassage en Demandé depuis Approuvé / suppression d'un congé approuvé.
- **Backend** : `server/src/routes/rh.js` (nouveau, `/api/rh` — CRUD départements/postes/jours-fériés/types-de-congés) + `server/src/routes/salaries.js` réécrit : self-service (`GET /moi`, helper `resolveAccessibleSalarie` = admin OU le salarié lié OU son manager direct), contrats (nouveau contrat désactive les précédents + resync `salaries.salaire`), droits & **solde** (`alloué − Σ nb_jours approuvés de l'année`), feuilles de temps (imputables parcelle/poulailler, validées entreprise), **bulletin mensuel estimé** (`net ≈ salaire − avances du mois − retenue absences non payées`, lecture seule), `journal_modifications`/`activites`/`messages` branchés sur `ressource_type='salarie'` (ajouté à `RESSOURCES_VALIDES` dans `activites.js`/`messages.js`). Écritures RH = `requireRole('admin')`, **sauf** la création d'une demande de congé (self-service : admin OU soi) ; l'approbation reste admin OU manager, jamais soi-même.
- **Frontend** : `EmployeesModule` (`App.jsx`) réécrit — avatar (`ContactAvatar` réutilisé), sélecteurs Poste/Département/Manager, bloc « informations complémentaires » repliable, filtre par département, vue trombinoscope, « créer un compte de connexion » depuis la modale d'édition, statut/date/motif de départ, panneau `RhReferentiels` repliable. `src/components/EmployeeRhModal.jsx` réécrit en notebook 10 onglets (Infos/Présences/Congés/Avances/Contrats/Temps/Bulletin/Historique/Activités/Messages), gabarit 800px, `.data-table`/`.field-group`. `src/components/MonEspaceRh.jsx` (nouveau) — onglet « Mon espace RH » ungated (comme Profil/Aide), self-service : sa fiche + solde + demande de congé + présences/avances/bulletin en lecture seule ; état vide propre si aucune fiche liée. `src/components/RhReferentiels.jsx` (nouveau). `roles.js` inchangé (le tab `employees` reste gaté admin/directeur/gestionnaire).
- **Vérifié** : migration base neuve (ordre des FK OK) + base existante ×3 idempotente ; HTTP réel bout en bout (solde/décompte/congé→absence, contrat qui resync le salaire, bulletin, cross-tenant 404, self-service : ouvrier voit `/moi`, pose un congé, ne peut pas l'approuver → 403) ; navigateur réel sur entreprise jetable (supprimée après). `npx vite build` + les deux `npm test` verts.

### Internationalisation — plomberie i18n + devise/locale par entreprise (étape 1, 2026-08-28)

Décision produit forte, réaffirmée 3×, à traiter comme **prérequis de mise en production** et non du backlog : l'appli vise **tous les continents dès l'ouverture**, donc UI multilingue + formats localisés sont dans la définition de « livrable » (voir la mémoire `feedback_global_scope_not_local`). Étape 1 = la plomberie + une tranche verticale de référence, **pas** la traduction des ~6000 chaînes (migration au fil de l'eau ensuite).

- **Deux axes distincts, modèle ERP** : (1) **langue de l'UI = choix par utilisateur**, persistée `localStorage` (`agri-lang`, + flag `agri-lang-explicit`), gérée par `i18next` + `react-i18next` + `i18next-browser-languagedetector` (nouvelles deps, `--legacy-peer-deps`). (2) **devise + locale de formatage = par entreprise** (`entreprises.devise` TEXT DEFAULT `'XOF'`, `entreprises.locale` TEXT DEFAULT `'fr-FR'`) — une entreprise = une devise, l'affichage seul est localisé, **pas** de conversion multi-devise (les colonnes montants ne changent pas).
- **Fichiers** : `src/i18n/index.js` (config, catalogues `fr.json`/`en.json` importés en dur pour l'instant — passer à `import()` par langue quand la liste s'allongera), `src/i18n/locales/{fr,en}.json` (amorcés avec la tranche de référence seulement), `src/lib/locale.jsx` (`LocaleProvider` + `useLocale()` + helpers `fmtMoney`/`fmtNumber`/`fmtDate` via `Intl.*` lisant un `_config` module-level tenu synchro — appelables aussi hors composant ; + `fmtMoneyWith`/`fmtDateWith` à locale/devise explicites pour les aperçus ; listes `DEVISES`/`LOCALES`). `main.jsx` importe `./i18n` et enrobe `<App>` d'un `<LocaleProvider>`.
- **Backend** : `auth.js` (register accepte `devise`/`locale` ; register/login/`/me` les renvoient dans `entreprise`), `entreprise.js` (`GET`/`PUT /entreprise` les exposent ; `updateEntreprise`/`getEntreprise` ajoutés à `src/lib/api.js` — `PUT /entreprise` n'était câblé à aucune UI jusqu'ici).
- **App.jsx** : `handleAuth` + l'effet de vérification du token appellent `applyEntrepriseLocale(entreprise)` → `setLocaleConfig({devise, locale})` + (si aucun choix de langue explicite) aligne la langue UI sur la locale entreprise (`en-US` → `en`). Tranche convertie : libellés de `availableTabs` (`t('nav.*')`), en-têtes de groupe `SidebarNav` (`NAV_CATEGORIES` porte un `labelKey`), tout `LoginScreen` (+ 2 sélecteurs devise/locale à l'inscription), et `ProfilModule` (nouvelle carte « Préférences » : sélecteur de langue par utilisateur + devise/locale entreprise réservés admin + aperçu live montant/date + « Enregistrer »).
- **Convention pour la suite** (migration incrémentale des ~5900 chaînes restantes) : toute chaîne visible ajoutée passe par `t('namespace.clé')` avec l'entrée correspondante dans `fr.json` **et** `en.json` ; tout montant affiché passe par `fmtMoney(...)` (ou `useLocale().fmtMoney`) au lieu de `x.toLocaleString('fr-FR') + ' FCFA'` ; toute date par `fmtDate(...)`. Ne **jamais** ajouter de nouvelle chaîne française en dur ni de `' FCFA'` concaténé.
- **Vérifié navigateur réel** (entreprise jetable EUR/`en-US`, supprimée après) : register renvoie bien `devise`/`locale` ; à la connexion l'UI bascule en anglais automatiquement (`agri-lang=en`, libellés nav EN, zéro reliquat FR) et les montants se formatent en `€` ; carte Préférences OK (sélecteur langue bascule l'UI sans reload + pose le flag explicite ; changer devise/locale met l'aperçu à jour immédiatement ; « Enregistrer » persiste — `GET /entreprise` confirme `XOF`/`fr-CI`). `npx vite build` + les deux `npm test` verts.

**Migration incrémentale — passe 1 (2026-08-28)** : tout le parcours de première impression est bilingue (chrome de l'app + premier écran). Convertis : topbar (`shell.*` — Gérer les options / En ligne-Hors ligne / synchro, `role.*` pour le badge de rôle, `fmtDate` pour la date de dernière synchro), les 3 écrans d'onboarding (`onboarding.*`), `ModulesScreen` + `OptionCard` (`modulesScreen.*` avec `features` en tableaux via `returnObjects:true`, `optionCard.*`), `HomeOverview` (`home.*` — 8 cartes via `fmtMoney`, alertes avec pluriels `_one`/`_other` et `{{amount}}` via `fmtMoney`), `NotificationsModule` (`notifications.*` — messages interpolés, montant facture via `fmtMoney`). Vérifié navigateur (entreprise jetable USD/en-US) : ces écrans 100% EN, aucun reliquat FR, aucune erreur console i18n ; bascule retour FR OK ; le `$` reste appliqué même en UI française (devise = par entreprise, langue = par utilisateur — comportement voulu). **Reste** : tous les gros modules métier (Cultures, Poulailler, Devis, Finances, Contacts, Achats, RH, Calendrier, Récoltes, Rapports, Prévisions, Assistant, Observations, Équipements, Feedback, Aide…) — encore en FR en dur, à migrer module par module en suivant la même convention.

### 2FA par email + nettoyage de la carte « Méthode de vérification (entreprise) » (2026-08-29)

Chantier Jalon 1 (plan validé, cf. mémoire `project_mfa_cleanup_email_2fa`). Avant : seule la 2FA
TOTP (application d'authentification) fonctionnait de bout en bout ; `ProfilModule` affichait en
plus une carte admin « Méthode de vérification (entreprise) » qui appelait `GET`/`PUT
/api/mfa/company-method` — **route inexistante**, échecs silencieux, réglage jamais persisté ni lu
au login. `mailer.js` avait déjà `sendMfaCodeEmail()` complète mais **zéro appelant**.

**Inspiration de l'ERP de référence** (`addons/auth_totp` + `auth_totp_mail` du clone local) : le
code envoyé par email n'est **jamais stocké**. Il est *dérivé* à la demande d'une clé serveur +
identité utilisateur sur un pas de temps, puis recalculé à la vérification. Repris tel quel.

- **`server/src/utils/mfaCode.js`** (nouveau) : `generateEmailCode`/`verifyEmailCode` — HOTP maison
  sur HMAC-SHA256, clé `HMAC(JWT_SECRET, 'mfa-email:'+userId+':'+email)`, pas de 10 min, tolérance
  ±1 pas (validité effective 10-20 min). Aucune colonne de code, aucun nettoyage d'expiration ;
  changer `JWT_SECRET` invalide tous les codes. Aussi : `maskEmail()` (`o****@iprec.fr`) et
  `requestContext(req)` (sniff minimal navigateur/OS/IP pour l'email de code, sans dépendance).
- **Migration** (`migrate.js`) : `ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_method VARCHAR(10)
  NOT NULL DEFAULT 'totp'` — seule colonne ajoutée. Les comptes ayant déjà activé la 2FA restent en
  TOTP (défaut).
- **`routes/mfa.js`** : `/setup` et `/verify` prennent `{ method: 'totp' | 'email' }` ; nouveau
  `/resend` (renvoi du code email à l'enrôlement) ; `/disable` remet `mfa_method='totp'`. Chaque
  utilisateur choisit sa méthode à l'activation (modèle GitHub/Google) — **pas** de réglage 2FA au
  niveau entreprise. Rate-limit d'envoi : 5 emails / heure / compte (compteur = lignes `audit_log`
  action `mfa_email_code_sent`), sinon 429. Nouvelle action d'audit : `mfa_email_code_sent`.
- **`routes/auth.js`** login : si `mfa_method='email'` et pas de `mfaCode` → génère + envoie le
  code (échec d'envoi non bloquant, comme `devis.js`), renvoie `{ mfaRequired:true,
  mfaMethod:'email' }` ; vérifie via `verifyEmailCode` au lieu d'otplib. Rate-limit de vérification :
  5 `login_failed_mfa` / heure → 429 (parité `code_check` de l'ERP de référence). `GET /auth/me`
  renvoie désormais `mfaMethod`.
- **`utils/auditLog.js`** : `countRecentAuditEvents(email, actions, sinceMinutes)` (renvoie 0 en cas
  d'erreur SQL — le rate-limiting ne doit jamais bloquer une connexion légitime).
- **`mailer.js`** : `sendMfaCodeEmail(to, code, context)` — ajoute une ligne appareil/navigateur/IP
  de la tentative (repère anti-phishing, même intention que l'email de code de l'ERP de référence).
- **Frontend** : `api.js` — `setupMfa(method)`/`verifyMfa(code, method)`/`resendMfaEmail()`,
  suppression de `getMfaCompanyMethod`/`setMfaCompanyMethod`. `ProfilModule` — carte « Méthode de
  vérification (entreprise) » **entièrement supprimée** (+ son state) ; carte « Sécurité du
  compte » : choix TOTP/Email avant activation, branche email avec lien « Renvoyer le code », ligne
  « Méthode active : … » une fois activée. `LoginScreen` — écran MFA affiche un hint spécifique
  quand `mfaMethod==='email'`. i18n : `auth.mfaHintEmail`, `profil.mfaChooseMethod` /
  `mfaMethodActive` / `mfaResend` / `mfaResent` ajoutés ; `companyMethod*` / `smsNote` /
  `methodSms` retirés (fr + en).
- **SMS** : toujours non traité (prestataire payant, hors budget) ; `mfa_method` reste extensible à
  `'sms'`. L'enforcement de la 2FA par politique reste reporté à l'avant-prod.
- **Vérifs** : `npx vite build` OK, `server/npm test` + racine `npm test` verts. Test HTTP e2e réel
  contre la stack Docker (script jetable, 12 assertions vertes) : parcours email complet (setup →
  502 attendu sans `EMAIL_*` mais code dérivable → verify → login 2 étapes → mauvais code 401 → bon
  code token) **et** TOTP non régressé (setup QR → verify → login). Entreprises/comptes de test
  supprimés après (nettoyage multi-tables : `produit_categories`, `audit_log`,
  `entreprise_utilisateurs`, `entreprises`, `users`).
### Journal d'audit — actions financières des devis (2026-08-29)

Dernier trou identifié du chantier « Journal d'audit » du Jalon 1 (cf. CLAUDE.md). Les
transitions de `routes/devis.js` réservées à l'admin ne laissaient qu'une trace partielle
(`finances.user_id` + `devis.statut` + le `journal_modifications` par enregistrement) ;
rien dans `audit_log`, la table de sécurité relue par `GET /api/auth/audit-log`.

- **`routes/devis.js`** : import de `logAuditEvent`, puis un appel après l'`UPDATE`/`COMMIT`
  réussi de chaque route admin, **en plus** du `logFieldChanges` existant (table et finalité
  différentes) :
  - `POST /:id/valider-manuel` → `devis_valide_manuel` (`details`: devisId, numero, statutAvant, confirmePar)
  - `POST /:id/annuler` → `devis_annule` (devisId, numero, statutAvant)
  - `POST /:id/facturer` → `devis_facture` (devisId, numero, total, modePaiement, modalitePaiement, nbEcheances)
  - `POST /:id/remettre-brouillon` → `devis_remis_brouillon` (devisId, numero, statutAvant)
  - `POST /:id/echeances/:echeanceId/payer` → `devis_echeance_payee` (devisId, numero, echeanceId, montant, nouveauStatut)
  - `PATCH /:id/lignes-quantites` → `devis_quantites_ajustees` (devisId, numero, nbLignes)
  - `userId`/`email` de la ligne = l'admin acteur ; IP/User-Agent captés via `req`.
  - 4 `SELECT` de contrôle étendus pour récupérer `numero` là où le handler ne l'avait pas.
- **Hors périmètre, assumé** : `POST /:id/envoyer` (pas gated admin, pas une transition
  financière ; garde son `logFieldChanges` + token public). Pas d'UI : il n'existe aucun
  écran de journal d'audit dans l'app (les connexions n'en ont pas non plus) — accès
  uniquement via l'API admin, cohérent avec l'existant.
- **`logAuditEvent`** avale déjà ses propres erreurs (jamais de throw) → aucun try/catch au
  point d'appel, le chemin financier ne peut pas casser à cause du journal.
- **Vérifs** : `server/npm test` vert. Test HTTP e2e contre la stack Docker (17 assertions
  vertes) : entreprise + admin jetables, un devis passé par valider-manuel → facturer
  (échelonné, 2 échéances) → payer échéance → lignes-quantites → remettre-brouillon, un
  second devis annulé, puis `GET /api/auth/audit-log` et assert de chaque action + `details`
  (devisId, numero, montants, statuts) + présence de l'email acteur et du User-Agent.
  Données de test supprimées après (nettoyage multi-tables : finances, echeances_paiement,
  devis_lignes, devis, journal_modifications, contacts, produit_categories, audit_log,
  entreprise_utilisateurs, entreprises, users).
### Backups — alerte à l'échec + test de restauration automatisé (2026-08-29)

Dernier item de code autonome du Jalon 1. Avant : `server/backup.sh` vérifiait déjà le
code retour de `pg_dump` et la non-vacuité du fichier, mais un cycle en échec ne faisait
que logger et attendre 6 h ; aucun test de restauration en dehors d'une vérif manuelle
ponctuelle (cf. section « Backups » de CLAUDE.md).

Le conteneur `backup` est une image `postgres:18-alpine` nue (pas de node → pas d'accès
au `mailer` de l'app), donc « alerte » = **fichiers sentinelles** dans `./backups/`
(monté sur l'hôte), à surveiller par un opérateur ou un futur check :
- `.last_success` — réécrit (horodatage + taille) à chaque dump réussi.
- `.last_failure` — écrit (horodatage + raison) si `pg_dump` échoue ou rend un fichier
  vide ; **supprimé** au dump réussi suivant. Présent = un dump est actuellement cassé.
- `.last_restore_test` — résultat du dernier test de restauration, `"<ts> OK …"` ou
  `"<ts> FAIL …"`. Volontairement **pas** écrit dans `.last_failure` (qu'un dump réussi
  ultérieur effacerait, masquant l'échec) — un `FAIL` en tête de ce fichier est sa propre
  alerte.

Test de restauration (`run_restore_test`, dans le même script) :
- Ne tourne qu'une fois tous les `RESTORE_TEST_INTERVAL_HOURS` (env, défaut 168 ≈ hebdo ;
  vérifié via `find -mmin` sur `.last_restore_test`), **après** dump + rotation et jamais
  de façon bloquante (`run_restore_test || true`).
- `createdb agri_app_restore_test` → `pg_restore` du dump le plus récent → comparaison
  base restaurée vs base live : nb de tables du schéma `public` + nb de lignes de `users`
  et `entreprises` → `dropdb`. `rc != 0` de `pg_restore` **ou** un compteur qui diffère
  → `FAIL`. `DB_USER` = superuser Postgres (`POSTGRES_USER`), donc create/drop autorisés.

Vérifié de bout en bout contre la stack locale : cycle normal écrit `.last_success` ;
test de restauration forcé OK (`tables 54/54 users 13/13 entreprises 9/9 rc=0`) et base
jetable bien supprimée (aucun résidu) ; échec de `pg_dump` simulé (mauvais `DB_NAME`)
écrit `.last_failure` + `exit 1` sans toucher `.last_success` ; le cycle réussi suivant
efface `.last_failure`. `find -mmin` confirmé supporté par le busybox de l'image.

`Dockerfile.backup` et `docker-compose.yml` inchangés (boucle 6 h et env identiques ;
`RESTORE_TEST_INTERVAL_HOURS` peut être posé sur le service `backup` si besoin). Reste à
faire : transformer les sentinelles en vraie alerte poussée (email/webhook) — reporté à
quand l'hébergement + un SMTP existeront.
### Nettoyage post-audit statique : code mort + trou i18n dates + imports inutilisés (2026-08-29)

Suite à la passe de durcissement statique (pas de navigateur dispo cette session), trois
points relevés puis traités :

1. **Code mort supprimé** — `MovementTab` (~444 lignes) et son helper `renderInvoiceHtml`
   (~26 lignes) dans `src/App.jsx`. Confirmé jamais rendu : les onglets « Ventes » de
   Cultures/Poulailler passent par `VentesWithDevis` → `DevisModule` depuis longtemps, et
   `MovementTab` n'apparaissait dans aucun JSX. Il traînait 12 occurrences de
   `' FCFA'` / `toLocaleString('fr-FR')` en dur — sans impact car mort, mais autant les
   faire disparaître. Net : `App.jsx` −489 / +15 lignes.

2. **Trou i18n sur les dates** — `formatDateFr` / `formatDateTimeFr` (helpers de rendu
   utilisés par de nombreuses tables) forçaient le format `fr-FR` quelle que soit la
   locale de l'entreprise → une entreprise `en-US` voyait quand même `JJ/MM/AAAA`.
   Réécrits pour déléguer à `fmtDate` (de `src/lib/locale.jsx`, fonction autonome au
   niveau module, tenue à jour par `LocaleProvider` — appelable hors composant). Repli sur
   la valeur brute conservé pour les entrées illisibles. Résultat : **plus aucune**
   occurrence de `' FCFA'` / `toLocaleString('fr-FR')` dans `App.jsx`.

3. **Warnings oxlint** — 11 imports inutilisés retirés de `App.jsx` (`Sun`,
   `TrendingDown`, `Printer`, `createFinance`, `deleteFinance`,
   `create/update/deleteCulturesMouvement`, `updateProduitCategorie`,
   `create/update/deletePoulaillerMouvement`, `get{Poulailler,Cultures}MouvementHistorique`,
   `mapUiRoleToBackend`) + variable morte `toneFor`. Certains n'étaient utilisés que par
   `MovementTab`. Restent 2 warnings cosmétiques (paramètre `farmId` non utilisé dans
   deux composants) — laissés tels quels, retirer un prop change le contrat du composant
   pour un gain nul.

Vérifs : `npx vite build` OK, racine `npm test` (6) vert, `oxlint` sans erreur. Backend
non touché.
### Suite de tests d'intégration backend (2026-08-29)

Avant : 2 fichiers de test pour 25 routes (1 backend `devisPdf`, 1 frontend `ObservationListView`).
Tout le test d'API se faisait via des scripts jetables lancés à la main contre la stack
Docker. Rien ne figeait ces vérifs.

- **`server/src/app.js` (recréé)** : fabrique de l'app Express (montage de toutes les
  routes `/api/*`), sans `listen()` ni `testDatabase()`. `server.js` l'importe et se
  limite désormais à vérifier la base puis ouvrir le port. Même source de montage pour la
  prod et pour supertest. (Un ancien `app.js` — simple doublon — avait été supprimé le
  2026-08-16 ; celui-ci a un rôle différent et assumé.)
- **otplib `createRequire` → `import` ESM** dans `auth.js` et `mfa.js`. otplib 13 est
  dual ESM/CJS ; le chemin CJS tire `@scure/base` que le runtime de Jest ne sait pas
  charger (`Must use import to load ES Module`). L'import ESM natif marche aussi bien
  sous `node` qu'avec Jest `--experimental-vm-modules`. Vérifié : le serveur Docker
  reconstruit démarre et `/mfa/setup` renvoie toujours secret + QR.
- **`npm run test:integration`** (`server/jest.integration.config.cjs`) : supertest en
  ESM natif (`transform: {}`), `globalSetup` (re)crée + migre une base dédiée
  `agri_app_test` sur le conteneur `db` (port hôte 5433, **jamais** la base de dev),
  `globalTeardown` la supprime (`TEST_DB_KEEP=1` pour la garder). `env.js` (setupFiles)
  force les variables DB et vide `EMAIL_*` (les envois échouent, comportement attendu et
  asserté). `npm test` (unitaire) reste sans base : `testPathIgnorePatterns` exclut
  `src/test/integration/`.
- **Couverture (12 tests, 3 fichiers)** :
  - `auth.test.js` — register (+ email en double refusé), login (bon/mauvais mot de
    passe/email inconnu), route protégée sans token → 401, `requireRole` (ouvrier →
    403 sur `POST /business/finances`), isolation multi-tenant (contacts non listés/non
    modifiables entre entreprises, devis non lisible entre entreprises).
  - `devis.test.js` — cycle brouillon → validé manuel → facturé échelonné → paiement
    d'échéance → suivi quantités → remise en brouillon ; assertions sur chaque ligne
    `audit_log` (`devis_valide_manuel`/`_facture`/`_echeance_payee`/`_quantites_ajustees`/
    `_remis_brouillon`/`_annule`, détails + email acteur + IP) ; workflow financier
    réservé admin (ouvrier → 403).
  - `mfa.test.js` — TOTP setup/verify + login 2 étapes (mauvais code → 401) ; code par
    email (setup → 502 sans SMTP mais code dérivable, verify OK, `mfaMethod` renvoyé par
    `/auth/me` et par l'étape 1 du login, mauvais code → 401).
- Dépendance ajoutée : `supertest` (dev). Vérifié : `npm test` unitaire toujours vert,
  `npm run test:integration` 12/12 vert, base de dev `agri_app` intacte après coup,
  `agri_app_test` bien supprimée.
### Tests d'intégration — extension Achats + RH (2026-08-29)

Suite de la mise en place supertest : 12 → 23 tests, 3 → 5 fichiers.

- **`achats.test.js`** — cycle document d'achat `Brouillon → Commandé → Reçu → réception
  annulée` ; vérifie que `recevoir` crée bien une écriture `finances`
  (`Achat — <fournisseur> (<module>)`, montant négatif = `-total`) et que
  `annuler-reception` la retire ; garde-fous de transition (`recevoir` sur brouillon → 400,
  double `commander` → 400) ; validation d'entrée (module invalide / sans fournisseur /
  sans lignes → 400) ; isolation multi-tenant (B ne peut ni `GET /:id` ni `commander` le
  document de A → 404, absent de la liste).
- **`rh.test.js`** — référentiels `/api/rh` : admin crée département + poste rattaché,
  `GET` les liste, ouvrier sur `POST /departements` → 403 ; `register` seede déjà des
  types de congé par défaut (asserté) ; **congés self-service** : l'employé (via
  `GET /salaries/moi`) demande un congé Lun→Ven → `nbJours === 5`, statut `Demandé` ; il
  **ne peut pas** approuver sa propre demande (403) ; l'admin approuve → `Approuvé` ;
  `GET /:id/conges-solde` décompte correctement (`alloués 25, pris 5, restant 20`) ;
  avances réservées admin (ouvrier non lié → 403) ; nouveau contrat → un seul `actif` ;
  isolation multi-tenant (B ne voit pas l'employé de A, `POST conges-droits` sur son id
  avec le token de B → 404).
- **Helper** : `createEmployeeLogin` renvoie désormais aussi `salarieId` (nécessaire aux
  routes `/salaries/:id/*`).

Vérifs : `npm run test:integration` 23/23 vert, `npm test` unitaire toujours vert, base
de dev `agri_app` intacte (9 entreprises / 9 salariés / 4 docs d'achat inchangés),
`agri_app_test` bien supprimée après.
### Tests d'intégration — extension Contacts + Listes de prix (2026-08-30)

23 → 35 tests, 5 → 7 fichiers.

- **`contacts.test.js`** — asymétrie client/fournisseur (création client seul / fournisseur
  seul / ni l'un ni l'autre → 400 ; filtres `?type=client|fournisseur` ; un contact mixte
  apparaît des deux côtés ; `PUT` qui bascule client→fournisseur le sort de `?type=client` ;
  `PUT {false,false}` → 400) ; société + sous-contacts (`parentId`/`parentNom`, filtre
  `?parentId=`) ; tags (`POST /contact-tags`, création avec `tagIds`, `PUT {tagIds:[]}`
  détague) ; suppression (simple OK ; contact référencé par un devis → 409) ; isolation
  multi-tenant.
- **`listesPrix.test.js`** — CRUD liste (nom en double → 409, `nombreLignes`) ; lignes
  (ajout, **upsert** sur même article via `ON CONFLICT`, validation → 400, article d'une
  autre entreprise → 404, liste inexistante → 404, `stockNom`/`module` renvoyés,
  `DELETE /lignes/:id` puis re-DELETE → 404) ; assignation à un contact
  (`PUT contacts {listePrixId}`) → `GET /contacts/:id/prix-effectifs` renvoie les lignes ;
  contact sans liste → `{prix:[]}` ; **supprimer la liste détache le contact**
  (`ON DELETE SET NULL`) → `prix-effectifs` redevient `[]` ; isolation multi-tenant.
- **Helper** : `createProduit(token, {module})` (récupère une catégorie seedée puis crée le
  produit) pour alimenter les lignes de liste de prix.

- **Bug trouvé + corrigé** (par `contacts.test.js`) : `DELETE /api/contacts/:id` était bien
  cloisonné par `entreprise_id` (pas de suppression cross-tenant) mais ne testait jamais
  `rowCount` → renvoyait `{ success: true }` / 200 même sur 0 ligne (mauvais tenant ou id
  bidon), incohérent avec `PUT /:id` et tous les autres `DELETE`. Corrigé : 404 sur 0 ligne.

Vérifs : `npm run test:integration` 35/35 vert, `npm test` unitaire vert, backend Docker
reconstruit et OK, base de dev `agri_app` intacte, `agri_app_test` supprimée après.
### Tests d'intégration — extension Banques + Équipements (+ gate /api/banques) (2026-08-30)

35 → 45 tests, 7 → 9 fichiers.

- **`banques.test.js`** — CRUD (nom requis → 400, `GET` scopé, `PUT` met à jour, `DELETE`
  retire, `PUT`/`DELETE` sur id inexistant → 404) ; **rôles** : ouvrier sur
  `POST`/`PUT`/`DELETE` → 403, lecture OK ; **compte principal**
  (`PUT /entreprise/banque-principale` admin, ouvrier → 403) + effet métier : un achat
  reçu avec banque principale posée → l'écriture `finances` sort en `categorie: 'Banque'`
  (+ `banqueId`) au lieu de `Caisse` ; isolation multi-tenant.
- **`equipements.test.js`** — CRUD (nom requis, `PUT`/`DELETE` id inexistant → 404) ;
  **rôles** : ouvrier → 403 sur les écritures, `gestionnaire` (rôle autorisé) → 201,
  lecture ouverte ; **maintenance** (description requise, liste, suppression + re-
  suppression → 404, sous-route sur équipement inexistant → 404) ; isolation multi-tenant
  y compris les sous-routes.

- **`/api/banques` gated `requireRole('admin', 'directeur')`** (décision utilisateur
  explicite) sur `POST`/`PUT`/`DELETE` — avant : aucune garde, un `ouvrier` pouvait
  créer/modifier/supprimer des comptes bancaires, incohérent avec le gate des écritures
  financières (`/business/finances`) alors que les comptes sont ce que ces écritures
  référencent. `GET /` reste ouvert à tous les rôles.
- **Même classe de bug que `DELETE contacts` la veille** : `DELETE /api/banques/:id`
  renvoyait `{ success: true }` / 200 et `PUT /api/banques/:id` renvoyait `{ banque: null }`
  / 200 même sur 0 ligne (mauvais tenant / id bidon). Corrigé → 404 sur 0 ligne.
  `banquesService.deleteBanque` renvoie désormais `rowCount > 0` au lieu de `true`.

Vérifs : `npm run test:integration` 45/45 vert, `npm test` unitaire vert, backend Docker
reconstruit et OK, base de dev `agri_app` intacte (3 banques / 0 équipements inchangés),
`agri_app_test` supprimée après.
### Tests d'intégration — extension Observations + Récoltes (2026-08-30)

45 → 53 tests, 9 → 11 fichiers.

- **`observations.test.js`** — CRUD (`notes` requises → 400, `localisation`/`dateObservation`
  conservées, `PUT` partiel via COALESCE laisse `localisation` inchangée, `PUT`/`DELETE`
  id inexistant → 404, `DELETE` retire de la liste) ; `POST` en `ouvrier` → 201 (module
  volontairement ouvert à tous les rôles) ; isolation multi-tenant.
- **`recoltes.test.js`** — `GET`/`POST` uniquement (pas de `PUT`/`DELETE`) : golden path,
  chaque champ requis manquant → 400, `quantite: 0` accepté (≠ `''`/`undefined`),
  `GET` scopé ; **validation d'appartenance de `parcelleId`** — parcelle de la même
  entreprise → liée, parcelle étrangère ou id bidon → `parcelleId: null` stocké
  silencieusement (201, défense volontaire) ; isolation multi-tenant.

- **Correctif trouvé par `recoltes.test.js`** : `RECOLTE_COLUMNS` renvoyait `quantite`
  sans cast → chaîne JSON `"1200.00"` au lieu d'un nombre, contrairement à tous les autres
  `*_COLUMNS` du code (`::float8` partout). Le frontend le contournait déjà avec
  `Number(...)` systématiquement. Corrigé : `quantite::float8 AS quantite`.

Vérifs : `npm run test:integration` 53/53 vert, `npm test` unitaire vert, backend Docker
reconstruit et OK, base de dev `agri_app` intacte (1 observation / 1 récolte inchangées),
`agri_app_test` supprimée après.
### Tests d'intégration — extension Calendrier + Feedback + Planning (2026-08-30)

53 → 62 tests, 11 → 14 fichiers. Aucun bug backend trouvé cette passe.

- **`calendar.test.js`** — `GET`/`POST`/`PUT` uniquement (pas de `DELETE`) : `date` + `type`
  + `title` requis → 400 ; `description` conservée ; `GET` scopé et trié par date
  croissante ; `PUT` partiel (COALESCE, `type` non passé inchangé) ; `PUT` id inexistant
  → 404 ; `POST` en `ouvrier` → 201 (module ouvert) ; isolation multi-tenant.
- **`feedback.test.js`** — soumission ouverte à tout compte connecté (`message` requis,
  `type` hors liste → « Autre », renvoie `{ ok: true }`) ; `GET /` et `PATCH /:id`
  réservés au **platform admin** : un admin d'entreprise normal → 403 ; un platform admin
  (promu via `pool` + reconnexion pour rafraîchir la claim JWT) lit les retours de **toutes
  les entreprises** (lecture cross-entreprise volontaire, avec `entrepriseNom`/`userEmail`),
  `PATCH {statut}` → 200, `statut` invalide → 400, `PATCH` id inexistant → 404.
- **`planning.test.js`** — `POST` renvoie **200** (pas 201 : la persistance est un TODO
  commenté) + un plan générique de 5 jalons (Semis → Récolte) trié par date ;
  `cultureId` = un `parcelles.id` ; sans `cultureId` → 400 ; parcelle d'une autre
  entreprise ou id bidon → 404 (cloisonnement dans `getCulturePlanDetails`).
- **Helper** : `createParcelle(token)` promu dans `helpers.js` (était inline dans
  `recoltes.test.js`), réutilisé par `planning.test.js`.

Vérifs : `npm run test:integration` 62/62 vert, `npm test` unitaire vert, aucun changement
de code applicatif (fichiers de test + helper uniquement), `agri_app_test` supprimée après.
### Tests d'intégration — Cultures + Poulailler + Business + 2 correctifs backend (2026-08-30)

62 → 78 tests, 14 → 17 fichiers. **Modules restants tous couverts.**

- **`cultures.test.js`** — parcelles CRUD (nom requis, PUT partiel COALESCE, id inexistant
  → 404) ; historique des vannes (`parcelleId`+`action` requis, parcelle étrangère → 404) ;
  mouvements vente/achat ↔ synchro `finances` (POST crée la ligne, montant +qté×PU pour
  une vente / négatif pour un achat ; PUT avec `raison` la **met à jour sans doublon** +
  entrée `modification` dans l'historique ; DELETE avec `raison` supprime mouvement +
  finance + entrée `suppression`) ; filtre `?type=` ; isolation multi-tenant.
- **`poulailler.test.js`** — mouvements ↔ `finances` `(Poulailler)` (même structure) ;
  livraisons (client+produit requis, statut initial « En attente », `PUT {statut}`,
  `PUT`/`DELETE` inexistant → 404) ; suivi quotidien (type+quantite requis) ; isolation
  multi-tenant.
- **`business.test.js`** — écritures financières manuelles (montant requis, catégorie
  défaut `Caisse`, `Banque` sans `banqueId` → 400, avec → `banqueNom` relu) ; gate
  `admin/directeur` (ouvrier → 403 sur POST/DELETE, GET ouvert) ; `DELETE` + id
  inexistant → 404 ; isolation multi-tenant.

**Correctif migration — dérive `migrate.js` vs base de dev.** `parcelles_historique`,
`cultures_mouvements`, `poulailler_mouvements`, `poulailler_livraisons`, `poulailler_suivi`
filtrent et insèrent tous sur `entreprise_id`, mais leur `CREATE TABLE` ne l'incluait pas
et aucun `ADD COLUMN IF NOT EXISTS entreprise_id` n'existait — la base de dev l'avait
acquise par dérive manuelle, un déploiement neuf (et la base de test d'intégration) partait
cassé (500 sur toute écriture cultures/poulailler mouvement/historique/livraison/suivi).
Ajout des 5 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS entreprise_id` + backfill (par la
parcelle pour l'historique, sinon première entreprise) + index. `migrate.js` rejoué sur la
base de dev : no-op propre (colonnes déjà présentes). La suite d'intégration, qui migre une
base jetable de zéro à chaque exécution, garde désormais contre les deux sens de dérive.

**Correctifs 404** (même classe que `contacts`/`banques`) : `DELETE /api/cultures/parcelles/:id`,
`DELETE /api/poulailler/livraisons/:id`, `DELETE /api/business/finances/:id` renvoyaient
`{ success: true }` / 200 même sur 0 ligne → 404 sur 0 ligne.

Vérifs : `npm run test:integration` 78/78 vert, `npm test` unitaire (back + front) vert,
`migrate.js` idempotent sur la base de dev, backend Docker reconstruit, base de dev
`agri_app` intacte, `agri_app_test` supprimée après.
### CI — GitHub Actions (2026-08-30)

`.github/workflows/ci.yml` (nouveau, aucun `.github/` n'existait). Déclenché sur chaque
`push` et les `pull_request` vers `main`, `concurrency` annule le run précédent d'une même
ref.

- **Job `backend`** : service `postgres:18-alpine` (user/pass `postgres`, health-check
  `pg_isready`), Node 22, cache npm sur `server/package-lock.json`, `npm ci` dans
  `server/`, puis `npm test` (unitaire) + `npm run test:integration`. L'intégration reçoit
  `TEST_DB_HOST=localhost` / `TEST_DB_PORT=5432` (le service CI écoute directement sur
  5432, contrairement au remap 5433 local) / `DB_USER=DB_PASSWORD=postgres` /
  `JWT_SECRET=ci-test-secret`. Pas de secret GitHub : la base est un conteneur éphémère.
  Le `globalSetup` y migre une base `agri_app_test` de zéro → CI sert aussi de garde
  contre la dérive `migrate.js` vs base de dev.
- **Job `frontend`** : Node 22, `npm ci --legacy-peer-deps` (racine, comme le Dockerfile —
  `vite-plugin-pwa@0.9.3` déclare un peer `vite@^2`), `npm test` + `npm run build`.

Vérifié en local : la suite d'intégration passe (78/78) avec les mêmes variables
d'environnement explicites que le workflow (host/port/user/pass/jwt), ce qui confirme que
`testDb.cjs` + `env.js` privilégient bien l'environnement sur le repli `server/.env`
(absent en CI puisque gitignoré).
### Tests frontend — batch 1 : modules de logique pure (2026-08-30)

6 → 58 tests, 1 → 5 fichiers. Aucune régression : `vite build` OK, l'unique test
pré-existant (`ObservationListView`) passe toujours.

- **Infra** : `babel.config.cjs` gagne un bloc `env.test` avec un petit plugin inline qui
  réécrit `import.meta` → `({})` — **sous Jest uniquement** (Vite gère `import.meta`
  nativement et n'applique pas `env.test`). Sans ça, `src/lib/api.js` (dont la 1re ligne
  lit `import.meta.env.VITE_API_URL`) ne peut être chargé sous babel-jest que via un
  `jest.mock` complet. La ligne d'`api.js` est aussi rendue défensive
  (`typeof import.meta !== 'undefined' && import.meta.env?.…`), repli d'URL explicite.
  (Tentative avec `babel-plugin-transform-import-meta` abandonnée : le paquet ne
  transforme rien avec ce `@babel/core` — remplacé par le plugin inline de 8 lignes.)
- **`src/components/roles.test.js`** — forme de `ROLE_DEFINITIONS` (chaque rôle a des
  permissions non vides, `home` commun, `directeur` = `admin`, `gestionnaire` = `admin`
  moins `employees`, `assistant_direction` = `comptable` + `fournisseurs`, `ouvrier` sans
  finances/employees/modules) ; `mapUiRoleToBackend`/`mapBackendRoleToUi` (aller-retour
  stable, alias `worker`/`manager`/`director`/`assistante_direction`, inconnu/vide → `admin`).
- **`src/lib/locale.test.jsx`** — `fmtNumber`/`fmtMoney`/`fmtDate`/`fmtMoneyWith`/
  `fmtDateWith` : vide/`NaN` → « — », `0` reste formaté, XOF sans décimale vs EUR à deux
  décimales, `$`/`€` et séparateurs selon la locale, devise invalide → repli
  « <n> <devise> », dates ISO/`Date`, `juin` vs `Jun` selon la locale ;
  `setLocaleConfigGlobal` normalise ; `useLocale` hors `Provider` retombe sur les helpers,
  dans un `Provider` expose un `setLocaleConfig` réactif.
- **`src/lib/api.test.js`** (`global.fetch` mocké) — `get/set/clearToken` ;
  `request` : bearer joint, échec réseau → message convivial, 401 → token vidé +
  événement `agri-auth-expired` + throw, non-ok → message serveur ; `safeRequest` :
  erreur réseau → opération en file `agri-offline-queue` + `null`, vraie 4xx/5xx →
  rethrow sans rien mettre en file ; `flushOfflineQueue` : no-op hors ligne, rejoue et
  vide + `agri-last-sync`, garde les échecs, JSON corrompu → `{flushed:0}` + nettoyage.
- **`src/utils/storage.test.js`** (`../lib/api.js` mocké) — `storageGet` parse/fallback,
  `storageSet` écrit + n'empile dans `agri-sync-queue` que hors ligne + émet
  `agri-sync-status-changed`, `syncPendingChanges` compte la file hors ligne / délègue à
  `flushOfflineQueue` en ligne / `synced:false` si le flush jette.

Le job `frontend` du workflow CI exécute déjà ces 58 tests (`npm test`).
Batch 2 (tests de composants des vues) reste à faire.
### Tests frontend — batch 2 : composants (2026-08-30)

58 → 87 tests, 5 → 9 fichiers. `vite build` OK, aucune régression.

- **`src/components/ui.test.jsx`** — `Card` transmet `onClick` + props DOM (la régression
  documentée dans CLAUDE.md où `Card` avalait `onClick`) ; `Button` : `type` défaut
  `button`, `disabled` bloque le clic + curseur, variantes = fonds distincts ;
  `Field`/`Select` : label rendu, `value`/`onChange`/`placeholder` transmis, `className`
  fusionné avec `flat-input`, `AideChamp` seulement si `aide` fourni (tooltip au clic) ;
  `Badge` : ton inconnu → repli `green` ; `MiniChart` : « Aucune donnée » vs une barre par
  point ; toasts : `notifySuccess`/`notifyError` affichent le message (via `act`), retiré
  au clic sur ✕, `notifyError` utilise `err.message` sinon le repli.
- **`src/components/FeedbackModule.test.jsx`** (`../lib/api.js` + `notify*` mockés) —
  message vide → `notifyError`, aucun appel API ; message rempli → `createFeedback(form)`,
  textarea réinitialisée, `notifySuccess` ; `isPlatformAdmin=false` → pas de
  `getAllFeedback`, section admin absente ; `true` → chargement + affichage, erreur
  affichée, changement de statut → maj optimiste + `updateFeedbackStatus(id, statut)`.
- **`src/components/GlobalSearch.test.jsx`** (`rechercheGlobale` mocké) — < 2 caractères →
  invite, pas d'appel ; ≥ 2 caractères → après debounce, `rechercheGlobale(query)` appelé
  une fois, résultats groupés Contacts/Produits/Devis rendus ; clic → `onSelect({kind,
  item})` ; `Échap` / clic sur le fond → `onClose` ; réponse vide → « Aucun résultat ».
- **`src/components/RhReferentiels.test.jsx`** (les 12 fonctions RH de l'api mockées) —
  `canManage=false` → rien ; `canManage=true` → replié, aucun chargement ; à l'ouverture,
  `getDepartements/getPostes/getJoursFeries/getCongesTypes` appelés + liste rendue ; ajout
  d'un département → `createDepartement({nom})` + rechargement + `onChanged` ; suppression
  → `deleteDepartement(id)`.

Reste hors de portée : les gros modules-vues de `App.jsx` (`EmployeesModule`,
`DevisModule`, `CulturesModule`…), non extraits donc non testables directement.
### Récoltes — édition + suppression (2026-08-30)

Constat utilisateur : une récolte ne pouvait pas être corrigée une fois saisie. Ce n'était
pas un choix métier — `recoltes.js` n'avait jamais eu que `GET`/`POST` (voir l'entrée
« Calendrier & Récoltes »). Ajouté :

- **`server/src/routes/recoltes.js`** : `PUT /:id` (remplacement complet, mêmes champs
  requis que le `POST`, `parcelleId` vérifié → `null` si étranger/invalide, `WHERE id
  AND entreprise_id`, 0 ligne → 404) et `DELETE /:id` (0 ligne → 404). Helper
  `resolveParcelleId` factorisé entre `POST` et `PUT`.
- **`src/lib/api.js`** : `updateRecolte(id, payload)` (PUT) et `deleteRecolte(id)` (DELETE),
  via `safeRequest` comme le reste du module.
- **`src/App.jsx` `HarvestsModule`** : colonne d'actions dans le tableau — bouton ⚙️
  (modale d'édition, 7 champs identiques au formulaire d'ajout, patron repris de la
  modale du Calendrier) et bouton 🗑️ (`window.confirm`). Les deux gèrent le mode
  hors-ligne (branche `useRemote === false` : maj/filtre du state local, `storageSet` via
  l'effet existant). Reconstruction de la valeur du `<select>` parcelle à l'ouverture de
  la modale (id si la parcelle existe encore, sinon « Autre parcelle » + nom libre).
  Clés i18n `harvests.editTitle` / `updated` / `updateError` / `deleteConfirm` / `deleted`
  / `deleteError` ajoutées (fr + en).
- **`server/src/test/integration/recoltes.test.js`** : `PUT` met à jour (relu via `GET`),
  champ requis manquant → 400, id inexistant → 404, `parcelleId` étranger → `null` ;
  `DELETE` → 200 + absent, re-`DELETE` → 404 ; isolation multi-tenant (`PUT`/`DELETE` sur
  la récolte d'une autre entreprise → 404).

Vérifs : `vite build` OK, front `npm test` 87/87, `test:integration` 82/82, back `npm test`
vert, smoke HTTP réel contre la stack Docker (POST → PUT 200 → DELETE 200 → re-DELETE 404),
entreprise de test supprimée.
### Recherche globale — champ lisible + boutons Rechercher / Fermer (2026-08-30)

Retour utilisateur : dans la modale de recherche globale (loupe de la barre du haut,
`src/components/GlobalSearch.jsx`), le champ de saisie était mal rendu (forme/couleur) et
il manquait un bouton pour valider et un bouton pour fermer.

- **Lisibilité du champ** : le panneau de la modale force désormais `colorScheme: 'light'`
  et l'`<input>` a un `background`/`color` explicites + une classe `.global-search-input`
  (App.css) pour la couleur du placeholder — sans ça, la règle `color-scheme: light dark`
  de `index.css` rendait le champ natif illisible sous un thème OS sombre (même gotcha que
  celui déjà documenté pour les lignes de résultats).
- **Bouton « Rechercher »** : l'input est maintenant dans un `<form onSubmit>` avec un
  bouton vert qui déclenche la recherche **immédiatement** (annule la temporisation de
  250 ms). Extraction d'un `runSearch(q)` partagé entre la frappe temporisée et le submit,
  avec un compteur de requête pour qu'une réponse lente n'écrase pas une plus récente.
- **Bouton « Fermer »** : vrai bouton ✕ (`title="Fermer (Échap)"`) dans l'en-tête, en
  plus du clic sur le fond et de la touche Échap qui ferment toujours.
- **Tests** (`GlobalSearch.test.jsx`) : bouton Fermer → `onClose` ; submit → appel
  `rechercheGlobale` immédiat (sans `waitFor`).

Vérifs : `vite build` OK, front `npm test` 88/88, conteneur frontend reconstruit
(bundle contient bien les nouveaux éléments).
### ERP Comptabilité — Étape 0 : validité devis, suppression Annulé, conditions de paiement (2026-08-30)

Début de la roadmap « Comptabilité » (réplication du modèle `sale`/`account` d'un ERP de
référence, mêmes rails que `project_erp_full_architecture_alignment` : design → répétition
contre une copie restaurée → confirmation → exécution → vérif, une étape à la fois).
Étapes 1-6 (taxes, journaux/plan comptable, `account.move` factures, immuabilité, avoirs,
paiements/rapprochement) auront chacune leur propre passe.

- **`devis.validity_date`** (`ALTER TABLE` + backfill `date + 30 j`) + booléen calculé
  `expired` dans `DEVIS_COLUMNS` (`statut IN (Brouillon/Devis/Envoyé) AND validity_date <
  CURRENT_DATE`, non stocké — comme `is_expired`). `POST /devis` défaut = +30 j, `PUT`
  modifiable en Brouillon/Devis. Front : champ « Valable jusqu'au » (formulaire + panneau
  méta du détail) + badge rouge « Expiré » dans la liste.
- **Suppression d'un devis Annulé** autorisée (`DELETE /:id` : `Brouillon`/`Devis`/`Annulé`
  — aligné sur « draft or cancel »).
- **`payment_terms` + `payment_term_lines`** (`account.payment.term`-like : `value`
  percent/fixed/balance, `delay_type` days_after / days_after_end_of_month, `nb_days`).
  Route `/api/payment-terms` (GET ouvert, POST/PUT/DELETE `requireRole('admin','directeur')`).
  Jeu par défaut seedé à `register` **et** par `migrate.js:seedPaymentTermsForExistingEntreprises`
  (« Paiement immédiat », « 30 jours », « Fin de mois suivant », « 30 % à la commande, solde
  à 30 j »).
- **`POST /devis/:id/facturer`** accepte `paymentTermId` (+ `acompte` `{method, value}`
  optionnel) → génère les `echeances_paiement` depuis le terme (`genererEcheancesDepuisTerme`)
  au lieu de la saisie manuelle, qui reste en repli. Terme « paiement immédiat » (1 échéance
  due aujourd'hui, sans acompte) → traité comme paiement complet (échéance déjà réglée +
  synchro finances). `devis.payment_term_id` (FK `ON DELETE SET NULL`), remis à NULL par
  `remettre-brouillon`.
- Front : `PaymentTermsPanel` (référentiel repliable, patron `RhReferentiels`) dans
  `DevisModule` ; sélecteur « Condition de paiement » + acompte dans la modale de
  facturation. i18n fr + en.
- **Bugs corrigés en passant** : double `client.release()` sur les retours anticipés de
  `facturer` (`pg-pool` `throwOnDoubleRelease` — latent, jamais déclenché par un test
  avant) ; `validity_date` / `date_echeance` renvoyés via `to_char(…, 'YYYY-MM-DD')` pour
  éviter le décalage d'un jour DATE Postgres → objet Date JS → `.toISOString()`.
  `test:integration` passe en `--forceExit` (un handle keep-alive résiduel bloquait la
  sortie de jest).

Répétition migration : `pg_dump` de `agri_app` → restauration jetable → `migrate.js` ×2
(idempotent, aucune erreur au 2ᵉ passage) → compteurs inchangés (9 entreprises / 9 devis /
14 échéances), `payment_terms` = 9×4, `payment_term_lines` = 9×5, tous les devis avec
`validity_date`. Puis appliquée à `agri_app`.

Vérifs : `vite build` OK, front `npm test` 88/88, `test:integration` 94/94, back `npm test`
vert, smoke HTTP réel (devis validityDate +30 j / expired ; facturer terme 30 j + acompte
25 % → échéances 2500 aujourd'hui + 7500 à J+30). Conteneurs backend + frontend reconstruits.

### ERP Comptabilité — Étape 1 : `account.tax` (taxes réutilisables) (2026-08-30)

Remplace le `%` brut par ligne (`devis_lignes.taux_taxe`) par de vraies taxes réutilisables
calquées sur `account.tax` d'un ERP de référence.

- **`migrate.js`** : `devis_lignes.taux_taxe` retirée ;
  `migrateTaxeDevisLignesVersAccountTax()` convertit chaque `(entreprise, taux>0)` en
  `account_tax` percent + liens, puis `DROP COLUMN` (0 ligne réelle en prod → no-op). Grep
  complet fait contre une résurrection par `ADD COLUMN IF NOT EXISTS`.
- **`account_tax`** (noms de champs Odoo : `type_tax_use`, `amount_type`, `amount`,
  `price_include`, `include_base_amount`, `active`, `sequence`, `invoice_label`,
  `UNIQUE(entreprise_id, name)`) + **`devis_lignes_taxes`** (jointure Many2many, comme
  `sale.order.line.tax_id`).
- Calcul : `percent`, `fixed` (à l'unité), `price_include` (extraction),
  `include_base_amount` (cascade) ; `group`/`division` = 0 (repoussé à l'étape 3). Calcul
  unique partagé dans **`utils/taxeCompute.js:appliquerTaxesLigne`**, utilisé par
  `routes/devis.js` (`calculerTotal`) **et** `utils/devisPdf.js` (récap HT / par taxe / TTC
  + colonne « Taxes »).
- Routes `/api/taxes` : GET ouvert, `POST/PUT/DELETE` gated `admin`/`directeur`.
  `devis.js` `POST`/`PUT` acceptent `lignes[].taxIds` (id étranger ignoré en silence via
  `filtrerTaxIds`). `getDevisComplet` agrège `taxIds` par ligne + renvoie le référentiel
  `taxes`.
- Front : input `%` par ligne → `TaxSelect` (menu de cases à cocher) ; `TaxesPanel`
  (référentiel repliable) ; recalcul client `taxesLigneCalc`. i18n `taxes.*` fr/en.

Migration répétée ×2 sur copie restaurée d'`agri_app` (idempotente, totaux devis
inchangés). `taxes.test.js` → tests d'intégration verts ; front 88/88.

### ERP Comptabilité — Étape 2 : journaux + plan de comptes + séquences (2026-08-30)

Objets de configuration uniquement : **aucun `account.move`, aucune écriture au grand
livre, aucun changement du calcul devis/factures ni de `finances`**. Socle pour l'étape 3.

- **`account_account`** : `code`, `name`, `account_type` (19 valeurs, CHECK), `reconcile`,
  `active`, `UNIQUE(entreprise_id, code)`.
- **`account_journal`** : `name`, `code` (≤5), `type` (sale/purchase/cash/bank/general),
  `sequence`, `refund_sequence`, `default_account_id` (FK `ON DELETE SET NULL`),
  `UNIQUE(entreprise_id, code)`.
- **`account_journal_sequence`** : compteur `(journal_id, prefix, last_number)`.
- Seed (**`utils/comptaDefauts.js`**, importé par `auth.js` à l'inscription +
  `migrate.js:seedComptaConfigForExistingEntreprises` rétroactivement) : plan générique
  (codes `121000`/`211000`/`101401`/`101402`/`400000`/`500000`/`251000`/`131000` — **pas un
  PCG national, portée mondiale**) + journaux `INV`/`BILL`/`BNK`/`CSH`/`MISC` reliés à leur
  compte par défaut.
- **`utils/journalSequence.js:prochainNumeroJournal`** → `CODE/AAAA/NNNN` (`RCODE/…` pour
  un avoir si `refund_sequence`). Année dans le préfixe ⇒ remise à zéro annuelle. Increment
  sous verrou de ligne dans la transaction de l'appelant. Aucun appelant à ce stade —
  l'étape 3 le branchera.
- Routes `/api/journals` + `/api/accounts` : GET ouvert, `POST/PUT/DELETE` gated
  `admin`/`directeur`. `journals.js` valide que `defaultAccountId` appartient à
  l'entreprise → 400 sinon.
- Front : `ComptaConfigPanel` (repliable, dans `DevisModule`) — journaux + comptes,
  ajout/suppression. i18n `comptaConfig.*` fr/en.

Migration ×2 sur copie restaurée (idempotente ; 9×8 comptes + 9×5 journaux seedés ; totaux
inchangés). `journals.test.js` + `accounts.test.js` → 120 tests d'intégration / 21 fichiers.

### ERP Comptabilité — Étape 3 : `account.move` + `account.move.line` (double-partie) (2026-08-30)

Décision prise avec l'utilisateur : **double-partie complète** (écriture équilibrée + moteur
de lettrage). `account.move` **autonome cette étape** — `POST /devis/:id/facturer` INCHANGÉ
(rebranché à l'étape 3b).

- Tables (noms de champs calqués Odoo) : **`account_move`** (`move_type`, `state`
  draft/posted/cancel, `name` NULL→`INV/2026/0001` au post, montants HT/taxe/TTC/résiduel,
  `payment_state`, `reversed_entry_id` pour l'étape 5 ; index unique partiel
  `(journal_id, name)` WHERE name IS NOT NULL) ; **`account_move_line`** (`display_type`
  product/tax/payment_term/…, `debit`/`credit`/`balance`/`account_id`,
  `amount_residual`/`reconciled`/`full_reconcile_id`/`matching_number`, `date_maturity`) ;
  **`account_move_line_taxes`** (M2M), **`account_full_reconcile`**,
  **`account_partial_reconcile`**, **`account_payment`** (délègue à sa propre move).
- `echeances_paiement` : `+move_id`, `devis_id` passe nullable. **FK `partner_id` →
  `contacts` posées par un `DO $$` après la création de `contacts`** (les tables `account_*`
  précèdent `contacts` dans le template SQL unique — même contrainte que `devis.client_id` ;
  base fraîche 500 tant que non corrigé, repéré par le `globalSetup` d'intégration).
- Post : créance D=total / produit C=HT par ligne / lignes de taxe C=taxe, assertion
  Σd=Σc, `name` via `prochainNumeroJournal`, `out_refund` signes inversés + préfixe `RINV`.
- `register-payment` : `account_payment` + son écriture (trésorerie D ↔ créance C) +
  `account_partial_reconcile` contre la ligne créance ; au solde total →
  `account_full_reconcile` + `matching_number` ; maj `amount_residual`/`payment_state`,
  échéances couvertes marquées, miroir `finances` via `syncFacturePaiement`
  (`source_module='Facture'`).
- Routes `/api/factures` : GET liste + `:id`, `POST`/`PUT` (brouillon seul),
  `:id/post` / `:id/button-draft` / `:id/cancel` / `:id/register-payment`
  (`admin`/`directeur`), `DELETE` (brouillon/annulé seul).
- Front : **`src/components/FacturesModule.jsx`** (liste + brouillon avec `TaxSelect` +
  modal détail lignes compta / échéances / paiements + actions), onglet nav « Factures »
  (permission `finances`). `taxesLigneCalc` extrait vers **`src/lib/taxes.js`** (partagé avec
  `DevisModule`). i18n `factures.*` fr/en.

Migration ×2 sur copie restaurée (idempotente). Smoke live : brouillon → post
`INV/2026/0001` (D=C=11800) → paiement → paid, résiduel 0, matching `A00001`, entrée
`finances` Banque 11800. `factures.test.js` (10) → 130 tests d'intégration / 22 fichiers.

### ERP Comptabilité — Étape 3b : `POST /devis/:id/facturer` produit une facture (2026-08-30)

`facturer` **crée et poste** désormais un `account_move` (`out_invoice`) reflet du devis.
`devis.move_id` (nouvelle colonne nullable) pointe vers la facture ;
`account_move.invoice_origin` = numéro du devis ; échéances rattachées aux deux
(`devis_id` + `move_id`). Le devis garde son `statut`/flux d'échéances comme **miroir
commercial**.

- Refacto : **`server/src/utils/accountMove.js`** extrait de `routes/factures.js` —
  `posterMove(client, moveId, entrepriseId)` (écriture équilibrée + numéro) et
  `enregistrerPaiementMove(client, {…, skipFinanceMirror, skipEcheanceAllocation})`
  (paiement + lettrage) ; `factures.js` `/post` et `/register-payment` deviennent des
  enveloppes minces (comportement inchangé).
- `facturer` complet → `enregistrerPaiementMove(skipFinanceMirror)` : le move se solde
  (paid + lettrage), `syncDevisPaiement` reste la **seule** entrée `finances`
  (`source_module='Devis'`).
- `POST /devis/:id/echeances/:eid/payer` devient transactionnel et, si `devis.move_id`,
  appelle `enregistrerPaiementMove(skipFinanceMirror, skipEcheanceAllocation)` pour que
  `payment_state`/`amount_residual`/lettrage du move suivent (l'échéance précise est déjà
  marquée par la route devis, sinon débordement sur la suivante).
- `POST /devis/:id/remettre-brouillon` défait aussi la facture : supprime écritures de
  paiement lettrées + `account_payment` + entrées `finances` `'Facture'`, supprime le move
  (cascades), purge `full_reconcile` orphelins, remet `move_id` NULL. Numéro de journal non
  restitué (trou accepté pour cet undo pré-prod).
- `getDevisComplet` renvoie `move: {id,name,state,paymentState,amountResidual,amountTotal}
  | null`. Front : bouton intelligent « Facture INV/… · <état paiement> » dans le modal
  devis → onglet Factures (`devis.voirFacture` i18n).

Migration ×2 sur copie restaurée. Smoke live : devis signé → facturer complet →
`INV/2026/0001` posté/paid, écriture D=C=1000, `invoice_origin=DEV-2026-0001` →
`remettre-brouillon` → move supprimé (404). `devis.test.js` +3 → 133 tests / 22 fichiers.

### ERP Comptabilité — Étape 4 : inaltérabilité des factures postées (2026-08-30)

**Opt-in par journal** (`account_journal.restrict_mode_hash_table`, désactivé par défaut →
le flux pré-prod `remettre-brouillon` reste utilisable tant qu'une entreprise ne l'active
pas).

- Schéma : `account_journal.restrict_mode_hash_table BOOL` + `.secure_sequence_last INT`
  (compteur sans trou, verrou de ligne au post) ; `account_move.inalterable_hash TEXT` +
  `.secure_sequence_number INT`.
- **`utils/accountMove.js`** : `chaineIntegriteMove`
  (`name|date|journal_id|amount_total|partner_id` puis chaque ligne
  `account_id|debit|credit|balance` triée par id) ; `hacherMoveSiRequis` (si journal
  sécurisé : `secure_sequence_number = last+1` FOR UPDATE + `inalterable_hash =
  sha256(prevHash + chaine)` chaîné à l'écriture sécurisée précédente du journal ; appelé
  par `posterMove` et après l'écriture de paiement) ; `verifierChaineJournal` (re-parcourt,
  recalcule chaque hash, vérifie l'absence de trou → `{ok,count}` |
  `{ok:false,brokenAt,reason:'hash'|'gap'}`).
- Garde-fous : `button-draft` / `DELETE` facture / `devis remettre-brouillon` → 400 si le
  move est haché (message : « créez un avoir », étape 5). `GET /api/factures/verify-hash
  ?journalId=` (`admin`/`directeur`, déclarée avant `/:id`). `journals` `PUT`/`POST`
  acceptent `restrictModeHashTable` **seulement pour l'ACTIVER** (`=== true`) ; un `false`
  partiel est ignoré. Corrigé au passage : 2 `double-client.release()` sur les retours
  anticipés de `remettre-brouillon`.
- Front : `ComptaConfigPanel` bouton verrou par journal (confirmation, irréversible) ;
  `FacturesModule` modal détail — puce « Sécurisée » + bouton « Vérifier l'intégrité ».
  i18n.

Migration ×2 sur copie restaurée. Smoke live : journal `INV` sécurisé, 2 factures →
`secure_sequence_number` 1 puis 2, hashs distincts et chaînés, `button-draft` → 400,
`verify-hash` → `{ok:true,count:2}`. `factureHash.test.js` (5) → 138 tests / 23 fichiers.

### ERP Comptabilité — Étape 5 : avoirs (`out_refund` + reverse) (2026-08-30)

Aucun changement de schéma (`reversed_entry_id` / `out_refund` / séquence `RINV` existent
depuis l'étape 3).

- Refacto : **`lettrerLignesPartenaire(client, entrepriseId, {ligneFactureId, ligneContreId,
  amount, date})`** extrait d'`enregistrerPaiementMove` — le
  `account_partial_reconcile` + `account_full_reconcile` + `matching_number` au solde,
  **sign-aware sur les DEUX lignes**. Partagé par le paiement et le reverse.
- **`reverseMove(client, {moveId, entrepriseId, userId, reason, date, refundMethod})`** :
  l'origine doit être une facture postée (`out_invoice`/`in_invoice`) ; crée un
  `account_move` `out_refund`/`in_refund` (`reversed_entry_id` = origine, `ref` = « Annulation
  de : <name> — <reason> », `invoice_origin`), copie lignes produit/section + liens de taxes.
  `refundMethod:'refund'` (défaut) → avoir en **brouillon** ; `refundMethod:'cancel'` →
  `posterMove` (écriture inversée + numéro `RINV/…` + hash si journal sécurisé) puis
  lettrage contre la créance d'origine → origine `payment_state='reversed'` +
  `amount_residual=0`.
- Route `POST /api/factures/:id/reverse` (`admin`/`directeur`). Garde-fous :
  `enregistrerPaiementMove` → 400 si origine `reversed` ; `POST /devis/:id/remettre-brouillon`
  → 400 si la facture liée a des avoirs. `getFactureComplete` renvoie `reversedEntryName` +
  `reversalMoveNames`.
- Front : `FacturesModule` modal détail — bouton « Créer un avoir » sur une `out_invoice`
  postée → formulaire inline (motif + méthode), ouvre l'avoir créé ; en-tête « Avoir de :
  … » / « Annulée par : … ». i18n.

`factureAvoir.test.js` (7) → 144 tests d'intégration / 24 fichiers.

### ERP Comptabilité — Étape 6 : balance âgée, relances, paiements autonomes (2026-08-30) — ROADMAP COMPLÈTE

- Schéma : `account_move.relance_niveau INT DEFAULT 0` + `.derniere_relance DATE` (suivi
  des relances — **pas d'envoi email, SMTP différé**).
- **`utils/accountMove.js`** : `creerPaiementAutonome(client, {…, partnerId, amount,
  paymentDate, journalId, ref, sens})` — `account_payment` + son écriture postée
  (trésorerie D / créance C) **sans lettrage** → crédit non alloué sur le compte client
  (haché si le journal de trésorerie est sécurisé) ; `allouerPaiement(client, {paymentId,
  moveId, amount, entrepriseId})` — lettre une tranche via `lettrerLignesPartenaire`, bornée
  à `min(demandé, non-alloué, résiduel facture)`, maj `payment_state` ; partenaire différent
  → 400.
- Routes : `GET /api/factures/aged-receivable?date=` (par partenaire, reste dû des
  `out_invoice`/`out_refund` postés ventilé *non échu / 1-30 / 31-60 / 61-90 / 90+* vs
  `invoice_date_due`, `reversed` exclues, `out_refund` négatif, + totaux) ;
  `GET /api/factures/overdue` (`out_invoice` postées `not_paid`/`partial` échues, avec
  `daysOverdue`/`relanceNiveau`/`derniereRelance`) ; `POST /api/factures/:id/mark-reminded`
  (`admin`/`directeur`) ; nouveau **`routes/paiements.js`** (`/api/paiements`) : `GET
  ?partnerId=&unallocated=1`, `POST`, `POST :id/allocate` (`admin`/`directeur`).
  `aged-receivable` / `overdue` déclarées avant `/:id`.
- Coupe assumée : `payment_state='in_payment'` non utilisé (pas d'import de relevé bancaire
  dans YEELEN).
- Front : **`src/components/ComptaReportsPanel.jsx`** (sections repliables : balance âgée
  partenaire × tranche ; retards + « Marquer relancé » ; paiement autonome + non-alloués +
  « Affecter » inline), rendu au-dessus de `FacturesModule`. i18n `comptaReports.*`.

Migration ×2 sur copie restaurée. Smoke live : facture échue −40 j → tranche 31-60 = 1000 ;
overdue niveau 0 → mark-reminded → niveau 1 + date ; paiement autonome `BNK/2026/0001` non
alloué = 600 → allocate contre la facture → lettré 600, résiduel 400, partial.
`agedReceivable.test.js` (5) + `paiements.test.js` (7) → **154 tests d'intégration / 26
fichiers**.

### ERP Comptabilité — passe d'alignement UI sur Odoo (frontend seul) (2026-08-30)

Sur demande utilisateur (« respecter la même interface qu'Odoo : forme, taille des colonnes
et des lignes, leur emplacement »). **Aucun changement backend / schéma / test.**

- `FacturesModule` : liste aux colonnes dans l'ordre du tree `account.move`
  (`Numéro | Client | Date de facture | Échéance | Total HT | Total TTC | État paiement |
  État`), échéance annotée façon widget `remaining_days`. Modal détail refait sur le
  squelette de la fiche `account.move` : `MoveStatusBar` en chevrons, barre d'actions dans
  l'ordre Odoo, en-tête deux colonnes en `.field-group`, onglets notebook « Lignes de
  facture » / « Écritures comptables », bloc totaux bas-droite façon `oe_subtotal_footer`.
- `ComptaReportsPanel` / `ComptaConfigPanel` / `TaxesPanel` / `PaymentTermsPanel` : listes
  `<div>` → `.data-table` avec les colonnes des rapports Odoo. `TaxSelect` → puces
  arrondies avec `×` façon `many2many_tags`. Tableaux de lignes du devis : colonne « Taxes »
  déplacée après « Remise » (ordre de la ligne Sale Order). i18n fr/en complétée.

`vite build` + 88 tests verts. Conteneur frontend reconstruit.

### ERP Comptabilité — fiche facture aux vraies valeurs SCSS d'Odoo (frontend seul) (2026-08-30)

Sur demande utilisateur (« pars des vraies valeurs SCSS d'Odoo pour la fiche facture »). Les
dimensions sont **extraites du SCSS source du clone `erp-source`**
(`addons/web/static/src/…`), pas estimées, et documentées valeur par valeur dans
`src/App.css` (bloc `.oe-invoice`).

- Repris tel quel : base 14px / lh 1.5, `gray-300` `#dee2e6`, `gray-100` `#f8f9fa`, texte
  `#212529`, `brand-primary` `#71639e` ; statusbar caret `1em`, chevron inactif `#dee2e6` /
  texte `#212529`, **actif = `mix(#71639e,#f8f9fa,20%)` = `#dddbe8` + bord latéral
  `#71639e`, texte reste `#212529`** (la version précédente mettait un fond vert plein +
  texte blanc, faux) ; `o_inner_group` grid `fit-content(150px) minmax(0,1fr)` gap
  `8px 16px` ; `oe_subtotal_footer` grid `1fr auto` `margin-left auto` `border-top 1px`,
  total `border-top 1px` weight 700 `font-size 1.3em` ; cellules liste `8px / 4.8px`
  (16px aux bords) `border-collapse collapse` ; notebook `nav-tabs` onglet actif bord bas
  blanc.
- Modal `FacturesModule` réécrit en `.oe-group` / `.oe-list` / `.oe-subtotal` /
  `.oe-notebook` / `.oe-statusbar`. Portée limitée à `.oe-invoice` pour ne pas toucher le
  `.data-table` app-wide.

`vite build` + 88 tests verts ; conteneur reconstruit.

### Devis — édition des lignes autorisée après signature (modèle Odoo) (2026-08-31)

Un devis **Signé mais pas encore Facturé** reste éditable (ajout/retrait d'articles), comme
une commande confirmée dans Odoo. Le stock réservé à la signature est réajusté après coup
(reverse ancien jeu + apply nouveau). Dès « Facturé », les lignes restent verrouillées
(écriture comptable postée).

- `PUT /devis/:id` : garde étendue à `{Brouillon, Devis, Signé}` ; réconciliation stock
  pour un devis Signé dont les lignes changent.
- Front : bouton « Modifier les lignes » + icône liste actifs sur Signé ; bandeau
  d'avertissement dans l'éditeur ; i18n fr/en.
- 3 tests d'intégration (ajout d'article → total recalculé + statut inchangé ;
  réajustement du stock catalogué ; `PUT` refusé si Facturé).

Vérifié au navigateur : bouton présent sur Signé / absent sur Facturé, édition OK, devis
reste Signé, total 6000 → 7500, 2 lignes persistées.

### Comptabilité — correctifs de la passe E2E : liste factures + totaux de l'avoir brouillon (2026-08-31)

Deux correctifs issus d'une passe E2E navigateur :

1. **`GET /api/factures`** ne renvoie plus les `account_move` de type `entry` (contreparties
   de paiement `account_payment`) quand aucun `?moveType=` n'est passé — elles apparaissaient
   dans la liste « Factures » avec un chip d'état de paiement trompeur. Le filtre explicite
   `?moveType=` reste opérant.
2. **`reverseMove`** (méthode `refund` / brouillon d'avoir) calcule désormais
   `price_subtotal`/`price_total` par ligne et `amount_untaxed`/`tax`/`total`/`residual` sur
   le move dès la création, au lieu de laisser `0,00` affiché partout jusqu'au post
   (`posterMove` les recalcule de toute façon). Comportement aligné sur Odoo.

`+1` test (liste exclut `entry`) ; `factureAvoir.test.js` « refund » vérifie maintenant les
totaux du brouillon. 158 tests d'intégration verts.

### Comptabilité — affectation d'un avoir posté + date d'échéance du paiement complet (2026-09-01)

Deux correctifs issus de la passe E2E (obs. #3 et #4) :

- **#3** — Un avoir posté via la méthode `refund` (avec un résiduel) restait bloqué en
  négatif sur la balance âgée sans moyen UI de l'imputer. Ajouté :
  `utils/accountMove.js:allouerAvoir()` (lettre la ligne `payment_term` de l'avoir contre
  celle d'une facture ouverte du même partenaire — mêmes garde-fous qu'`allouerPaiement`) ;
  `GET /api/factures/credit-notes-unallocated` (avant `/:id`) + `POST
  /api/factures/:id/allocate-credit` (`admin`/`directeur`) ; section « Avoirs à affecter »
  dans `ComptaReportsPanel`, même picker inline « Affecter » que les paiements autonomes.
- **#4** — `POST /devis/:id/facturer`, chemin « complet » : `invoice_date_due` du move était
  figé à J+30 alors que l'échéance créée est du jour (statut « Payé »). Aligné sur
  aujourd'hui.

`+4` tests d'intégration + `devis.test.js` (`invoice_date_due` = aujourd'hui pour le
paiement complet). 162 tests d'intégration + 88 front verts. Vérifié au navigateur.

### Stock — Étape A : typologie des intrants + fiche enrichie par type (2026-09-01)

Élargissement de la gestion de stock (semences/engrais/phyto). Modèle de champs adapté de
**LiteFarm** (`product` / `soil_amendment_product` : enum de type, NPK + unité, dose, liste
substances bio) + champs propres au **registre des traitements phytosanitaires FR** (n° AMM,
DAR = délai avant récolte, ZNT) qu'aucun projet OSS ne modélise.

- **`migrate.js`** : `produits.type_intrant` (CHECK 6 valeurs) + champs à plat semence
  (`variete`, `taux_germination`), engrais (`npk_n/p/k`, `npk_unit`, `dose_ha`,
  `dose_ha_unite`), phyto (`matiere_active`, `numero_amm`, `dar_jours`, `znt_metres`),
  `bio_autorise`. 3 CHECK sur NPK (unité valide ; cohérence tout-ou-rien ; somme ≤ 100 si
  percent). Backfill `type_intrant` depuis le nom de catégorie (idempotent).
- **`routes/produits.js`** : `champsIntrant()` normalise + valide ; `POST`/`PUT`/`GET`
  étendus, `GET ?typeIntrant=` pour filtrer ; `PRODUIT_COLUMNS` renvoie les 14 champs.
- **`App.jsx` `StocksTab`** : composant `IntrantChamps` partagé add/edit (select type + bloc
  de champs conditionnel), rangée de filtres par type au-dessus du tableau, colonne « Type
  d'intrant » + « DAR n j » + pastille bio. i18n fr/en.
- `produits.test.js` : 9 tests (création par type, validations 400, ratio autorisé > 100,
  `PUT` + filtre `GET`, isolation multi-tenant).

171 tests d'intégration / 27 fichiers + 88 front verts. Vérifié au navigateur.

### Stock — Étape B : suivi de lot + péremption (2026-09-01)

- **`migrate.js`** : table **`stock_lots`** (`produit_id`, `numero_lot`, `date_entree`,
  `date_peremption`, `quantite_initiale/restante`, `cout_unitaire`, `achat_id?`, `notes`) +
  3 index. **Registre parallèle** : ne touche pas `produits.quantite` (qui reste la source
  de vérité du stock global).
- **`routes/produits.js`** : `GET /:id/lots`, `POST /:id/lots` (`numeroLot` requis),
  `PUT /lots/:lotId`, `DELETE /lots/:lotId` (404 sur 0 ligne), `GET /lots-perimes?jours=30`
  (lots avec péremption ≤ J+jours et reste > 0). `LOT_COLUMNS` `to_char` sur les dates.
- **`App.jsx` `StocksTab`** : bouton Package par ligne → sous-ligne dépliable (liste lots +
  mini-formulaire d'ajout), édition inline de la quantité restante (`onBlur`), surlignage
  rouge d'un lot périmant (≤ 30 j), bannière d'alerte au-dessus du tableau. i18n fr/en.
- `produits.test.js` `+6` tests (création lot, 400/404, ne modifie pas `produits.quantite`,
  `PUT` restante + `DELETE` 404, `lots-perimes` filtre, isolation multi-tenant).

177 tests d'intégration / 27 fichiers + 88 front verts. Vérifié au navigateur.

### Stock — Étape C : registre des traitements phytosanitaires (2026-09-01)

Journal **réglementaire** (obligation FR/UE) des applications d'engrais et de produits
phytosanitaires au champ.

- **`migrate.js`** : table **`applications_intrants`** (`parcelle_id`, `produit_id`,
  `lot_id?`, `date_application`, `dose` + `unite`, `surface_traitee_ha`,
  `quantite_utilisee`, `operateur`, `cible`, `dar_calcule`, `znt_respectee`, `notes`). FK
  `ON DELETE SET NULL` + **noms dénormalisés** : l'entrée survit à la suppression d'une
  parcelle/produit (pièce réglementaire).
- **`stockSync.js`** : `consommerProduit` / `restituerProduit` (décrément/restaure un seul
  produit catalogue).
- **`routes/applicationsIntrants.js`** (nouveau, `/api/applications-intrants`) : `GET`
  liste, `POST` (valide appartenance parcelle/produit/lot → `null` sinon ; `dar_calcule` =
  date + `produit.dar_jours` figé à la saisie, calcul en UTC ; décrémente le stock si
  `quantite_utilisee`), `PUT` métadonnées (recalcule le DAR, ne touche pas le stock),
  `DELETE` (restitue le stock, 404 sur 0 ligne).
- **`src/components/RegistreIntrantsView.jsx`** (nouveau) + onglet « Registre » dans
  `CulturesModule` : formulaire (parcelle, produit filtré aux types engrais/phyto, dose,
  surface, quantité prélevée, opérateur, cible, ZNT, notes) + tableau + bannière « récolte
  déconseillée avant le <DAR> » par parcelle. i18n fr/en.
- `applicationsIntrants.test.js` (5 tests) : DAR calculé + stock décrémenté, parcelle/produit
  d'une autre entreprise → `null`, `DELETE` restitue le stock + 404, `PUT` recalcule le DAR
  sans toucher le stock, isolation.

**182 tests d'intégration / 28 fichiers** + 88 front + build verts. Vérifié au navigateur.

### Passe de récupération : stack Docker périmée + vérif navigateur Stock A/B/C (2026-09-01)

Après plusieurs `git pull` successifs (récupération des étapes Comptabilité 1-6 et Stock
A/B/C faites dans d'autres sessions), constat : **les conteneurs Docker tournaient encore
sur des images du 2026-08-22** et la base n'avait jamais reçu les nouvelles migrations —
toutes les routes compta/intrants répondaient 404, aucune des nouvelles tables n'existait.

- Correctif : `docker-compose up -d --build` (reconstruction backend + frontend depuis le
  code courant) puis `docker exec … node src/db/migrate.js` — toutes les tables compta +
  intrants créées, plan de comptes / journaux / conditions de paiement seedés pour
  l'entreprise existante.
- Conflit de merge résolu dans `CLAUDE.md` (section « Backend structure », description
  `server.js`/`app.js`) : gardé la description à jour de la factory `app.js` + fusionné les
  nouvelles routes (`taxes`, `journals`, `accounts`, `factures`, `paiements`).
- **Passe de vérification navigateur des 3 étapes Stock** (entreprise jetable créée par
  l'utilisateur, exercée, puis supprimée — nettoyage multi-tables) :
  - **A** — création d'un engrais (NPK 15/15/15 %, dose 200) + d'un phytosanitaire (matière
    active, n° AMM, DAR 14 j, ZNT 5 m) ; champs conditionnels par type, filtres, colonne
    dédiée — tout persisté correctement.
  - **B** — lot `LOT-2026-09-A` (péremption 15/09) : bannière « périmant dans les 30 jours »,
    ligne surlignée rouge, édition inline du restant 20→12 persistée, `produits.quantite`
    inchangé (registre parallèle confirmé).
  - **C** — 2 applications (Parcelle A/engrais, Parcelle B/phyto) : `dar_calcule` = date +
    14 j pour le phyto / `null` pour l'engrais, bannière « récolte déconseillée avant le
    15 sept. 2026 », stock décrémenté (−6 → 34, −3 → 7), noms dénormalisés stockés.
  - Les 3 fonctionnalités marchent bout en bout (UI + API + base). Entreprise de test
    `Test Stock ABC` (`entreprise_id=3`) + user `test-abc@yeelen.test` entièrement supprimés
    ensuite (17 `DELETE` en une transaction, tables non-cascade incluses).

### Catalogue produit — alignement Odoo, étape 0 : hiérarchie des catégories (2026-09-03)

Début d'un plan en 5 étapes (validé en mode plan) qui recale le modèle produit/stock « à
plat » sur la structure d'Odoo (`product.template` / `product.product` / `uom` /
`stock.quant` / `product.pricelist`). **Principe** : à chaque étape, une « colonne pont »
garde les anciens lecteurs fonctionnels — rien ne casse.

- `produit_categories.parent_id` (auto-référence, `ON DELETE CASCADE` comme
  `product.category`). Cloisonnement par module conservé et **validé côté route** (parent et
  enfant doivent partager le même module). Garde anti-cycle.
- `complete_name` (chemin complet « Engrais / Azotés / Urée ») **calculé par CTE récursive à
  la lecture**, pas stocké.
- Front : sélecteur de catégorie parente dans `StocksTab` ; les listes déroulantes affichent
  le chemin complet au lieu du seul nom.

Migration rejouée sur une copie de sauvegarde restaurée avant application réelle (idempotence
confirmée par un 2ᵉ passage). +12 tests d'intégration (cycle, cloisonnement module, cascade,
isolation) → **194/194**. Vérifié au navigateur sur entreprise jetable, données nettoyées.

### Catalogue produit — Odoo étape 1 : unités de mesure + conversion de facteur (2026-09-03)

- Nouvelles tables **`unites_mesure_categories`** / **`unites_mesure`** (`facteur` = ratio
  vers l'unité de référence de sa catégorie), seedées à l'inscription **et**
  rétroactivement pour les entreprises existantes.
- `produits.unite_id` (FK ; `unite` TEXT gardée comme **pont** synchronisé),
  `achats_lignes.uom_id` / `devis_lignes.uom_id` optionnels.
- **`stockSync.js`** convertit la quantité d'une ligne vers l'unité de base du produit quand
  les deux unités partagent la même catégorie ; sinon applique le delta brut.
- Front : `StocksTab` → select référentiel au lieu du texte libre. Devis/Achat propagent
  l'`uomId` du produit catalogue **sans** sélecteur par ligne (périmètre minimal).

CRUD complet + 13 tests d'intégration → **207/207**. Migration rejouée sur copie de
sauvegarde puis appliquée ; vérifié au navigateur (entreprise jetable), nettoyé.

### Catalogue produit — Odoo étape 2 : gabarits / variantes / attributs (2026-09-03)

- Nouvelles tables **`produit_templates`**, **`attributs_produit`** (`_valeurs`),
  `gabarit_attributs_lignes`, `variante_attributs_valeurs`.
- **`produits.template_id`** (FK cascade) : un produit n'existe **jamais** sans gabarit — le
  formulaire « ajout rapide » existant crée désormais en silence un gabarit implicite à
  variante unique.
- Génération de variantes par **produit cartésien** (mode `always`), **strictement
  additive** : une variante existante n'est jamais recréée ni supprimée.
- Front : nouveau panneau `StocksTab` (`ProduitTemplatesPanel.jsx`) pour gérer
  attributs / gabarits / variantes.

CRUD complet + 17 tests d'intégration → **224/224**. Migration rejouée sur copie de
sauvegarde puis appliquée ; vérifié au navigateur (gabarit 2 attributs → 2 variantes
confirmées comme articles réels), nettoyé.

### Catalogue produit — Odoo étape 3 : stock multi-emplacements avec réservation (2026-09-03)

- Nouvelles tables **`emplacements_stock`** (interne / client / fournisseur / perte —
  4 seedés par entreprise), **`stock_quants`** (un seul quant réel par produit,
  l'emplacement interne), **`stock_moves`** (journal structuré : brouillon / confirmé /
  fait / annulé).
- `stock_mouvements` (l'ancien) **conservé tel quel en parallèle**.
- **`stockSync.js` réécrit en interne mais garde ses 6 signatures exportées à l'identique** —
  aucun appelant à changer, **aucun changement frontend**.
- **`produits.quantite`** (colonne pont) devient le vrai disponible = `quantité −
  quantité_réservée`, à valeur visible **strictement identique** qu'avant (un devis signé
  décrémentait déjà `quantite` immédiatement ; désormais soutenu par une vraie réservation
  structurée).
- Backfill rétroactif : quant initial par produit + réservations en cours reconstituées
  depuis les devis déjà signés/facturés.

+8 tests d'intégration → **232/232**. Migration rejouée sur copie de sauvegarde (vérifie
qu'un run rattrape plusieurs étapes de retard) puis appliquée. Vérifié contre le backend
Docker réel via script autonome + inspection directe des tables.

### Catalogue produit — Odoo étape 4 : moteur de règles de tarification (2026-09-04) — PLAN COMPLET

- **`listes_prix_lignes` devient un vrai moteur de règles** : `applied_on`
  global / catégorie / gabarit / variante, `compute_price` fixe / pourcentage,
  `quantite_min`, fenêtre de dates. L'ancien `UNIQUE (liste, article)` est **retiré** →
  plusieurs règles par paliers de quantité possibles.
- Nouveau **`pricelistResolver.js`** : résolution par **spécificité décroissante puis palier
  décroissant** — même logique que `_get_product_price` d'Odoo.
- Nouvelle route **`GET /listes-prix/prix-effectif`** : le prix dans `DevisModule` est
  maintenant calculé **côté serveur** à la sélection de l'article (remplace le calcul 100 %
  client `prixPourMatch`).
- Front : `ListesPrixManager` étendu — sélecteur cible/mode + options avancées.

4 tests existants adaptés au nouveau contrat + 6 nouveaux → **238/238**. Migration rejouée
sur copie de sauvegarde puis appliquée. Vérifié au navigateur (règle variante 150 bat règle
globale −15 % sur un article à 200, préfill correct en conditions réelles), nettoyé.

**Les 5 étapes de l'alignement Odoo produit/stock sont livrées** : catégories hiérarchiques,
unités de mesure + conversion, gabarits/variantes/attributs, stock multi-emplacements avec
réservation, règles de tarification. Compat assurée par les colonnes pont (`unite`,
`quantite`) — à ne pas retirer tant que tous les lecteurs ne sont pas passés au nouveau
modèle.

### Passe de récupération : stack Docker périmée (catalogue Odoo) (2026-09-04)

Même schéma que le 2026-09-01 : après `git pull` des étapes catalogue Odoo 0-4 (faites dans
une autre session), les conteneurs tournaient encore sur des images du 2026-09-01 —
`/api/unites-mesure`, `/api/produit-templates`, `/api/attributs-produit` en 404, tables
absentes. Correctif : `docker-compose up -d --build` + `docker exec … node src/db/migrate.js`
→ `unites_mesure`, `unites_mesure_categories`, `produit_templates`, `stock_quants`,
emplacements de stock par défaut créés/seedés pour l'entreprise existante ; routes repassées
en 401 (auth requise, normal), frontend 200, aucune erreur backend. `docs/deploiement.md`
avait aussi été bien étoffé par une autre session (gardé). Local aligné sur `4bb462e`.

### Abonnement Phase 1 : essai 45 jours + activation manuelle + anti-abus (2026-09-04/05)

Chantier explicitement demandé par l'utilisateur, indépendamment du blocage budgétaire sur
l'hébergement (qui reste différé, voir `project_hosting_budget_blocked`) — le code peut être
livré maintenant, l'activation réelle attendra la veille de mise en production. Spec de
référence : `docs/spec-abonnement-phase1.md` (écrite par une autre session le 2026-09-01,
jamais implémentée avant ce chantier). Exécuté en 5 lots, un commit chacun.

- **Lot 1** (`bc058a9`... schéma+config+hook inscription) — `entreprises.subscription_status
  /trial_ends_at/activated_at/activated_until/grace_until` + CHECK + index, table
  `abonnement_paiements` (placée après `users` : un `CREATE TABLE` ne peut pas référencer une
  table pas encore créée, contrairement à `ALTER TABLE ADD CONSTRAINT`). Backfill grand-père
  (entreprises existantes → `active` + 1 an) puis exemption des entreprises du platform-admin,
  dans cet ordre. `config/abonnement.js` (`TRIAL_DAYS=45`, `GRACE_DAYS=30`). `register`
  journalise `trial_started` et vérifie une limite de 3 inscriptions/24h par IP
  (`countRecentAuditEventsByIp`, même patron que le rate-limit MFA existant).
- **Lot 2** (`66ba1d4` — garde-fou d'accès) — `middleware/subscriptionGuard.js` :
  `evaluerAcces(ent, verb, now)` fonction pure (testée seule, tous les branchements) +
  middleware avec cache 60s/entreprise + `invaliderCacheAbonnement`. Branché globalement dans
  `app.js` juste après `express.json()`, whitelist `/auth`, `/billing/status`, `/health`,
  `/feedback`. `GET /api/billing/status` (nouveau `routes/billing.js`).
- **Lot 3** (`830e493` — administration + reCAPTCHA) — 6 routes `requirePlatformAdmin` sur
  `/api/billing/entreprises*` (liste paginée, détail, activer/prolonger/suspendre/
  réactiver/exempter), chacune journalisée (`audit_log`) et invalidant le cache du guard.
  `utils/recaptcha.js` : reCAPTCHA v3 avec repli gracieux total si `RECAPTCHA_SECRET_KEY`
  absent — inspiré du module Odoo `google_recaptcha` (seul mécanisme anti-abus réellement
  open-source côté Odoo, confirmé par recherche dans le clone source local ; le blocage IP/
  domaines jetables y vit dans leur infra SaaS propriétaire).
- **Lot 4** (`bd11bb5` — frontend) — `lib/api.js` gère le 402 (`CustomEvent
  agri-subscription-blocked`, sans déconnexion, message dédié `suspended`/`expired`) ;
  `lib/recaptcha.js` (même repli gracieux côté frontend). `App.jsx` : bandeau essai
  dismissible + bandeau readonly, overlay plein écran `AbonnementBloque` (choix délibéré :
  `position:fixed` par-dessus tout plutôt que de toucher les nombreux blocs
  `{screen === '...' &&}` de ce fichier de 7700+ lignes), nouveau tab `billing` filtré
  `isPlatformAdmin` (contrairement au tab `feedback`, toujours visible) → nouveau
  `BillingAdminPanel.jsx` (liste paginée/filtrée + modale détail avec formulaires
  activer/prolonger + historique paiements). Build-arg Docker `VITE_RECAPTCHA_SITE_KEY`.
- **Lot 5** (`3ace3be` — tests d'isolation manquants + vérification finale) — complété les 2
  cas du spec §7 pas encore couverts explicitement : 403 sur chacune des 7 routes admin (pas
  seulement 2) pour un rôle `admin` normal, et confirmation qu'un platform-admin voit/gère des
  entreprises **autres que la sienne** (cross-tenant, le seul endroit de l'app où c'est
  voulu). Spec mis à jour avec une section « Ajouts par rapport à ce spec ».

**268 tests d'intégration / 34 fichiers** (26 → 34, dont le nouveau `abonnement.test.js`, 28
tests) + 96 front (88 → 96) + build Vite verts. Migration idempotente confirmée (aucun
changement de schéma depuis le lot 1, rejouée 3× au total sur des sauvegardes restaurées).
Vérifié en réel deux fois (Docker reconstruit + Chrome) : bandeau essai à l'inscription,
absence de script reCAPTCHA sans clé configurée, cycle complet
essai→actif→suspendu→réactivé→exempté via l'API réelle, et — deuxième passage — la liste
`BillingAdminPanel`, sa modale de détail, et l'overlay `AbonnementBloque` (mode `locked`)
après expiration forcée + redémarrage backend pour vider le cache du guard. Entreprises/
utilisateurs jetables nettoyés après chaque passage.

Non vérifié dans cette session (aucun bouton `window.confirm` cliqué via l'automatisation
navigateur, par prudence — cette action bloquerait la session si un dialogue natif se
déclenchait) : le flux réel de clic sur « Suspendre »/« Exempter » dans `BillingAdminPanel`
depuis le navigateur — couvert uniquement par Jest (mock de `window.confirm`) et par l'API
directe. À vérifier au clic si un bug y est un jour signalé.

### Correctif : planning générique remplacé par un vrai calendrier par culture (2026-09-05)

`cultureService.js` renvoyait le même calendrier générique (5 jalons) quelle que soit la
culture. Remplacé par `CALENDRIERS_PAR_CULTURE` (~10 cultures répandues, correspondance
insensible casse/accents) + repli générique conservé pour toute culture non reconnue. Les
dates se calculent désormais depuis `parcelles.date_semis` (nouvelle colonne) si renseignée,
sinon depuis aujourd'hui comme avant — piège de décalage de fuseau horaire (pg `DATE` → JS
`Date`) trouvé et corrigé en écrivant tout en UTC (`setUTCDate`, jamais `setDate`). Chaque
jalon généré est désormais persisté comme une `activites` (`ressourceType:'parcelle'`,
`RESSOURCES_VALIDES` étendu), réutilisant le modèle déjà en place pour devis/contact/salarie
au lieu du `savePlanningToDB` commenté. Frontend : section pliable « Plan d'intervention »
ajoutée sur chaque carte parcelle (`CulturesModule`), avec `<ActivitesSection>` réutilisé tel
quel. 4 tests, suite verte (270/270). Vérifié en réel (Docker + navigateur, calendriers
distincts Maïs/culture inconnue, dates correctes depuis une vraie date de semis).

### Module Pisciculture (2026-09-05)

Dernier item « Could have » du MoSCoW jamais commencé, choisi comme prochain chantier.
Demande explicite de l'utilisateur : s'appuyer sur un projet open source mature plutôt que
tout reconstruire, en particulier regarder du côté d'Odoo. **Recherche menée avant tout
code** : cœur Odoo (632 modules, clone source local) → rien. Dépôt communautaire dédié
`OCA/vertical-agriculture` → coquille vide jamais peuplée (3 commits, toutes branches
8.0→19.0, README dit littéralement que la table des modules « sera remplacée » — jamais
fait). Recherche plus large GitHub/GitLab (API publique interrogée directement) → rien de
mature, seulement des prototypes IoT (capteurs LoRaWAN, STM32) ou un schéma de données FIWARE
Smart Data Models explicitement « en cours de spécification » (2 contributeurs). Décision
validée avec l'utilisateur : mirroir du module **Poulailler** déjà construit et éprouvé,
complété par le vocabulaire qualité de l'eau du schéma FIWARE (`FishContainment`/`Sump` : pH,
oxygène dissous, température) pour la partie sans équivalent côté Poulailler.

**Découverte structurante avant d'écrire du code** : le stock de Poulailler ne vit plus dans
une table dédiée depuis l'alignement Odoo du 2026-08-18 — `produits`/`produit_categories`/
`produit_templates` sont le catalogue unifié, avec `module` contraint par un `CHECK` codé en
dur à 4 endroits (+ achats_documents) et par des tableaux littéraux `['Cultures',
'Poulailler']` répétés dans ~8 validations de routes et dans `stockSync.js` (qui **no-op
silencieusement**, sans erreur, pour un module non reconnu — piège réel identifié avant
d'écrire le code). La propre ledger « mouvements » de Poulailler (texte libre + sync
finances) s'est révélée être un vestige : ses 4 fonctions `create/update/delete
PoulaillerMouvement` côté `api.js` ne sont appelées nulle part dans `App.jsx`, supplantées
par le flux devis/achats_documents déjà branché sur le vrai stock — délibérément **pas**
reproduite pour Pisciculture.

- **Lots 1-2 (backend)** : 4 `CHECK` étendus (drop+recreate idempotent), nouvelles tables
  `pisciculture_livraisons`/`pisciculture_suivi` (`entreprise_id`/`user_id` dès la création,
  pas de retrofit comme Poulailler avait dû le faire), nouveau `routes/pisciculture.js`
  (mirroir de la portion livraisons+suivi de `poulailler.js` uniquement), whitelists étendues
  partout (`produits.js`, `produitCategories.js`, `produitTemplates.js`, `achats.js` ×4,
  `stockSync.js` ×2, `devis.js`). Catégories par défaut (Aliment/Poissons vivants/Alevins/
  Autre) seedées à l'inscription + backfill pour les 11 entreprises existantes. 5 tests
  (livraisons/suivi/isolation + synchro stock réelle vérifiée via un cycle achat complet).
  Migration rejouée sur copie de sauvegarde puis appliquée réellement. Commit `41a2d02`.
- **Lots 3-4 (frontend)** : nouveau `PiscicultureModule`, réutilisation telle quelle de
  `StocksTab`/`VentesWithDevis`/`AchatModule`/`ComptabiliteTab` (`moduleType="Pisciculture"`)
  — aucun changement à ces composants génériques. 3 onglets dédiés nouveaux (mirroirs
  Poulailler) : `BassinsEnvironnementTab` (pH/oxygène dissous/température, simulation client
  pure, aucun backend — comme `EnvironnementTab`), `PiscicultureMonitoringTab` (suivi
  quotidien : mortalité/croissance/alimentation/traitement), `PiscicultureLivraisonsTab`.
  Câblage complet du shell (`ModulesScreen`, `roles.js`, `availableTabs`, ternaire de
  deep-link recherche globale devenu une vraie table de correspondance, `HelpModule`). i18n
  fr/en complet (~50 clés). Commit `fbc8037`.
- **Vérification finale** : suite complète verte (275 intégration + 1 unitaire backend, 96
  frontend), build OK. Vérifié en réel sur entreprise jetable (Docker reconstruit + Chrome) :
  les 7 onglets (Bassins avec jauges pH/oxygène/température + graphiques, Suivi avec ajout
  d'entrée croissance fonctionnel, Stocks avec articles de démarrage pré-seedés et catégorie
  présélectionnée, Ventes avec le flux devis complet, Achats avec le formulaire multi-lignes,
  Livraisons avec création fonctionnelle, Comptabilité) rendus et exercés avec succès.
  Entreprise de test nettoyée (cascade `ON DELETE` désormais complète pour `produits`/
  `produit_categories`/`pisciculture_*` — plus besoin du nettoyage manuel multi-tables
  documenté pour d'anciennes entreprises de test).

### Module Météo (2026-09-05)

Dernier item « Could have » du MoSCoW jamais commencé. Recherche préalable (même rigueur que
Pisciculture) : cœur Odoo (clone source local) — zéro mention de météo ; le seul module météo
de l'Odoo Apps Store (`agriculture_weather_records`) est payant (247 €) et propriétaire, sans
dépôt public ; recherche GitHub/GitLab (« agriculture weather dashboard », « open-meteo
agriculture », « farm weather ») — uniquement des projets étudiants/hobby (0-4 étoiles,
souvent inachevés), aucun projet mature. Conclusion : rien à réutiliser architecturalement
au-delà de l'API **Open-Meteo** elle-même (gratuite, sans clé, CC BY 4.0) — projet construit
sur mesure.

Premier passage jugé trop minimal par l'utilisateur (« pas une simple coquille ») — projet
complet demandé. Décision de conception validée explicitement : **double granularité** —
localisation par défaut au niveau de l'entreprise, **et** surcharge optionnelle par parcelle
avec repli automatique, chaque entreprise choisissant naturellement son niveau de précision.

- **Lot 1 (backend : schéma + routes)** : `entreprises` et `parcelles` gagnent chacune
  `ville TEXT`/`latitude NUMERIC(9,6)`/`longitude NUMERIC(9,6)` (nullable, opt-in, pas de
  backfill). `PUT /api/entreprise` et `PUT/POST /cultures/parcelles` acceptent les 3 champs
  (même patron `COALESCE` déjà utilisé pour `dateSemis`). Nouveau `routes/meteo.js` :
  `GET /villes?q=` (proxy géocodage Open-Meteo), `GET /?parcelleId=` (résout la localisation —
  parcelle si coordonnées propres, sinon entreprise, sinon `404` explicite — interroge
  `api.open-meteo.com/v1/forecast` avec un jeu complet de paramètres agronomiques : actuel
  température/humidité/précipitation/vent ; quotidien 14 jours température min/max,
  précipitations + probabilité, UV max, lever/coucher soleil, durée du jour, ET0
  évapotranspiration, vent max ; horaire température/humidité du sol à deux profondeurs,
  point de rosée, déficit de pression de vapeur — moyennés sur les 24 prochaines heures), et
  calcule des **alertes dérivées à la volée, jamais persistées** (gel si tempMin ≤ 2°C sous
  3 jours, pluie forte > 30 mm, vent fort > 50 km/h, UV élevé > 8, sol sec sur l'humidité
  racinaire — seuils indicatifs non calibrés par culture/sol, documentés comme tels).
  `GET /parcelles-localisees` liste les parcelles de l'entreprise ayant leurs propres
  coordonnées. Toujours côté serveur (mirroir de `recaptcha.js` pour le principe d'appel
  externe, mais `502` sur échec — pas de repli gracieux, la météo ne protège aucune action
  primaire contrairement au recaptcha). Migration rejouée ×2 sur copie de sauvegarde restaurée
  (idempotente), puis appliquée réellement.
- **Lot 2 (tests backend)** : `meteo.test.js` (15 tests) — géocodage, résolution entreprise
  vs parcelle vs aucune (404), un test par type d'alerte + un « conditions normales → [] »,
  `502` sur échec externe, isolation multi-tenant (`parcelleId` d'une autre entreprise ignoré,
  repli sur celle de l'appelant), `parcelles-localisees` scopé par entreprise. Piège retrouvé
  et évité d'emblée (déjà documenté pour `abonnement.test.js`) : `jest.fn()` lève
  `ReferenceError: jest is not defined` dans le runner d'intégration natif-ESM — mock de
  `global.fetch` avec une fonction simple, pas `jest.fn(...)`.
- **Lots 3-4 (frontend)** : `src/lib/api.js` (`rechercherVilleMeteo`, `getMeteo`,
  `getParcellesLocalisees`). Nouvelle carte « Localisation » dans `ProfilModule` (recherche
  de ville au fil de la frappe façon `GlobalSearch`, préremplie via `getEntreprise()` —
  jusque-là jamais appelée côté frontend). Nouvelle section pliable « Météo de cette
  parcelle » sur chaque carte de `CulturesModule` (même patron visuel que « Plan
  d'intervention » déjà existant). Nouveaux `src/components/MeteoModule.jsx` (onglet dédié,
  toujours visible et non gated — mirroir d'`observations` — sélecteur entreprise/parcelle,
  conditions actuelles, sol, aujourd'hui avec lever/coucher/UV/ET0, tableau de prévision
  14 jours, alertes) et `src/components/MeteoWidget.jsx` (résumé sur `HomeOverview` — conditions
  actuelles + alerte la plus grave, lien vers l'onglet complet). i18n `meteo.*`/
  `profil.location*`/`cultures.meteoParcelle*` (fr + en). `MeteoModule.test.jsx` (4 tests) +
  `MeteoWidget.test.jsx` (3 tests).
  **Bug réel trouvé en test navigateur réel, corrigé** : les deux nouveaux boutons de
  résultat de recherche de ville (Profil et parcelle) rendaient un texte invisible — même
  cause racine déjà documentée dans les commentaires de `GlobalSearch.jsx` (un `<button>`
  sans `color` explicite hérite du blanc du `color-scheme: light dark` du navigateur,
  invisible sur fond blanc). Corrigé en ajoutant `color: COLORS.ink` aux deux styles de
  bouton.
- **Vérification finale** : suite complète verte (backend intégration + unitaire, 103
  frontend), build OK. Vérifié en navigateur réel sur entreprise jetable, **avec de vraies
  données Open-Meteo (aucun mock côté navigateur)** : (1) ville d'entreprise « Bamako »
  configurée → widget tableau de bord et onglet Météo se peuplent tous deux avec les mêmes
  données réelles, lien widget → onglet fonctionnel ; (2) ville propre à une parcelle
  (« Dakar ») configurée → météo distincte de celle de l'entreprise (température/humidité
  différentes), `source` indique bien « localisation de la parcelle » vs « de l'entreprise » ;
  (3) entreprise sans aucune localisation configurée → message discret dans le widget et
  l'onglet, aucune erreur. Les deux entreprises jetables (« Ferme Meteo Test SARL »,
  « Ferme SansMeteo Test ») et leurs parcelles/comptes nettoyés manuellement après coup —
  `parcelles`/`cultures`/`poulaillers`/`recoltes`/`finances`/etc. n'ont **pas** de cascade
  `ON DELETE` sur `entreprise_id` (contrairement à `produits`/`contacts`/la plupart des tables
  plus récentes, toutes `CASCADE`) ; requête `information_schema` utilisée pour lister
  précisément les tables encore en `NO ACTION` avant de les vider dans le bon ordre.

### Jalon 1 — passe de durcissement ciblée sur les chantiers récents (2026-09-05)

Audit statique (pas un E2E complet) des routes backend ajoutées depuis la dernière passe
« manuelle E2E » documentée (2026-08-13) — Stock A/B/C, Pisciculture, Abonnement, Catalogue
produit (5 étapes Odoo), Météo — à la recherche des deux classes de bugs déjà trouvées à
plusieurs reprises dans ce projet : (1) `DELETE`/`PUT` qui ne vérifie pas `rowCount`/
`rows.length` et renvoie `200` même sur un id bidon ou d'une autre entreprise, (2) écriture
non cloisonnée par `entreprise_id`. Méthode : comptage croisé `router.delete(`/`router.put(`
vs mentions `rowCount`/`rows.length === 0` par fichier de route, puis lecture ciblée des
fichiers suspects.

- **Bug réel trouvé et corrigé** : `DELETE /api/produits/:id` (`routes/produits.js`) ne
  vérifiait jamais le résultat de la requête — renvoyait toujours `{success:true}`/`200`
  même sur un produit d'une autre entreprise ou un id inexistant, exactement la même classe
  de bug déjà corrigée à plusieurs reprises (`contacts`, `banques`, parcelles, livraisons
  poulailler, écritures finances). **Aucun test ne couvrait cette route** (seul le
  sous-chemin `/produits/lots/:lotId` était testé) — c'est ce qui l'a laissé passer. Corrigé
  (`RETURNING id` + `rows.length === 0` → `404`) + test de régression ajouté dans
  `produits.test.js` (suppression réussie, 2e suppression → 404, suppression depuis une
  autre entreprise → 404). Vérifié à la fois par la suite d'intégration (290/290 verts) et
  en conditions réelles contre le conteneur backend reconstruit (`200` puis `404` via
  `curl`).
- Fichiers audités et jugés sains (contrôles d'existence déjà corrects ou non nécessaires) :
  `attributsProduit.js`, `produitCategories.js`, `produitTemplates.js`, `listesPrix.js`,
  `activites.js`, `applicationsIntrants.js`, `contactTags.js`, `unitesMesure(Categories).js`,
  `pisciculture.js`, `billing.js` (platform-admin uniquement, transactionnel sur `/activer`,
  pas de souci de cloisonnement puisque volontairement cross-tenant). Gating `requireRole`
  absent sur `produits`/`produitTemplates`/`produitCategories`/`listesPrix`/
  `attributsProduit`/`applicationsIntrants`/`pisciculture` confirmé **volontaire** (même
  convention que `poulailler.js`/`cultures.js`/`achats.js` : domaine opérationnel ouvert à
  tout rôle, seul le domaine comptable — `banques`/`business` finances — est gated
  admin/directeur).
- **Effet de bord découvert en marge** : 4 entreprises de test jamais nettoyées trouvées
  dans la base de dev, restes de sessions passées — `id=25` (2026-08-13, orpheline, aucun
  utilisateur lié), `id=128`/`132` (« E2E Etape3 Curl SARL »/« E2E Lot2 SARL », 2026-09-04,
  restes de l'étape 3 du catalogue Odoo dont le journal ne mentionnait explicitement aucun
  nettoyage contrairement aux étapes 2 et 4), plus l'entreprise jetable créée pour le smoke
  test de cette passe. Toutes les quatre supprimées (même procédure `information_schema` que
  pour Météo). **Laissée volontairement de côté** : `id=3` (« Entreprise Test », 2026-07-21,
  elle aussi orpheline mais bien plus ancienne que tout chantier documenté — pas assez de
  certitude sur son origine pour la supprimer unilatéralement, signalée à l'utilisateur au
  lieu d'être effacée). **`id=3` vérifiée puis supprimée séparément** après coup — créée le
  2026-07-21 (antérieure à tout chantier documenté), aucun utilisateur lié (jamais accessible),
  zéro ligne dans parcelles/cultures/produits/contacts/devis/finances/salaries/poulaillers/
  banques/feedback, aucune ligne `abonnement_paiements`/`audit_log`. Le `subscription_status
  = 'active'` qui semblait indiquer une activité récente était en réalité un effet de bord de
  la migration « grand-père » du 2026-09-04 (`migrate.js:seedComptaConfig…`-like backfill,
  voir Abonnement Phase 1) appliquée identiquement à toute entreprise pré-existante — pas une
  action manuelle sur celle-ci. Coquille vide confirmée, supprimée.

### Jalon 1 — durcissement, suite : signature publique de devis totalement inaccessible (2026-09-05)

En poursuivant l'audit (recherche des fonctions `src/lib/api.js` sans aucun appelant dans
`src/`, une méthode qui avait déjà révélé Observations/Planning par le passé), découverte
d'un problème bien plus grave que les précédents : **`getDevisPublic`/`signerDevisPublic`
n'étaient appelées nulle part** — la fonctionnalité « devis/factures (with e-signature) »,
présentée dans `CLAUDE.md` comme déjà construite et testée, était en réalité **totalement
inaccessible à un vrai client externe**.

- Le backend était correct (`GET/POST /api/devis/public/:token[...]`) et `src/lib/api.js`
  ciblait bien la bonne URL — mais **aucun composant React ne les appelait jamais**, et
  **aucune route frontend n'existait** pour le lien envoyé par email
  (`${FRONTEND_URL}/devis/${token}`, construit dans `routes/devis.js` `POST /:id/envoyer`) :
  `App.jsx` (`pathnameToScreen`) ne reconnaît que `/app/*`, `/modules`, `/onboarding-*` — tout
  le reste retombe sur l'écran de connexion. Concrètement : un client cliquant le lien de
  l'email « devis envoyé » atterrissait sur le login, sans aucun moyen de voir ni signer son
  devis.
- **Ce qui a masqué le problème dans tous les tests précédents** : un contournement admin
  existe (`POST /devis/:id/valider-manuel`), systématiquement utilisé dans les tests et démos
  pour faire progresser un devis vers « Signé » sans jamais passer par le vrai lien client —
  le flux public n'avait donc jamais été réellement exercé, ni même testé (0 test sur
  `GET/POST /devis/public/*` avant ce correctif).
- Décision utilisateur explicite sur le mode de signature : **pad de signature dessiné**
  (canvas), pas une simple confirmation par nom tapé.
- **Backend** : `GET /devis/public/:token` complétée (`signataireNom`, `dateSignature`,
  `devise`/`locale` de l'entreprise — absents jusque-là, nécessaires pour un affichage correct
  côté client). `devisPublicPdfUrl(token)` ajouté à `api.js` (lien direct, pas de fetch+blob —
  aucune authentification requise contrairement aux téléchargements PDF authentifiés).
- **Frontend** : nouveau `src/components/DevisPublicView.jsx`, monté **en dehors de `<App/>`**
  via un petit composant `Root()` dans `main.jsx` qui teste `window.location.pathname` avant
  de choisir quoi monter — nécessaire car `App()` a des dizaines de hooks dépendant d'un
  utilisateur connecté, et la règle des hooks React interdit un simple `if` interne qui les
  court-circuiterait dès qu'un même montage naviguerait entre chemin public et chemin
  applicatif. Pad de signature construit à la main (canvas + Pointer Events, dimensionné en
  pixels physiques via `devicePixelRatio` pour un trait net, `touchAction:'none'` pour ne pas
  scroller la page au doigt) — pas de librairie externe. Affiche devis/lignes/total (formatés
  dans la devise/locale réelle de l'entreprise, pas un défaut générique), état déjà signé avec
  image de signature + lien PDP, ou formulaire de signature si encore en attente. i18n
  `devisPublic.*` fr/en.
- **3 nouveaux tests d'intégration** (`devis.test.js`, jusque-là zéro couverture sur ces
  routes) : consultation + devise/locale + token bidon → 404 ; signature + relecture
  signataire/date + double-signature → 400 + mauvais token → 404 ; PDF public → 200 avant
  même signature + token bidon → 404. 294/294 tests d'intégration verts après.
- **Vérifié en navigateur réel** (pas de mock) sur une entreprise jetable : token posé
  directement en base (l'environnement de dev n'a pas de vrai envoi email configuré non plus),
  page publique affichée avec les vraies données, nom + signature dessinée à la souris,
  soumission → badge passe à « Signé », carte de confirmation avec l'image de la signature et
  le lien PDF, **persistance confirmée par rechargement de page** (pas un état local
  éphémère). PDF public vérifié via `curl` (200, `application/pdf`, document valide). Cas
  token inexistant vérifié aussi (message discret, pas d'erreur). Entreprise de test nettoyée.
- Non traité dans cette passe (signalé, pas corrigé) : `devis.js`'s `DEVIS_COLUMNS` renvoie
  `d.date`/`d.date_signature` bruts (pas `to_char`'d) pour la vue authentifiée — même risque
  de décalage TZ pg-DATE→JS-Date déjà corrigé ailleurs (`validity_date`, `date_semis`,
  `date_echeance`) mais jamais signalé comme un bug réel en pratique ; changer `DEVIS_COLUMNS`
  aurait un rayon d'effet bien plus large (tous les consommateurs de la vue authentifiée) que
  ce qui se justifie dans une passe de durcissement — à traiter séparément si un décalage
  réel est un jour constaté.
- Suite complète reconfirmée verte après le correctif (294 tests d'intégration / 35 fichiers + 1 unitaire).

### Jalon 1 — durcissement, suite : RH / Comptabilité / Équipements / Cultures / Catalogue (2026-09-05)

Poursuite de la même méthode (fonctions `src/lib/api.js` sans aucun appelant dans `src/`) sur
les modules restants. Rien de la gravité de la signature publique de devis ; trois
observations, aucune ne justifiant une correction non demandée :

- **`cultures_mouvements` confirmé mort/vestige** — `createCulturesMouvement`/
  `deleteCulturesMouvement`/`updateCulturesMouvement`/`getCulturesMouvementHistorique` sans
  aucun appelant, exactement la même situation que `poulailler_mouvements` (déjà documentée
  comme morte lors du chantier Pisciculture) mais jamais explicitement signalée pour Cultures.
  Confirmé par les données : les 4 seules lignes de la table datent du 25/07 au 02/08/2026,
  **avant** l'unification produits/devis du 18/08 — aucune nouvelle ligne depuis, malgré des
  dizaines de ventes/achats Cultures créés depuis via `VentesWithDevis`/`AchatModule` (le vrai
  flux, basé sur `produits`/`stock_mouvements`). Aucune action : même statut que le ledger
  Poulailler, un futur nettoyage de code mort pourrait les regrouper.
- **Unités de mesure : aucun panneau de gestion** — `routes/unitesMesure.js`/
  `unitesMesureCategories.js` ont un CRUD complet, testé, gated admin/directeur — mais
  `createUniteMesure`/`updateUniteMesure`/`deleteUniteMesure` (+ variantes catégories) n'ont
  aucun appelant ; seule la lecture (`getUnitesMesure`, pour peupler un menu déroulant) est
  utilisée. Contrairement à tous les autres référentiels de l'app (taxes, comptes, journaux,
  conditions de paiement, départements/postes/types de congé, catégories/gabarits produit),
  qui ont chacun un panneau dédié, celui-ci n'existe pas. Moins grave que la signature de
  devis : des unités par défaut sont seedées à l'inscription (`UNITES_MESURE_DEFAUT`), l'app
  reste utilisable — seule la personnalisation (ajouter une unité propre) est bloquée. Signalé
  à l'utilisateur, pas construit sans confirmation.
- **`getContactPrixEffectifs` (aperçu groupé des prix d'un contact) inutilisé** —
  `GET /contacts/:id/prix-effectifs` fonctionne et est testé, mais seule la résolution par
  article isolé (`getPrixEffectif`, utilisée dans `DevisModule`) est réellement appelée. Pure
  fonctionnalité de confort manquante (voir le prix de tous les articles d'un coup pour un
  client donné), pas un chemin bloqué.
- **Confirmé sain, pattern délibéré et non un bug** : ~10 référentiels de l'app (banques,
  contrats salariés, factures brouillon, départements/postes/types de congé, gabarits/
  catégories produit) exposent Ajouter + Supprimer via l'UI mais jamais Modifier en place
  (l'utilisateur supprime et recrée) — leurs fonctions `update*` d'`api.js` sont routinièrement
  sans appelant. Confirmé comme une convention UX cohérente et intentionnelle dans tout le
  projet (déjà notée pour `updateBanque`/`updateSalarie` lors du premier passage Jalon 1 du
  2026-08-13), pas quelque chose à corriger au cas par cas.
- **Équipements vérifié sain** — `EquipementsModule.jsx` utilise bien la totalité du CRUD
  équipements + sous-ressource maintenance (y compris `updateEquipement`, contrairement au
  pattern ci-dessus) ; aucun gap trouvé.

### Jalon 1 — durcissement, dernier reliquat : auth/mfa/contacts/achats/banques/feedback/recherche (2026-09-05)

Audit du dernier lot de routes non repassées cette session — les plus anciennes et déjà les
plus exercées (passe API du 2026-08-13, correctifs du 2026-08-30). Lecture complète de chaque
fichier (pas seulement le comptage croisé DELETE/PUT utilisé sur les lots précédents) vu leur
poids sécurité/argent : `auth.js` (register transactionnel + tous les seeds par défaut,
login avec ses 6 branches d'audit et messages génériques anti-énumération, rate-limit MFA/
inscriptions), `mfa.js` (setup/verify/resend/disable TOTP+email). **Rien trouvé** — les deux
fichiers sont solides, cohérents avec ce qui est déjà documenté.

`contacts.js`/`achats.js`/`banques.js`/`feedback.js`/`recherche.js` : mêmes vérifications
(existence checks DELETE/PUT, cloisonnement `entreprise_id`, paramétrage SQL) — tout est déjà
correctement corrigé (banques : confirmé, le bug du 2026-08-30 ne s'est pas reproduit, la
vérification se fait via `banquesService.js` et non `rowCount` directement, d'où un faux
positif dans le grep automatisé du lot précédent). Une seule observation, mineure et déjà
sans conséquence pratique : `GET /contacts/:id/prix-effectifs` (déjà notée comme sans aucun
appelant frontend) interroge `listes_prix_lignes` avec un schéma **antérieur** à la réécriture
du moteur de tarification Odoo étape 4 (2026-09-04) — `INNER JOIN produits ON id = stock_id`
exclurait silencieusement toute règle `applied_on != 'variante'` (stock_id NULL), et ne gère
pas le mode `pourcentage` (`prix` est NULL dans ce cas). Sans conséquence tant que rien ne
l'appelle ; à corriger seulement si un jour un aperçu groupé des prix par contact est construit
sur cette route.

**Passe de durcissement Jalon 1/3 déclarée complète** pour cette session : tous les modules de
l'app ont été repassés (Stock A/B/C, Pisciculture, Abonnement, Catalogue Odoo, Météo, RH,
Comptabilité, Équipements, Cultures, auth/MFA/contacts/achats/banques/feedback/recherche). Un
bug sévère trouvé et corrigé (signature publique de devis), un bug mineur trouvé et corrigé
(`DELETE /produits/:id`), une poignée d'observations mineures documentées (ledgers morts,
panneau unités de mesure absent, schéma de prix-effectifs par contact obsolète) — aucune ne
bloquante, toutes signalées plutôt que corrigées sans confirmation.

### Agriculture de précision : analyse de sol + NDVI satellite (2026-09-05)

Chantier suivant sur le backlog long terme (item « Won't have » du MoSCoW, jamais commencé),
choisi par l'utilisateur après un point d'étape roadmap. Même rigueur de recherche préalable
qu'exigée pour Pisciculture/Météo : Odoo (clone source local — un vrai module IoT existe dans
le cœur, `addons/iot_base`/`iot_drivers`, mais entièrement dédié au matériel de caisse/atelier,
rien pour l'agricole), GitHub (recherche « precision agriculture », « ndvi », « crop-
monitoring » — les résultats les plus étoilés sont soit des « awesome lists » sans code
(`px39n/Awesome-Precision-Agriculture`, 142 étoiles mais `language: null`), soit de vrais
dépôts très peu matures, `Tensornetics/precision-agriculture`, 8 étoiles), GitLab (5 meilleurs
résultats, tous 0 étoile). Conclusion identique aux chantiers précédents : rien à réutiliser
au-delà d'API de données externes gratuites.

Décision explicite de l'utilisateur (via `AskUserQuestion`) : **analyse de sol ET NDVI
satellite**, pas seulement le sol, en acceptant que le NDVI nécessite une clé API gratuite à
créer — sur le modèle du reCAPTCHA déjà dans l'app.

- **SoilGrids (ISRIC)** — gratuit, sans clé, vérifié en direct sur une vraie coordonnée. Le
  `d_factor` (diviseur pour convertir la valeur brute en unité réelle) **varie par propriété**
  — 10 pour la plupart, **100 pour l'azote** — vérifié en direct plutôt que supposé constant,
  ce qui aurait produit un azote 10× trop élevé si codé en dur.
- **Agromonitoring/OpenWeather Agro API** — clé optionnelle. Contrainte dure découverte en
  lisant la doc officielle : la surface d'un polygone doit être **entre 1 et 3000 hectares**.
  L'app n'a aucune brique cartographique pour dessiner le contour réel d'une parcelle
  (`ParcelMapTab` n'est qu'un positionnement de points par pourcentage, purement décoratif) —
  un **carré approximatif** est donc construit à partir de latitude/longitude/superficie de la
  parcelle (`utils/agroPolygon.js`), limite assumée et documentée.
- **Backend** : `server/src/routes/precisionAgricole.js` (`GET /sol`, `GET /ndvi`),
  `utils/solAgronomie.js` (classification de texture par triangle textural simplifié +
  table de suggestion de cultures par pH/texture, mêmes ~10 cultures que
  `cultureService.js`), `utils/agroPolygon.js` (génération du polygone, création
  paresseuse mise en cache dans la nouvelle colonne `parcelles.agro_polygon_id`,
  suppression best-effort côté Agromonitoring). `PUT /cultures/parcelles/:id` invalide le
  polygone dès que latitude/longitude/superficie changent — et **`superficie` devient au
  passage éditable via `PUT`**, elle ne l'était pas avant (toutes les autres écritures de la
  route l'étaient déjà, gap probablement non intentionnel corrigé en passant).
- **Migration rejouée ×2** sur copie de sauvegarde restaurée puis appliquée réellement
  (`parcelles.agro_polygon_id`).
- **11 tests d'intégration** : sol (texture/pH/suggestions, 404 sans coordonnées, 502 externe,
  et le cas décrit plus bas), NDVI (clé absente → `{configured:false}` jamais une erreur,
  création puis réutilisation du polygone — pas de 2e appel de création confirmé, 400 hors
  bornes de superficie, invalidation après changement de parcelle, isolation multi-tenant,
  502 externe).
- **Frontend** : nouvelle section pliable « Agriculture de précision » sur chaque carte de
  `CulturesModule` (même patron que « Météo de cette parcelle »), deux blocs (sol/NDVI),
  `MiniChart` réutilisé tel quel pour la tendance NDVI. i18n `precisionAgricole.*`.
- **Bug réel trouvé en vérification navigateur réelle, corrigé** : sur les coordonnées
  résolues pour « Bamako » (12.609, -7.975 — probablement un pixel du fleuve Niger, qui
  traverse la ville), SoilGrids répond `200 OK` mais avec **toutes les propriétés à `null`**
  (pixel sans donnée : plan d'eau ou zone non couverte). La route renvoyait ce succès vide tel
  quel, affichant une carte « Texture : — » sans aucune explication. Corrigé : si `ph` et
  `argile`/`sable`/`limon` sont tous `null`, la route renvoie désormais un `404` explicite
  (« Aucune donnée de sol disponible à cet endroit précis… ») — plus un test de régression.
  Vérifié à nouveau en navigateur réel : message clair affiché, puis succès complet confirmé
  sur une coordonnée voisine ayant de vraies données (texture limon, pH 6.1, cultures
  suggérées manioc/maïs/riz/blé affichées).
- NDVI vérifié uniquement en mode « non configuré » (aucune clé Agromonitoring disponible
  dans cet environnement de développement) — comportement explicitement anticipé par le plan,
  pas un blocage du chantier.
- Suite complète reconfirmée verte (305 tests d'intégration / 36 fichiers, 103 frontend),
  build OK. Entreprise de test nettoyée.

### Multi-devise réel — roadmap (4 étapes), Étape 1 : fondations taux de change (2026-09-05)

Chantier suivant sur le backlog long terme, choisi par l'utilisateur après un point d'étape
roadmap sur ce qui reste à faire. Décision explicite sur l'ampleur (via `AskUserQuestion`) :
la version **complète, comptablement correcte** (comme Odoo — client avec sa propre devise,
devis/facture émis dans cette devise, grand livre en devise entreprise avec écart de change au
paiement), pas la version « conversion d'affichage seule » plus légère. Vu l'ampleur
(comparable au roadmap ERP Comptabilité initial, 6 étapes sur plusieurs sessions), ce chantier
est **staged sur 4 étapes** — ce journal documente la roadmap complète, seule l'étape 1 étant
construite cette session :

- **Étape 1 (faite)** : fondations — taux de change quotidiens + utilitaire de conversion.
- **Étape 2 (à venir)** : `contacts.devise_facturation` + `devis.devise`/`taux_change`/
  `total_devise` — un devis peut être créé/envoyé dans la devise du contact, PDF affiche les
  deux montants. Règlement/échéances encore trackés en devise entreprise (conversion au moment
  de la synchro finances) — pas encore d'intégration `account_move`.
- **Étape 3 (à venir)** : `account_move`/`account_move_line` gagnent `devise`/
  `invoice_currency_rate`/`amount_currency` (patron Odoo exact — voir plus bas) ; `facturer`
  propage la devise/le taux du devis vers la pièce comptable.
- **Étape 4 (à venir, la plus délicate)** : écart de change au paiement — nouveaux comptes
  par défaut `Gains de change`/`Pertes de change` (`income_other`/`expense_other`, déjà
  présents dans le CHECK `account_type` — rien à modifier là), `enregistrerPaiementMove`
  étendu pour détecter un taux différent entre facture et paiement et poster automatiquement
  l'écriture d'équilibrage.

**Recherche menée** : Odoo (clone source local, `addons/base/models/res_currency.py` lu en
détail) a ici, contrairement à tous les chantiers précédents (météo, agriculture de précision,
pisciculture), un **vrai modèle mature et directement transposable** — principe central repris
pour les étapes 3-4 : `debit`/`credit`/`balance` restent **toujours** dans la devise de
l'entreprise (intégrité du grand livre), un champ **`amount_currency`** complémentaire porte le
montant dans la devise **d'origine** du document, et le taux de conversion est **figé à la date
de la pièce** (`currency_rate`), jamais recalculé rétroactivement même si le taux bouge plus
tard. GitHub : `LerianStudio/midaz` (437 étoiles, actif) est un vrai grand livre multi-devise
mature, mais en Go/microservices, non réutilisable dans ce projet Node/Express/Postgres
monolithique — confirme qu'une référence sérieuse existe sans qu'il y ait de code à en tirer.

**API de taux de change retenue** : `https://open.er-api.com/v6/latest/USD` — gratuite,
**sans clé**, testée en direct (XOF, XAF, MAD, NGN, GHS, KES — toutes les devises de la liste
`DEVISES` du frontend — bien couvertes ; XOF et XAF confirmées à parité 1:1 comme attendu dans
la réalité, les deux francs CFA étant historiquement alignés). Mise à jour une fois par jour.
Usage commercial autorisé, redistribution interdite, **attribution discrète requise** par les
conditions d'utilisation dès qu'une UI affichera un taux/une conversion — pas encore le cas à
cette étape (aucune UI construite), à ne pas oublier à l'étape 2.

**Étape 1, détail** :
- `migrate.js` : nouvelle table `currency_rates` (`devise TEXT`, `taux_vs_usd NUMERIC(18,8)`,
  `date DATE`, `UNIQUE(devise, date)`) — **table plateforme, pas de `entreprise_id`** : un taux
  de change n'appartient à aucun locataire, il est partagé par toutes les entreprises. Taux
  stockés vs USD (pivot) plutôt qu'en N² paires — convertir(A, B) calcule le cross-rate à la
  volée via `taux_vs_usd(A)/taux_vs_usd(B)`, USD choisi car c'est le pivot naturel de l'API
  retenue.
- `server/src/utils/currencyRates.js` : `rafraichirTauxDuJour()` (upsert une ligne par devise
  pour la date du jour, transaction explicite), `obtenirTaux(devise, date)` (repli sur le
  dernier taux connu ≤ date — les weekends où le fournisseur ne republie pas ne cassent rien —
  et un seul essai de rafraîchissement paresseux si rien n'existe du tout, pas de cron dans ce
  projet, même esprit que `meteo.js`), `convertir(montant, deviseSource, deviseCible, date)`.
- `server/src/routes/devises.js` : `GET /api/devises/taux?de=&vers=&date=`, monté sur
  `/api/devises`.
- **6 tests d'intégration** (`de`/`vers` manquants, même devise des deux côtés → taux 1 sans
  appel réseau, conversion avec rafraîchissement paresseux, devise inconnue → 400, échec
  fournisseur → 502, repli sur le dernier taux connu → pas de nouvel appel réseau). 311/311
  tests d'intégration verts après.
- **Bug réel trouvé pendant l'implémentation, corrigé avant tout commit** : le même décalage
  TZ pg-DATE→JS-Date déjà documenté à plusieurs reprises dans ce projet (`validity_date`,
  `date_semis`, `date_echeance`, et signalé comme risque théorique non traité pour
  `DEVIS_COLUMNS` lors du chantier météo) — cette fois dans du code neuf : `tauxVsUsd()`
  renvoyait `date` brut (colonne `DATE`) au lieu de `to_char(date, 'YYYY-MM-DD')`, faisant
  échouer 2 des 6 tests dès la première exécution (date attendue `2026-09-05`, reçue
  `2026-09-04T22:00:00.000Z`). Corrigé immédiatement, tests repassés verts.
- Migration rejouée ×2 sur copie de sauvegarde restaurée puis appliquée réellement. Vérifié en
  conditions réelles après reconstruction Docker : `curl` contre `/api/devises/taux` avec de
  vraies données (XOF→EUR ≈ 0,001524 — cohérent avec la parité fixe XOF/EUR connue de
  655,96 XOF pour 1 EUR ; EUR→USD ≈ 1,161, plausible), 166 devises effectivement persistées en
  base pour la date du jour. Entreprise de test nettoyée.

### Multi-devise réel — Étape 2 : devis en devise étrangère (2026-09-06)

Suite immédiate de l'étape 1 (mêmes fondations réutilisées telles quelles : `convertir()`
d'`utils/currencyRates.js`). Un devis peut désormais être créé/envoyé dans la devise propre
d'un contact, avec taux de change figé et affiché — mais **volontairement pas encore
facturable** en devise étrangère, ce point étant explicitement réservé à l'étape 3.

- **Schéma** : `contacts.devise_facturation TEXT` (nullable — absent = facturation dans la
  devise de l'entreprise, comportement historique inchangé) ; `devis.devise TEXT` et
  `devis.taux_change NUMERIC(18,8)` (nullables, résolus à la lecture via
  `COALESCE(devise, entreprise.devise)` — aucun devis existant n'a eu besoin d'un backfill).
  **Piège rencontré et corrigé avant tout test** : `contacts.devise_facturation` a d'abord été
  placée au même endroit que les autres ajouts de cette session (juste après la table
  `currency_rates`), ce qui a cassé la migration (`relation "contacts" does not exist`) — la
  table `contacts` n'est créée que bien plus loin dans le script séquentiel. Déplacée juste
  après `CREATE TABLE contacts` (même contrainte déjà documentée pour d'autres FK vers cette
  table). Piège distinct rencontré en même temps : un commentaire SQL contenant des
  **backticks** (`` `devise` ``, `` `total` ``) a fait planter le parsing JS du fichier entier
  — tout `migrate.js` est un unique gros template literal JS, un backtick dans un commentaire
  SQL referme prématurément la chaîne JS. Corrigé en reformulant sans backticks.
- **`routes/devis.js:resoudreDeviseEtTaux`** : devise explicite (body) > `devise_facturation`
  du contact > devise de l'entreprise ; appelle `convertir(1, devise, deviseEntreprise)`
  (réutilise l'étape 1 telle quelle) pour figer `taux_change`. Appelée à `POST /` (création) et
  refaite à `POST /:id/envoyer` (le taux du jour de l'envoi réel prime sur celui, provisoire,
  de la création — mais le calcul se fait **avant** l'envoi de l'email et l'écriture en base
  n'a lieu qu'**après** un envoi réussi, même invariant déjà établi pour `statut`/
  `token_public` lors du correctif du 2026-09-05 sur ce même fichier). `devis.total` continue
  de porter le montant **dans la devise du devis** (pas de changement de sens pour les devis
  déjà existants, tous en devise entreprise) ; `totalDeviseEntreprise` (calculé à la volée en
  SQL, jamais stocké) donne l'équivalent en devise entreprise.
- **`POST /:id/facturer` bloque désormais explicitement (400)** un devis dont la devise diffère
  de celle de l'entreprise, avec un message clair renvoyé jusqu'au frontend : la facturation
  réelle (un `account_move` avec ses propres champs de devise) est l'étape 3, pas encore
  construite — ce garde-fou évite d'avoir à toucher au moteur `enregistrerPaiementMove`/
  `financeSync` déjà lourdement testé, tant que cette étape n'est pas faite proprement.
- **Frontend** : sélecteur de devise de facturation sur la fiche client (`ContactsModule`,
  gaté `type === 'client'`, même patron que le sélecteur de liste de prix juste au-dessus).
  `DevisModule` (liste, Kanban, détail) : le montant affiché suit désormais la devise du devis
  (`d.devise`/`detailData.devise`), pas systématiquement celle de l'entreprise comme avant —
  **bug réel trouvé en vérification navigateur** : la liste affichait « 500 F CFA » pour un
  devis de 500 €, corrigé dans les 3 vues (liste, Kanban, détail) en comparant `d.devise` à la
  devise de l'entreprise (`useLocale()`) et en formatant avec `fmtMoneyWith` dans le bon cas.
  Le détail affiche en plus une ligne « ≈ équivalent devise entreprise ».
  **Limite connue, non traitée à cette étape** (à corriger à l'étape 3 en même temps que
  l'intégration `account_move`, pas avant) : les montants par ligne (P.U., total ligne,
  montant HT/taxes) et le PDF du devis affichent encore systématiquement la devise de
  l'entreprise, même quand `devis.devise` diffère — seul le total agrégé est correct dans les
  deux devises pour l'instant.
- **11 tests d'intégration** ajoutés à `devis.test.js` : sans devise particulière (aucune devise
  spéciale) → devise/taux entreprise sans appel réseau ; client avec devise propre → héritée
  par défaut, taux figé et cohérent (vérifié par calcul explicite du cross-rate attendu) ;
  devise explicite prime sur celle du contact ; facturer un devis étranger → 400 avec message
  explicite ; envoyer ne réécrit le taux qu'après un envoi réussi (email indisponible dans cet
  environnement de test → taux inchangé, pas écrasé par le calcul fait avant l'échec) ; contact
  désassigné de sa devise via `PUT {deviseFacturation:null}` → repli sur la devise entreprise.
  317/317 tests d'intégration verts après (306 + 11), 103 tests frontend inchangés, build OK.
- **Vérifié en conditions réelles** sur une entreprise jetable : client « Client Europe SARL »
  facturé en EUR, devis de 500 € créé via l'API réelle → `tauxChange` 655,956 (parité fixe
  XOF/EUR exacte), `totalDeviseEntreprise` 327 978,20 F CFA — confirmé à l'identique dans le
  navigateur (liste « 500,00 € », détail « Total 500,00 € / ≈ équivalent devise entreprise
  327 978 F CFA »). Validation manuelle du devis puis tentative de facturation → message de
  blocage affiché correctement comme notification. Entreprise de test nettoyée (parcelles/
  poulaillers par défaut inclus, aucune n'a de cascade `ON DELETE` — même procédure que les
  chantiers précédents).

### Multi-devise réel — Étape 3 : facturation réelle en devise étrangère (2026-09-06)

Suite immédiate de l'étape 2, sur demande explicite de l'utilisateur (« enchaîne sur l'étape
3 »). Le blocage volontaire posé à l'étape 2 (`POST /devis/:id/facturer` refusait un devis en
devise étrangère) est levé : une facture comptable réelle (`account_move`), avec un grand
livre correctement équilibré et converti, peut désormais être générée depuis un devis dans
n'importe quelle devise.

**Conception reprise directement de la recherche Odoo de l'étape 1** (`res_currency.py` /
`account_move_line.py` lus en détail à ce moment-là) : `debit`/`credit`/`balance`/
`amount_residual` sur `account_move_line` — le grand livre — restent **toujours** dans la
devise de l'entreprise (intégrité comptable non négociable), un nouveau champ
**`amount_currency`** mémorise le montant en devise **d'origine** du document, et le taux
(`invoice_currency_rate`, figé sur le move à sa création, jamais recalculé) sert de facteur de
conversion. En revanche `account_move.amount_untaxed`/`amount_tax`/`amount_total`/
`amount_residual` restent dans la devise **du document** — même convention que `devis.total`
depuis l'étape 2, pour la cohérence : ces champs d'en-tête décrivent « ce qui a été facturé »,
pas une écriture comptable individuelle.

- **Schéma** : `account_move.devise TEXT`, `account_move.invoice_currency_rate NUMERIC(18,8)`
  (tous deux nullables — `1` par défaut/absence, transparent pour toute facture déjà en devise
  entreprise) ; `account_move_line.amount_currency NUMERIC(16,2)`.
- **`utils/accountMove.js:posterMove`** : lit `invoice_currency_rate` sur le move (`1` si
  absent), multiplie chaque montant document-devise (`sub`, taxe, `totalTTC`) par ce taux pour
  obtenir les `debit`/`credit`/`balance` en devise entreprise, tout en conservant le montant
  brut (signé) dans `amount_currency`. `amount_untaxed`/`amount_tax`/`amount_total` restent
  calculés sans conversion (comme avant) — c'est la même arithmétique document-devise
  qu'auparavant, juste étiquetée différemment maintenant que la distinction existe. La
  vérification Σdébit=Σcrédit reste valide sans changement : multiplier chaque ligne par le
  même taux préserve l'égalité.
- **`utils/accountMove.js:enregistrerPaiementMove`** : `amount` reçu est dans la devise **du
  document** (comme `amount_residual`, auquel il est comparé) ; converti en `montantCompany`
  (`= amount × invoice_currency_rate`, **le taux figé de la facture d'origine, pas celui du
  jour du paiement** — assumé pour cette étape, l'écart de change étant l'étape 4) pour les
  lignes de trésorerie/partenaire et pour `lettrerLignesPartenaire` (qui opère sur des résidus
  déjà en devise entreprise). Le miroir `finances` (`syncFacturePaiement`) reçoit lui aussi
  `montantCompany`, jamais le brut — `finances` est un registre en devise entreprise comme
  tous ses autres appelants.
- **`routes/devis.js:facturer`** : le blocage de l'étape 2 est retiré ; le taux figé du devis
  (`COALESCE(taux_change, 1)`) est lu et propagé à l'`INSERT INTO account_move` (`devise`,
  `invoice_currency_rate`). Les deux appels `syncDevisPaiement` (paiement complet immédiat et
  paiement d'échéance individuelle) sont corrigés pour convertir leur montant en devise
  entreprise avant écriture dans `finances` — **oubli qui aurait silencieusement écrit un
  montant brut en devise étrangère dans un registre censé être en devise entreprise**, trouvé
  en relisant le code plutôt qu'en testant (les tests existants ne pouvaient pas le révéler,
  aucun devis en devise étrangère n'avait jamais été facturé avant cette étape).
- **`routes/factures.js`** : `MOVE_COLUMNS` gagne `devise`/`invoiceCurrencyRate`/
  `amountTotalDeviseEntreprise` (calculé) ; les lignes gagnent `amountCurrency`. 3 requêtes
  (liste, `aged-receivable`'s move n'en a pas besoin, `overdue`, détail) ajustées pour joindre
  `entreprises e` (nécessaire pour le `COALESCE(m.devise, e.devise)`).
- **1 test remplacé, pas juste ajouté** : l'ancien test de l'étape 2 (« facturer en devise
  étrangère → 400 ») échouait désormais légitimement (le blocage a été retiré exprès) — le
  premier signal, très net, que le reste de la suite (70 autres tests) n'avait subi aucune
  régression. Remplacé par un test bout-en-bout complet : facturation + paiement immédiat d'un
  devis de 100 € → move posté/équilibré/soldé, `amountTotal` du move toujours 100 (devise
  document), grand livre vérifié à 100 × taux (devise entreprise, équilibré), ligne produit
  vérifiée sur `amountCurrency` ET `balance`, `finances` vérifié converti. **317/317 tests
  d'intégration verts** (zéro régression sur `factures.test.js`, `factureHash.test.js`,
  `factureAvoir.test.js`, `paiements.test.js`, `agedReceivable.test.js` — la valeur par défaut
  `invoice_currency_rate = 1` rend tout le nouveau code arithmétiquement transparent pour
  l'existant).
- **Frontend** : `FacturesModule` (liste + détail) affiche désormais le montant dans la devise
  de la facture (colonnes Total HT **et** Total TTC de la liste, corrigées toutes les deux —
  la première n'avait pas été vue au premier passage, trouvée en vérifiant dans le navigateur
  et corrigée dans la foulée) + une ligne « ≈ équivalent devise entreprise » sur le détail,
  même patron que `DevisModule` à l'étape 2. **Même limite connue et assumée qu'à l'étape 2** :
  les sous-tableaux du détail (lignes de facture, échéances, paiements) affichent encore la
  devise de l'entreprise partout — seuls les montants d'en-tête (HT/TTC/payé/reste dû) sont
  corrects dans les deux devises.
- **Vérifié en conditions réelles** (vrai appel à l'API de taux, pas de mock) sur une
  entreprise jetable : client facturé en EUR, devis de 100 € facturé et payé intégralement en
  un seul appel → move `INV/2026/0001` posté, `paymentState:'paid'`, `amountResidual:0`,
  `amountTotal:100` (devise document) ; grand livre relu directement (`GET /api/factures/:id`)
  — ligne produit `credit:65595.64` / `amountCurrency:-100`, ligne créance `debit:65595.64` /
  `amountCurrency:100`, Σdébit=Σcrédit=65595,64 F CFA (= 100 × 655,95639501, le vrai taux du
  jour) ; `finances` vérifiée à 65595,64 F CFA (pas 100). Confirmé à l'identique dans le
  navigateur (liste et détail de `FacturesModule` affichant « 100,00 € » partout en en-tête,
  « ≈ équivalent devise entreprise 65 596 F CFA »). Entreprise de test nettoyée.

### 2026-09-06 — Multi-devise réel, étape 4 (écart de change au paiement) — roadmap COMPLETE

Dernière étape de la roadmap multi-devise (étapes 1-3 ci-dessus). Reconnaît la différence
entre le taux figé à la facturation (`invoice_currency_rate`) et le taux réel au jour du
paiement, et poste automatiquement l'écriture d'équilibrage correspondante — sans aucun
nouveau paramètre de route ni changement frontend : `enregistrerPaiementMove` regarde le
`paymentDate` déjà transmis par `POST /api/factures/:id/register-payment` et convertit à ce
taux.

- **Schéma** : deux nouveaux comptes par défaut dans `COMPTES_DEFAUT`
  (`server/src/utils/comptaDefauts.js`) — `768000 Gains de change` (`income_other`) et
  `668000 Pertes de change` (`expense_other`), codes 6xx/7xx pour rester distincts du plan
  4xx/5xx existant. `migrate.js:seedComptesChangeForExistingEntreprises()` — backfill dédié
  (le garde-fou de `seedComptaConfigForExistingEntreprises` ne se redéclenche jamais pour une
  entreprise déjà passée par l'étape 2 Comptabilité, donc virtuellement toutes) —
  `ON CONFLICT DO NOTHING`, idempotent. Migration rejouée sur la base dev :
  `✅ Comptes Gains/Pertes de change créés pour 7 entreprise(s) (14 lignes).`
- **`server/src/utils/accountMove.js`** : `enregistrerPaiementMove` calcule désormais
  `tauxReglement` via `convertir(1, mv.devise, mv.entrepriseDevise, pdate)` (réutilise
  `currencyRates.js` de l'étape 1) chaque fois que `mv.devise !== mv.entrepriseDevise` —
  `tauxFacture` (figé) reste utilisé pour le lettrage contre la facture (jamais rouvert),
  `tauxReglement` (du jour du paiement) pour la trésorerie réelle encaissée/décaissée.
  `ecart = round2(montantCompanyFacture - montantCompany)` ; si `|ecart| > 0.01`, nouvelle
  fonction `enregistrerEcartChange` poste une écriture à 2 lignes fermant le résidu laissé
  sur la ligne partenaire du paiement par le lettrage au taux facture : une ligne sur le
  compte `Clients`/`Fournisseurs` (même compte que la facture) et une ligne en face sur
  `Gains de change` ou `Pertes de change`.
- **Bug de sens trouvé et corrigé par débogage empirique, pas par relecture** : la première
  version dérivait `estGain = line1Credit > 0`, ce qui s'est avéré inversé — vérifié en
  conditions réelles (entreprise jetable, client EUR, facture 100 € au taux 655,95639501,
  paiement à un taux inséré manuellement en base à 717,647 — devise EUR appréciée) : la
  trésorerie reçoit bien 71764,71 F CFA pour 100 €, plus que les 65595,64 F CFA inscrits au
  bilan → c'est un GAIN, mais le code initial le classait en `668000 Pertes de change`.
  Root cause : quand la ligne 1 (résidu sur le compte partenaire) est un DÉBIT
  (`line1Balance > 0`), cela ferme un excédent de crédit laissé par un règlement ayant
  converti en PLUS de devise entreprise que prévu → c'est un gain, pas l'inverse. Corrigé en
  `estGain = line1Debit > 0` (équivalent à `line1Balance > 0`) ; vérifié par substitution
  symbolique que ce sens est cohérent aussi bien pour une vente que pour un achat (rôles de
  gain/perte inversés selon `estVente`, déjà pris en compte par le signe de `ecart` en amont).
- **3 nouveaux tests** dans `devis.test.js` (`describe('écart de change au paiement', ...)`) :
  taux du paiement plus élevé (devise appréciée) → gain de change + facture soldée ; taux plus
  bas (devise dépréciée) → perte de change ; taux inchangé (même devise, ou taux identique) →
  aucune écriture de change créée. **320/320 tests d'intégration verts** (317 + 3, zéro
  régression — le chemin `mv.devise === mv.entrepriseDevise` ne touche jamais
  `enregistrerEcartChange`, donc toutes les factures mono-devise existantes restent
  arithmétiquement inchangées).
- **Vérifié en conditions réelles** contre le backend Docker reconstruit, avec un vrai taux
  inséré en base (pas seulement les tests mockés) : script Node autonome
  (`fetch()` natif, contournant un souci d'interopérabilité chemins `/tmp` Bash↔Node sous
  Windows rencontré en cours de route) rejouant inscription → contact EUR → devis 100 € →
  validation → facturation échelonnée → paiement à un taux futur contrôlé — écriture d'écart
  relue directement en base (`account_move`/`account_move_line` join `account_account`),
  confirmée équilibrée et sur le bon compte après correction. Entreprises/utilisateurs/taux de
  test nettoyés (2 entreprises jetables, cascade + `finances` NO ACTION nettoyée à la main,
  comme documenté pour les nettoyages précédents).
- Pas de rejouement complet de migration en cycle restauration-sauvegarde pour cette étape
  (jugé pragmatiquement à faible risque : ajout pur, aucun `ALTER` destructeur) — seule une
  application directe sur la base dev a été faite. À faire avant la prochaine vraie mise en
  production si ce n'est pas déjà fait entre-temps.

### 2026-09-06 — Transformation agroalimentaire + HACCP, étape 1 (recettes)

Dernier item « Won't have » du MoSCoW jamais commencé, choisi explicitement par l'utilisateur
après confirmation que le MVP (Must/Should/Could-have) est désormais entièrement livré (en
route, a aussi corrigé une note obsolète du MoSCoW : « exportable reports » était en fait déjà
construit — `ReportsModule`, CSV+PDF — juste jamais marqué comme fait). Recherche menée avant
implémentation (plan validé via `EnterPlanMode`/`ExitPlanMode`) : le clone local de l'ERP de
référence a un module `mrp` (Manufacturing) complet et directement transposable
(`mrp_bom.py`/`mrp_production.py`), mais aucun module Quality/HACCP dans la source
communautaire (Enterprise-only chez Odoo) — le futur registre HACCP sera donc conçu sur
mesure, comme la météo et l'agriculture de précision avant lui.

Roadmap en 3 étapes (seule l'étape 1 construite cette session) :
- **Étape 1 (cette session)** : recettes de transformation — référentiel pur, zéro impact
  stock.
- **Étape 2 (différée)** : ordres de transformation — consomme les ingrédients / produit
  l'article fini, répercuté sur le stock réel via une extension de `stockSync.js` (nouveaux
  kinds `transformation_conso`/`transformation_prod`, nouvel emplacement virtuel
  `production` — CHECK `emplacements_stock.type` à étendre, même idiome que l'ajout du module
  Pisciculture), + un nouveau `stock_lots` pour le lot de sortie, + tags FK légers (pas de vrai
  FIFO — même philosophie que `[[project_tracabilite_parcelle_vente]]`, déjà tranchée) sur les
  lots de matière première consommés.
- **Étape 3 (différée)** : registre HACCP — points de contrôle sanitaires liés à un ordre de
  transformation, exportable (même patron que `ReportsModule`).

**Étape 1 — schéma** (`migrate.js`, juste après le bloc `applications_intrants` de l'étape C
« élargissement stock ») : `produit_recettes` (`produit_sortie_id` → `produits`, `ON DELETE
CASCADE` — un produit fini catalogué comme un autre, aucun 4e module nécessaire, la
transformation est transverse à Cultures/Poulailler/Pisciculture ; `quantite_produite` = le lot
de référence de la recette, comme `mrp.bom.product_qty`) + `produit_recettes_lignes`
(`produit_id` → `produits`, **`ON DELETE RESTRICT`** — contrairement à `produit_sortie_id`, un
ingrédient encore référencé par une recette ne doit pas disparaître silencieusement à la
suppression du produit, cohérent avec la 23503 déjà en place sur `produit_categories`).

**Route** `server/src/routes/produitRecettes.js` (`/api/produit-recettes`) : mirroring exact du
patron en-tête + lignes de `listesPrix.js` — `GET /` (filtrable `?module=`, jointure produit +
COUNT lignes), `POST`/`PUT`/`DELETE /:id` (writes `requireRole('admin','directeur')`, même
gate que les autres référentiels de configuration), `GET/POST /:id/lignes`, `DELETE
/lignes/:ligneId` (jointure `USING produit_recettes` pour le cloisonnement, même idiome que
`DELETE /listes-prix/lignes/:id`). `DELETE` vérifie systématiquement `rowCount`/`rows.length`
→ 404 (la classe de bug déjà documentée partout ailleurs dans le projet, évitée dès l'écriture
plutôt que trouvée après coup cette fois).

**Frontend** : nouveau `src/components/ProduitRecettesPanel.jsx`, panneau pliable calqué sur
`ProduitTemplatesPanel.jsx` (même style, mêmes couleurs), monté dans `StocksTab` juste après
`<ProduitTemplatesPanel module={moduleType} categories={categories} />` — les recettes sont un
référentiel de configuration du stock, au même endroit que les gabarits de produits. Le
sélecteur d'ingrédient exclut le produit de sortie de la recette courante (on ne peut pas
utiliser le produit fini comme son propre ingrédient). i18n `recettes.*` fr/en.

**Tests** : 5 nouveaux tests d'intégration (`produitRecettes.test.js`) — CRUD complet
recette+lignes, `produitSortieId` manquant/hors entreprise → 400, ligne avec produit hors
entreprise → 400, recette/ligne inexistante → 404, gate de rôle (ouvrier lit mais n'écrit pas),
isolation locataire. **325/325 tests d'intégration, zéro régression** (320 + 5 nouveaux).

**Incident d'environnement (pas un bug de code) découvert en vérifiant la migration** : lancer
`node src/db/migrate.js` directement depuis l'hôte a échoué avec « la colonne
« banque_principale_id » ... n'existe pas » — piste initialement troublante puisque cette
colonne existe bel et bien sur la base Docker. Cause réelle : `server/.env` a `DB_PORT=5432`
(le port **interne au conteneur**, documenté dans CLAUDE.md comme correct pour le trafic
backend→db à l'intérieur du réseau Compose) — exécuté depuis l'hôte Windows, le port 5432
local pointe vers le **Postgres natif Windows** (un tout autre service, indépendant de Docker,
avec son propre jeu de données plus ancien/incomplet), pas vers le conteneur `db` (exposé sur
le port hôte 5433). La procédure documentée (`docker exec agri-app-backend-1 node
src/db/migrate.js`) a été utilisée à la place — succès, tables créées. Leçon reconfirmée :
ne jamais lancer `migrate.js` nu depuis l'hôte sur cette machine, toujours via `docker exec`
(ou avec `DB_PORT=5433` explicitement exporté).

**Vérifié en conditions réelles** dans le navigateur (backend + frontend Docker reconstruits) :
entreprise jetable, panneau ouvert, recette créée (« Poudre d'oeufs » → Œufs frais, un des
produits seedés par défaut), ligne d'ingrédient ajoutée (Aliment ponte × 3, le produit de
sortie correctement exclu du sélecteur), ligne supprimée. La suppression de la recette
elle-même n'a pas été vérifiée en clic réel (le `window.confirm()` — même patron que
`ProduitTemplatesPanel`/`PaymentTermsPanel` — a gelé l'onglet d'automatisation du navigateur,
limitation connue de l'outillage, pas un bug de l'app) mais est couverte par les tests
d'intégration au niveau API. Entreprise/utilisateur de test nettoyés après coup.

### 2026-09-06 — Transformation agroalimentaire + HACCP, étape 2 (ordres de transformation)

Exécute réellement une recette (étape 1) : consomme les ingrédients, produit l'article fini,
crée un lot de sortie — le stock réel bouge, contrairement à l'étape 1 qui n'était qu'un
référentiel. Une action unique (pas de brouillon/validé), mirroring `applications_intrants` :
un ordre = une exécution immédiate, annulable par `DELETE` (undo complet).

- **Nouveau 5e emplacement virtuel `production`** (`emplacements_stock.type`) : les ingrédients
  y transitent à la consommation (`interne`→`production`), l'article fini au moment de sa
  production (`production`→`interne`) — symétrique du couple `perte`/`restitution` déjà en
  place pour les intrants phytosanitaires. `emplacements_stock_type_check` étendu (DROP+ADD
  idempotent, même idiome que `produits_module_check` pour Pisciculture) ; nouveau backfill
  dédié `seedEmplacementProductionPourEntreprisesExistantes` (le garde-fou de
  `seedEmplacementsStockForExistingEntreprises` — NOT EXISTS *aucun* emplacement — ne se
  redéclenche jamais pour une entreprise déjà seedée, même idiome que
  `seedComptesChangeForExistingEntreprises` de l'étape 4 multi-devise). Migration rejouée :
  `✅ Emplacement « Production » créé pour 7 entreprise(s).`
- **`server/src/utils/stockSync.js`** : 4 nouveaux kinds dans `CONFIG_MOUVEMENT`, symétriques
  deux à deux comme `reception`/`retour_achat` et `consommation`/`restitution` — `transformation_conso`
  (`interne`→`production`, fait), `transformation_restitution` (`production`→`interne`,
  annule — undo de la consommation), `transformation_prod` (`production`→`interne`, fait),
  `transformation_retrait` (`interne`→`production`, annule — undo de la production). 4
  nouvelles fonctions exportées (`consommerIngredientTransformation`/
  `restituerIngredientTransformation`/`produireSortieTransformation`/
  `retirerSortieTransformation`), même forme que `consommerProduit`/`restituerProduit` déjà en
  place pour les intrants.
- **Schéma** : `ordres_transformation` (`recette_id`/`produit_sortie_id` FK nullable `ON
  DELETE SET NULL` + colonnes texte snapshot `recette_nom`/`produit_sortie_nom` — une pièce de
  traçabilité doit survivre à la suppression de la recette/du produit en amont, même patron
  que `applications_intrants`) + `ordres_transformation_lignes` (snapshot de ce qui a été
  *réellement* consommé — peut différer de la recette si elle change après coup, nécessaire
  pour une annulation fidèle) + `ordres_transformation_lots_entrants` (tags légers des lots de
  matière première utilisés — Option 1, pas de vrai FIFO, même choix déjà tranché pour la
  traçabilité parcelle→vente ; backend seul, aucune UI de sélection construite dans cette
  passe pour rester dans un périmètre minimal).
- **`server/src/routes/ordresTransformation.js`** (`/api/ordres-transformation`) :
  `POST /` calcule `ratio = quantiteProduite / recette.quantiteProduite`, consomme chaque
  ligne (`ligne.quantite × ratio`, arrondi à 3 décimales), produit l'article fini, crée un
  `stock_lots` de sortie (`numero_lot` fourni ou auto `TR-<id>`). `DELETE /:id` annule tout :
  restitue les ingrédients, retire l'article produit, supprime le lot de sortie (rien d'autre
  ne peut encore le référencer). `GET /?module=` filtre sur le module du produit de sortie
  (survit même si la recette d'origine a été supprimée, puisque `produit_sortie_id` est
  conservé indépendamment). Writes gated `requireRole('admin','directeur')`.
- **Frontend** : `OrdresTransformationPanel.jsx`, panneau pliable dans `StocksTab` juste après
  `ProduitRecettesPanel` — formulaire d'exécution (recette/quantité/date/opérateur/n° de lot),
  liste des ordres passés avec détail dépliable (ingrédients consommés), annulation par
  corbeille. i18n `ordresTransformation.*`.
- **Bug réel trouvé par les tests, pas en relecture** : `stockSync.js:resoudreEmplacements`
  avait une liste `type IN ('interne', 'client', 'fournisseur', 'perte')` codée en dur, oubliée
  lors de l'ajout de `production` — `produits.quantite` (la valeur "disponible" affichée
  partout) restait correcte, mise à jour par `adjustStockRow` *avant* ce garde-fou, mais
  `stock_quants`/`stock_moves` (le journal structuré de traçabilité fine ajouté à l'étape 3 de
  l'alignement Odoo produit/stock) restaient silencieusement vides pour tout mouvement de
  transformation — le premier passage des tests avait vérifié `produits.quantite` et
  passait déjà, ce bug n'a été repéré qu'en ajoutant une assertion dédiée sur `stock_moves`/
  `stock_quants` (source/dest type, state). Corrigé en ajoutant `'production'` à la liste ;
  régression conservée dans les tests.
- **1 test existant mis à jour, pas juste ajouté** : `stockQuants.test.js` affirmait « 4
  emplacements créés : interne, client, fournisseur, perte » — cassure légitime et attendue
  (5e emplacement ajouté exprès), mis à jour pour attendre les 5.
- **5 nouveaux tests** (`ordresTransformation.test.js`) : exécution avec ratio (2× la recette)
  vérifiée sur `produits.quantite` ET sur `stock_moves`/`stock_quants` (la régression
  ci-dessus), annulation restitue tout + supprime le lot, validations (recette manquante/hors
  entreprise/sans ingrédient → 400), gate de rôle (ouvrier lit mais n'exécute pas), filtre
  `?module=` + isolation locataire. **330/330 tests d'intégration, zéro régression** (325 + 5
  nouveaux, 1 mis à jour).
- **Vérifié en conditions réelles** (backend + frontend Docker reconstruits, migration
  rejouée) sur une entreprise jetable : recette « Poudre d'oeufs » (Aliment ponte × 2 →
  1 Œufs frais), ordre exécuté pour une quantité produite de 3 → toast de succès, ligne
  d'ordre affichée avec le lot généré `TR-1`, détail dépliable montrant « Aliment ponte — 6 »
  (2 × 3, ratio correctement appliqué). Stock vérifié après rechargement de la page :
  Aliment ponte 12 → 6, Œufs frais 340 → 343 — conforme aux attentes. Note UX mineure
  observée et acceptée (pas corrigée, hors périmètre demandé) : la liste de stock de
  `StocksTab` ne se rafraîchit pas automatiquement après une exécution lancée depuis le
  panneau voisin, il faut recharger la page pour la voir — cohérent avec le comportement déjà
  existant des autres panneaux de cet écran. Entreprise/utilisateur de test nettoyés après
  coup.
- Étape 3 (registre HACCP) reste différée.

### 2026-09-06 — Transformation agroalimentaire + HACCP, étape 3 (registre HACCP) — roadmap COMPLETE

Points de contrôle sanitaires liés à un ordre de transformation (étape 2). Dernière étape de
la roadmap — conçue sur mesure, comme prévu (aucun module Quality/HACCP réutilisable dans la
source ERP de référence, Enterprise-only chez Odoo).

- **Schéma** : `haccp_controles` — `ordre_transformation_id` FK nullable `ON DELETE SET NULL`
  + colonne texte snapshot `ordre_transformation_nom` (`"<recette_nom> — <date_transformation>"`,
  figé à la création), même patron que `applications_intrants` (`produit_nom`/`parcelle_nom`) :
  une pièce réglementaire de traçabilité doit survivre à la suppression/annulation de l'ordre
  en amont. `type_controle` en CHECK fixe (`temperature`/`hygiene`/`tracabilite`/`autre`) —
  décision délibérée de ne pas construire un référentiel séparé pour ça, périmètre minimal.
  `conforme BOOLEAN NOT NULL DEFAULT TRUE` saisi explicitement par l'opérateur, jamais
  recalculé côté serveur depuis `seuil_min`/`seuil_max` : un contrôle « hygiène » n'a souvent
  aucune valeur numérique à comparer, contrairement à un contrôle « température ».
- **`server/src/routes/haccp.js`** (`/api/haccp`) : `POST /` valide que
  `ordreTransformationId` appartient à l'entreprise puis calcule le snapshot ; `GET /` accepte
  `?ordreTransformationId=`, `?conforme=true|false`, et `?module=` (jointure
  `ordres_transformation`→`produits.module`, même idiome que `GET /ordres-transformation?module=`
  — un contrôle dont l'ordre a été supprimé n'a plus de module résoluble et disparaît du
  filtre, mais reste visible sans filtre) ; `PUT /:id` ne touche que les métadonnées
  (valeur/seuils/conforme/action corrective/opérateur/notes), pas le lien vers l'ordre.
  **Toutes les routes sont `authRequired` seul, sans `requireRole`** — même posture que
  `applications_intrants` : un registre réglementaire de terrain, pas une action de
  configuration réservée aux admins.
- **Frontend** : `HaccpPanel.jsx`, panneau pliable dans `StocksTab` juste après
  `OrdresTransformationPanel` — badge rouge « N non conforme(s) » sur l'en-tête pliable dès
  qu'au moins un contrôle est non conforme, formulaire d'ajout (ordre/type/valeur/unité/
  seuils/conforme + action corrective si non conforme), tableau avec lignes non conformes
  surlignées, et un bouton d'export CSV (même technique `Blob`/`URL.createObjectURL` que
  `ReportsModule`). i18n `haccp.*` — piège corrigé avant tout test : les clés
  `"type.temperature"` etc. avaient été écrites comme des clés PLATES contenant un point
  littéral, alors que `t(\`haccp.type.${type}\`)` s'appuie sur la résolution par imbrication
  par défaut d'i18next (comme `reports.period.jour` déjà en place) — corrigé en un vrai objet
  imbriqué `"type": { "temperature": ..., "hygiene": ..., ... }`, avec le libellé de colonne
  renommé `typeLabel` pour éviter la collision entre "type" objet et "type" chaîne.
- **5 nouveaux tests** (`haccp.test.js`) : CRUD complet (création conforme → lecture → mise à
  jour en non-conforme + action corrective → suppression), validations (ordre/type manquants
  ou invalides, ordre hors entreprise → 400), **survivance du snapshot à l'annulation de
  l'ordre lié** (`DELETE /ordres-transformation/:id` puis relecture : `ordreTransformationId`
  devenu `null`, `ordreTransformationNom` toujours présent), filtres `?conforme=`/`?module=` +
  isolation locataire, gate de rôle ouvert (un ouvrier peut créer/lire/supprimer, comme
  `applications_intrants`). **335/335 tests d'intégration, zéro régression** (330 + 5
  nouveaux).
- **Vérifié en conditions réelles au niveau API** (backend Docker reconstruit, migration
  rejouée, script Node autonome avec `fetch()` natif — pas de mock) : recette → ordre exécuté
  → contrôle créé (`conforme:true`) → filtre par module confirmé → mise à jour en
  `conforme:false` + action corrective → filtre `conforme=false` confirmé. **Pas de
  vérification visuelle en navigateur cette fois** : l'extension Chrome de l'outillage était
  déconnectée pendant cette session et ne s'est pas reconnectée après deux tentatives — à
  refaire dès qu'elle est disponible, contrairement aux étapes 1 et 2 qui ont eu leur passage
  navigateur réel. Entreprise/utilisateur de test nettoyés après coup.
- **Roadmap transformation agroalimentaire + HACCP terminée** (3/3 étapes).

### 2026-09-06 — Refonte navigation : remplacement de la sidebar par le modèle Odoo

Demande explicite de l'utilisateur : auditer la taille des pages, l'emplacement des menus/
sous-menus, leur forme/dimensionnement/façon de s'ouvrir, **sans rien inventer, en se référant
au vrai code source d'un ERP de référence** (Odoo 19.0 community, clone local `erp-source`).
Une recherche dédiée (agent Explore, lecture directe du code) a extrait les mesures réelles :

- **Barre du haut** (`navbar.variables.scss`) : hauteur 46px, `padding-v: 0`, fond couleur de
  marque unie, `border-bottom` 1px (pas de `box-shadow`), items carrés (`border-radius: 0`),
  padding horizontal `.63em`, font-size 14px.
- **Menus déroulants** (`dropdown.js`, `bootstrap_overridden.scss`) : composant `Dropdown` —
  1er clic ouvre, survoler un autre déclencheur du même groupe pendant qu'un dropdown est
  ouvert bascule directement dessus (`handleMouseEnter`), aucune animation d'ouverture
  (`animation: false`), items `padding: 3px 20px`, `border-radius: 4px`, hover
  `rgba(0,0,0,.08)`, marge du panneau nulle sous la navbar.
- **Pas de sidebar persistante en desktop** (`webclient_layout.scss`, aucun `home_menu/`) —
  confirmé par absence totale de colonne latérale dans le layout. Mobile uniquement :
  panneau glissant `width: Min(360px, 80%)`, `transform: translateX`, `transition: transform
  .2s ease`.
- **Fil d'ariane** (`control_panel.xml`/`.scss`) : sous la navbar, fond blanc, `border-bottom`
  1px `#dee2e6`, padding `px-3 pt-2 pb-3` (16/8/16px), séparateur = simple `/`.
- **Largeur de page** (`webclient_layout.scss`) : aucune limite — plein viewport.

Constat central présenté à l'utilisateur : la sidebar gauche persistante de ce projet (choisie
fin août, mémoire `project_navigation_grouped_sidebar`, Option A préférée à un dropdown façon
Odoo) contredit directement ce modèle réel. Après présentation de l'audit via `AskUserQuestion`,
l'utilisateur a tranché : **« il faut tout remplacer par le modèle odoo sauf les couleurs »**.

**Implémentation** (`src/App.jsx` uniquement — tout vivait déjà dans ce fichier) :
- `SidebarNav` supprimée, remplacée par **`TopNavbar`** (barre 46px, `COLORS.green` au lieu du
  violet Odoo — seul écart de couleur — items épinglés en liens directs + un `Dropdown` par
  `NAV_CATEGORIES`, état `openCategory` géré au niveau du composant, `onMouseEnter` bascule
  entre catégories déjà ouvertes, listener `document click` pour la fermeture au clic
  extérieur — absent du "Plus" existant de `ModuleTabBar` mais ajouté ici vu la fréquence
  d'usage d'une navbar persistante) et **`MobileNavPanel`** (panneau glissant < 760px,
  `width: min(360px, 80vw)`, `transform`/`transition .2s ease` fidèles, réutilise la logique
  de regroupement pinned+catégories de l'ancienne sidebar).
- Fil d'ariane fusionné avec l'ancienne ligne « En ligne / dernière synchro » (une ligne au
  lieu de deux) : `NomCatégorie / NomOnglet actif`, padding/font-size/séparateur Odoo.
- `max-width: 1500px` retiré de `.app-shell`/`.dashboard-layout` — pleine largeur, comme la
  référence. `headerHeight`/`headerRef`/`ResizeObserver` (ne servaient qu'à l'offset sticky de
  la sidebar) supprimés, code mort.
- **Hors périmètre, explicité au plan avant exécution** : `ModuleTabBar` (barre pilule
  horizontale interne à un module — Ambiance/Suivi/Stocks/Ventes/Achats/Registre/Comptabilité)
  — l'audit portait sur la navigation de premier niveau, pas ce second niveau ; un
  remplacement fidèle imbriquerait ce niveau dans le même mécanisme de dropdown, un chantier
  bien plus profond touchant tous les modules, non demandé explicitement.
- **Bug trouvé et corrigé pendant la vérification navigateur, pas en relecture** :
  `overflowX: 'auto'` posé sur `.navbar-entries` (pour gérer un éventuel débordement sur
  fenêtre étroite) masquait silencieusement les panneaux déroulants des catégories — poser
  `overflow-x` sans poser explicitement `overflow-y` force ce dernier à devenir non-`visible`
  (règle CSS standard), ce qui clippait les dropdowns positionnés en absolu juste sous les
  boutons (visibles dans le DOM via `read_page`/JS direct, invisibles à l'écran). Diagnostiqué
  en comparant le nombre d'enfants du conteneur (`childCount: 2`, donc bien monté) à ce que la
  capture d'écran montrait (rien) — pas une hypothèse en l'air. Retiré ; les dropdowns
  débordent maintenant simplement au-delà du conteneur, sans clip.
- **Vérifié en conditions réelles** : `npx vite build` (succès), `npm test` (103/103, aucune
  régression), puis navigateur réel (serveur de dev + backend Docker déjà tournant) sur une
  entreprise jetable — ouverture/fermeture au clic d'un dropdown de catégorie, bascule au
  survol entre « Opérations » et « Analyse » sans reclic, fermeture au clic extérieur,
  navigation effective vers un onglet (fil d'ariane « Opérations / Cultures & irrigation »
  affiché correctement, onglet interne `ModuleTabBar` intact et fonctionnel), item épinglé
  (« Aide ») en lien direct sans dropdown, panneau mobile glissant sous 760px avec pied de
  page utilisateur/déconnexion (l'accès desktop à ces actions disparaissant en dessous de ce
  seuil). Entreprise/utilisateur de test nettoyés après coup (tables `contacts`/`parcelles`/
  `cultures`/`parcelles_historique` avaient des lignes issues des données de démo par défaut,
  nettoyées avec les noms de tables actuels — post-fusion produits/contacts, pas les anciens
  noms `clients`/`poulailler_stocks` évoqués par une note plus ancienne du projet).

### 2026-09-06 — Refonte navigation, correctif : largeur de page instable

Signalé par l'utilisateur juste après la refonte ci-dessus : la largeur de la page paraissait
« s'agrandir et se rétrécir » selon le nombre de lignes/colonnes d'un écran à l'autre.

**Cause réelle** : la grande majorité des tableaux de l'app (`className="data-table"`, une
vingtaine d'usages bruts dans 11 fichiers) sont rendus **sans** conteneur de défilement propre
— contrairement au composant partagé `DataTable` (`ui.jsx`), qui s'enveloppe déjà correctement
d'un `<div style={{overflowX:'auto'}}>`. Un tableau à beaucoup de colonnes poussait alors son
conteneur, puis `.dashboard-shell`, puis potentiellement `<body>`/`<html>`, à s'élargir au-delà
du viewport — d'où l'impression de largeur de page qui varie d'un onglet à l'autre.

**Fix choisi** : plutôt que d'auditer/corriger une vingtaine d'usages au cas par cas (risque de
manquer une instance, et cohérent avec la philosophie déjà documentée de `.data-table` — « une
seule classe partagée plutôt qu'un réglage au cas par cas »), un filet de sécurité posé une
seule fois au niveau des conteneurs de page : `.dashboard-shell { overflow-x: auto }` (tout
débordement horizontal reste local à la zone de contenu, avec sa propre barre de défilement —
donnée jamais coupée, juste scrollable) + `.app-shell { overflow-x: hidden }` (filet de sécurité
pour le reste — navbar, écrans d'authentification/onboarding — le corps de la page ne doit
jamais défiler horizontalement lui-même).

**Vérifié en conditions réelles** (dev server + backend Docker) sur une entreprise jetable :
- Fenêtre réduite à 884px puis 700px sur l'écran Factures (tableau à 8 colonnes) :
  `document.documentElement.scrollWidth === clientWidth` à chaque largeur (confirmé par script
  JS direct dans la page, pas une supposition) — la page elle-même ne défile jamais
  horizontalement, quelle que soit la largeur de fenêtre.
- Vérifié que le fix n'a **pas** réintroduit le bug de dropdown-clippé corrigé plus tôt dans la
  même session (`overflow-x` posé sans `overflow-y` force ce dernier non-`visible`) : le
  dropdown de catégorie de la navbar reste dans le DOM du `.app-shell`, dont la boîte s'étend
  sur toute la hauteur de la page — contrairement à l'ancien `.navbar-entries` qui n'avait que
  la hauteur d'une seule ligne de boutons, `.app-shell` est largement assez grand pour contenir
  un panneau positionné en absolu juste sous la navbar, donc aucun risque de clip ici. Confirmé
  par un clic réel sur « Opérations » après le fix : dropdown affiché normalement.
- `npx vite build` vert. Entreprise de test nettoyée.

### 2026-09-06 — Refonte navigation, correctif : menus visibles hors du tableau de bord

Signalé par l'utilisateur : sur l'écran « Choisissez vos options » (`/modules`, et par
extension les écrans d'onboarding), la barre verte affichait les menus (liens épinglés +
dropdowns de catégorie) — avant la refonte, ces écrans n'avaient jamais de menu du tout
(l'ancienne `SidebarNav` n'était montée que dans le bloc `{screen === 'dashboard' && ...}`,
jamais sur `/modules`/onboarding). En fusionnant l'ancien topbar (montré sur tous les écrans
sauf login) et l'ancienne sidebar (montrée sur le dashboard seul) dans un seul `TopNavbar`
monté sans condition d'écran, les menus se sont retrouvés visibles partout par erreur.

**Fix** : les entrées de menu (liens épinglés + dropdowns `NAV_CATEGORIES`) et le bouton
burger mobile ne se rendent plus que si `screen === 'dashboard'` — même condition que celle
déjà en place pour « Gérer les options »/la recherche. La marque (logo+nom) et le cluster
utilisateur/rôle/déconnexion restent visibles sur tous les écrans (comme avant la refonte).
Vérifié en navigateur réel (`localhost:8090` reconstruit) : écran `/modules` affiche bien la
barre verte réduite à la marque + utilisateur + déconnexion, sans aucun menu. `npm test`
(103/103) et `npx vite build` verts, zéro régression.

### 2026-09-06 — Navbar simplifiée (menu utilisateur) + grille d'accueil façon Odoo

Deux demandes de l'utilisateur : (1) « la barre verte a trop d'information » — recherche
menée dans le vrai code source d'un ERP de référence sur son menu utilisateur/systray avant
d'agir (comme pour tout le reste de ce chantier) ; (2) « une page d'accueil avec des menus en
carré » façon Odoo — vérifié honnêtement que ce plein-écran d'icônes carrées (le « Home Menu »)
**n'existe plus** dans la source Odoo 19.0 lue (remplacé par les dropdowns de navbar déjà
construits) — présent dans d'anciennes versions, pattern très répandu ailleurs. Décision de
l'utilisateur après clarification : remplacer l'Accueil actuel par la grille, en gardant le
tableau de bord chiffré comme une tuile parmi les autres (pas déplacé dans Finance, pour ne
pas enterrer des indicateurs non-financiers) ; chaque tuile fait aussi office
d'activation/désactivation de module.

**Recherche menu utilisateur (agent Explore, source Odoo 19.0)** :
- `user_menu.xml` : le bouton visible au repos est **l'avatar seul** — le bloc texte nom/email
  a `d-none` inconditionnel, seulement levé en mode debug d'Odoo (`t-att-class="{'d-lg-inline-
  block' : env.debug}"`). Aucun badge de rôle/groupe permanent trouvé nulle part dans la navbar.
- Tout le reste (préférences, raccourcis, déconnexion) vit dans `registry.category("user_menuitems")`,
  un menu déroulant caché tant qu'on n'a pas cliqué l'avatar.
- Recherche globale : pas d'icône permanente — `hotkeyService.add("control+k", openMainPalette, ...)`,
  seulement mentionnée en texte (avec le raccourci clavier) dans le menu déroulant.

**Fix navbar** (`TopNavbar`) : les 5 éléments permanents (Gérer les options / icône recherche /
email complet / badge rôle / icône déconnexion) remplacés par **un seul bouton avatar**
(cercle avec l'initiale de l'email, pas de vraie photo dans cette app) ouvrant un menu
déroulant (état `avatarOpen`, même mécanisme de fermeture au clic extérieur que les dropdowns
de catégorie) contenant : email + rôle en en-tête, puis Gérer les options/Rechercher (Ctrl+K
continue de fonctionner au clavier sans changement, juste sans icône permanente)/Se déconnecter.

**Grille d'accueil** (`HomeGrid`, remplace `HomeOverview` comme contenu de l'onglet `accueil` —
`HomeOverview` reste intact, accessible via une nouvelle tuile/onglet `tableaubord` sous
Analyse) : deux sources combinées pour ne jamais afficher un module en double —
`HOME_MODULE_TILES` (modules activables : cultures/poulailler/pisciculture/clients/
fournisseurs/employees/finances/notifications, **toujours affichés qu'ils soient actifs ou
non**, contrairement à `availableTabs` qui omet purement et simplement un module désactivé) +
le reste d'`availableTabs` par catégorie pour les destinations sans notion d'activation. Une
tuile désactivée : dimmed + badge « À activer » ; clic = active le module (`onToggle`, même
fonction que `ModulesScreen`) **puis** navigue directement en un seul clic, plutôt que
d'exiger un aller-retour par « Gérer les options ».

**Bug trouvé pendant la vérification (pas en relecture)** : clé i18n `home.general`/
`home.activer` ajoutée dans un **second bloc `"home"` dupliqué** au niveau racine des JSON
fr/en — `JSON.parse` accepte silencieusement des clés dupliquées en gardant la dernière
occurrence, donc mon bloc était écrasé par le namespace `home.*` déjà existant
(`cardRevenue`/`cardExpenses`/... de `HomeOverview`) placé plus loin dans le fichier. Les
tuiles affichaient littéralement la clé brute (`HOME.GENERAL`, `home.activer`) au lieu du
texte traduit. Fusionné dans le bloc existant plutôt que dupliqué ; vérifié qu'il ne reste
qu'une seule occurrence de `"home": {` dans chaque fichier.

**Vérifié en conditions réelles** (dev server + backend Docker, entreprise jetable) : menu
avatar ouvre/ferme correctement (email+rôle+déconnexion sur `/modules`, + Gérer les
options/Rechercher sur le dashboard) ; grille d'accueil affiche les sections (Général/
Opérations/Analyse/Commercial/RH) avec les bons badges « À activer » sur les modules
désactivés ; clic sur une tuile désactivée (Cultures) → active le module + navigue directement
vers Cultures en un seul clic, sans déconnexion, dans un vrai parcours SPA (un premier essai de
vérification via rechargement direct d'URL profonde par l'outil de test avait provoqué une
fausse déconnexion — confirmé comme un artefact du contournement de l'initialisation normale
de l'app, pas un bug réel, en répétant le même clic dans un parcours normal). `npm test`
(103/103) + `npx vite build` verts. Entreprise de test nettoyée, image Docker reconstruite.

### 2026-09-06 — Correctif : hauteur de page instable selon le nombre de lignes

Signalé par l'utilisateur : en changeant de sous-onglet (ex. Ventes avec beaucoup de lignes →
Achats avec deux ou trois lignes), la page « se met au même niveau que les lignes » — la
hauteur visible varie selon le contenu au lieu de toujours occuper au moins la fenêtre entière,
donnant une impression de taille de page instable (distinct du fix de largeur du même jour).

**Cause** : `.app-shell` (le conteneur racine de tout l'écran, sous la navbar) avait
`minHeight: 480` (480px, une valeur bien plus petite qu'un écran réel) et aucune contrainte
liée à la hauteur du viewport — une page avec peu de contenu se contentait donc de sa hauteur
naturelle, laissant apparaître le fond de `<body>`/`#root` en dessous (`#root` a bien son
propre `min-height: 100svh` dans `index.css`, mais ça ne suffit pas : c'est `.app-shell`,
l'enfant avec son propre fond `COLORS.bg`, qui doit lui-même être contraint pour que ce fond
remplisse visuellement tout l'espace).

**Fix** : `minHeight: 480` → `minHeight: '100svh'` sur `.app-shell` (`100svh` plutôt que
`100vh`, cohérent avec la valeur déjà utilisée par `#root` dans `index.css` — plus sûr sur
mobile où la barre d'adresse peut apparaître/disparaître).

**Vérifié en conditions réelles** par mesure directe (pas une supposition) : sur un onglet
court (Achats, formulaire simple sans grand tableau), `document.documentElement.scrollHeight
=== window.innerHeight` exactement — la page remplit toute la fenêtre, ni plus ni moins ; sur
un onglet long (Ventes, devis multi-lignes), le contenu dépasse naturellement la fenêtre sans
être contraint (`appShellHeight > innerHeight`), confirmant que le `min-height` n'écrase pas
le contenu réellement long. `npm test` (103/103) + `npx vite build` verts. Entreprise de test
nettoyée, image Docker reconstruite.

### 2026-09-06 — Renommage « Profil » → « Mes préférences » + mise en grille des 3 cartes

Deux demandes de l'utilisateur sur le menu « Profil » : un nom jugé peu clair (« je pense
qu'il doit y avoir une autre appellation »), et les 3 cartes de la page (Préférences /
Localisation météo / Sécurité du compte) empilées verticalement alors qu'un affichage côte à
côte serait plus lisible. Une première tentative de compréhension du second point s'est
trompée de cible (le menu déroulant avatar, à 3 entrées) — corrigée par l'utilisateur (« je
parle juste du menu "Profil" et de son contenu »), confirmant qu'il s'agissait bien des 3
cartes de `ProfilModule`.

**Nom** : vérifié dans le vrai source Odoo (`user_menu_items.js`, `_t("My Preferences")`) —
c'est exactement le nom qu'Odoo donne à cette page de réglages personnels. Renommé `nav.profil`
fr "Profil" → **"Mes préférences"**, en "Profile" → **"My Preferences"** ; `help.profil.title`
harmonisé de la même façon ("Mes préférences & sécurité" / "My Preferences & security") pour
rester cohérent avec la page Aide.

**Disposition** : question posée explicitement (grille côte à côte vs onglets façon Odoo, qui
sépare habituellement des sujets bien distincts en onglets de notebook plutôt qu'en grille) —
l'utilisateur a choisi la grille. `ProfilModule` : wrapper passé de
`{ display:'flex', flexDirection:'column', gap:16, maxWidth:480 }` à
`{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(280px,1fr))', gap:16,
alignItems:'start' }` — les 3 cartes s'alignent côte à côte sur un écran large et repassent en
colonne unique sur mobile via `auto-fit`, sans media query supplémentaire.

**Vérifié en conditions réelles** (entreprise jetable) : navbar + tuile d'accueil affichent
bien « Mes préférences » ; la page elle-même montre les 3 cartes (Préférences / Localisation
(météo) / Sécurité du compte) alignées côte à côte en une seule ligne sur un écran 1600px de
large. `npm test` (103/103) + `npx vite build` verts. Entreprise de test nettoyée, image Docker
reconstruite.

### 2026-09-06 — Inscription entreprise : confirmation par code + profil entreprise complet

Chantier demandé après une comparaison avec le vrai flux d'inscription/création de base
d'Odoo (`odoo/addons/base/models/res_company.py`, `addons/web/controllers/database.py`,
`addons/auth_signup`) : Odoo n'a pas de « création d'entreprise » comparable (une base
PostgreSQL = un tenant, modèle mono-tenant), mais son formulaire de création de base
collecte pays/téléphone en plus du nom/langue/email/mot de passe, et `res.company` porte en
plus adresse complète/TVA (`vat`)/n° d'immatriculation (`company_registry`, l'équivalent du
SIRET). Comparaison faite avec `LoginScreen`/`auth.js:register` : ni pays, ni téléphone, ni
adresse (colonne existante mais jamais collectée nulle part, ni à l'inscription ni ensuite),
ni email de confirmation (`sendWelcomeEmail` existe mais n'est utilisé que pour la création
de compte salarié RH, jamais pour l'auto-inscription). Clarification importante donnée à
l'utilisateur : ne pas copier l'**architecture** d'Odoo (une base par entreprise ne convient
pas au modèle multi-tenant déjà en place et éprouvé) — seulement ses **champs/fonctionnalités**.
Décisions utilisateur : (1) confirmation par **code reçu par email plutôt qu'un lien
cliquable** (« double opt-in mais en demandant d'insérer le code reçu par mail ») ; (2)
pays/téléphone/TVA/adresse **obligatoires pour un compte 'entreprise'**, facultatifs pour
'particulier' — même traitement que le SIRET déjà en place.

**Confirmation par code** : réutilise telle quelle la dérivation HOTP existante
(`utils/mfaCode.js:generateEmailCode`/`verifyEmailCode`, déjà utilisée pour le MFA email —
jamais stocké, expire en 10-20 min), pas de nouveau mécanisme. Nouvelle colonne
`entreprises.email_confirme BOOLEAN NOT NULL DEFAULT TRUE` — le défaut `TRUE` protège toutes
les entreprises déjà inscrites, seules les nouvelles inscriptions démarrent à `FALSE`.
`POST /register` crée le compte comme avant (même transaction, mêmes seeds) mais ne renvoie
plus de token : `{ confirmationRequired: true, email }`, après avoir envoyé le code (best-
effort, comme `sendMfaCodeEmail` au login — un échec d'envoi ne bloque pas l'inscription).
Nouveaux `POST /confirmer-inscription` (email+code → active le compte, renvoie
`{token,user,entreprise}`) et `POST /renvoyer-code-inscription` (réponse `{ok:true}`
volontairement identique que le compte existe ou non, anti-énumération comme le reste du
login). `POST /login` gagne le même garde-fou : si `email_confirme=false`, renvoie
`{ confirmationRequired: true }` au lieu de connecter — pour le cas où l'utilisateur ferme
l'onglet avant de saisir le code et revient se connecter normalement plus tard ; le
rattachement `entreprise_utilisateurs.statut='Actif'` n'est lui jamais touché, donc aucun
risque de confusion avec le mécanisme de désactivation d'un employé (deux concepts
distincts, deux colonnes distinctes).

**Profil entreprise complet** : nouvelles colonnes `entreprises.telephone`/`pays`/
`numero_tva` (distinct du SIRET). Nouvelle constante `PAYS` dans `src/lib/locale.jsx` (liste
ISO ~120 pays, code+libellé FR, aux côtés de `DEVISES`/`LOCALES` — l'app cible tous les
continents, pas de liste régionale courte). Ces 4 champs, devenus obligatoires à
l'inscription pour un compte entreprise, doivent rester corrigibles ensuite : nouvelle carte
« Informations de l'entreprise » dans Mes préférences (nom/SIRET/TVA/adresse/téléphone/pays,
lecture pour tous les rôles, édition admin uniquement), branchée sur `PUT /api/entreprise`
(déjà existant, étendu pour accepter les 3 nouveaux champs) — referme au passage l'écart
trouvé lors de la comparaison (`adresse`/`secteur` étaient acceptés par l'API sans qu'aucun
écran ne les affiche).

**Frontend** : `LoginScreen` gagne un champ « Confirmez le mot de passe » (validation côté
client, mismatch → message dédié) et, pour le type « Entreprise » uniquement, adresse/
téléphone/TVA/pays (marqués requis, absents pour « Particulier »). Nouvel écran « Confirmez
votre inscription » (code à 6 chiffres + bouton renvoyer), même patron visuel que l'étape MFA
déjà en place — déclenché aussi bien juste après l'inscription qu'après une tentative de
connexion normale sur un compte encore non confirmé.

**Tests** : le helper d'intégration partagé `registerEntreprise` (utilisé par ~40 fichiers de
test) confirme désormais directement en base (`email_confirme=TRUE`) plutôt que de dériver le
code HOTP — plus simple, cohérent avec `setEntrepriseSubscription` qui fait déjà des
écritures directes pour les besoins des tests — puis se reconnecte pour obtenir un token
(`/register` n'en renvoie plus). Nouveaux tests dédiés dans `auth.test.js` couvrant le vrai
cycle (mauvais code → 401, bon code dérivé via `generateEmailCode` → token, double
confirmation → 400, login avant confirmation → `confirmationRequired`) + validation des
champs obligatoires par type de compte. 3 tests de `abonnement.test.js` (limite IP,
reCAPTCHA) mis à jour pour inclure les nouveaux champs obligatoires — un des trois passait
déjà « par accident » (mauvaise raison, bon statut HTTP) avant la correction.
**337/337 tests d'intégration, zéro régression** ; `npm test` (103/103) + `npx vite build`
frontend verts.

**Vérifié en conditions réelles** (deux entreprises jetables, une par type de compte) :
inscription complète type « Entreprise » avec les 4 nouveaux champs → écran de code →
compte introuvable avec un mauvais code → code dérivé côté serveur (via `generateEmailCode`
avec le vrai `JWT_SECRET`) → compte activé → connecté ; carte « Informations de
l'entreprise » pré-remplie avec les valeurs saisies à l'inscription, modification d'adresse
sauvegardée avec succès ; inscription type « Particulier » sans les 4 champs → inscription
abandonnée avant confirmation → tentative de connexion normale → bien redirigée vers le même
écran de code (filet de sécurité) → « Renvoyer le code » fonctionne → code dérivé → compte
activé. Entreprises de test nettoyées, images Docker backend + frontend reconstruites (les
deux nécessaires cette fois : le backend n'a pas de bind-mount, ses changements ne sont
jamais pris en compte sans rebuild — leçon déjà connue pour le frontend, maintenant valable
aussi côté backend).

### 2026-09-06 — Tarification par module (calcul de prix, sans blocage d'accès)

Chantier demandé après une comparaison de l'idée de l'utilisateur (prix par module × palier
pays + rabais « tous modules ») avec Odoo (forfait tout compris, a abandonné le à-la-carte) et
plusieurs ERP agricoles internationaux réels (FarmERP : devis sur mesure ; Agworld : paliers
de fonctionnalités nommés ; xFarm : prix par hectare ; Conservis : modules + surface — le
précédent le plus proche). Constat : personne dans ce marché ne publie de calculateur
self-service par module — l'idée de l'utilisateur est plus transparente que la concurrence,
pas une copie d'un modèle existant.

**Portée délibérément limitée** (choix explicite après une question de portée) : un calcul de
prix affiché + un montant suggéré côté platform-admin, **pas** un blocage d'accès module par
module — `subscriptionGuard` reste tout-ou-rien par entreprise, inchangé. Une vraie
implémentation d'accès bloqué par module toucherait le middleware + ~25 fichiers de routes,
jugé disproportionné pour une Phase 1 où l'activation reste de toute façon manuelle/hors-ligne.

**Grille de prix arrêtée avec l'utilisateur** (palier 4 fixé en premier à 17 $/mois pour les 3
modules, les autres paliers recalculés à partir de lui, puis arrondis) :

| Palier | Prix/module | Bundle (3 modules) |
|---|---|---|
| 1 — Revenu élevé | 70 $ | 168 $ |
| 2 — Revenu interm. sup. | 35 $ | 84 $ |
| 3 — Revenu interm. inf. | 15 $ | 36 $ |
| 4 — Revenu faible | 7 $ | 17 $ |

Seuls les 3 modules « activités agricoles » (cultures/poulailler/pisciculture) sont facturés à
l'unité — décision explicite de l'utilisateur pour garder une grille à 3 lignes plutôt que 8 ;
les 5 fonctions de gestion transverses (clients/fournisseurs/employees/finances/notifications)
restent incluses gratuitement dès qu'un module facturé est actif.

**Paliers pays** : classification Banque mondiale FY26/27 par RNB/habitant (recherche web en
direct, pas inventée), mappée sur les ~120 pays de `PAYS` (`src/lib/locale.jsx`, champ `palier`
ajouté à chaque entrée) — dupliquée côté serveur dans `server/src/utils/tarificationModules.js`
(`PALIER_PAYS`), même convention que les autres constantes partagées front/back du projet
(ex. `CATEGORIES_PRODUITS_PAR_DEFAUT`). Quelques cas non couverts par l'échantillon consulté
classés à dire d'expert (Seychelles/Arabie saoudite/Pologne/Mexique) ; le Liban placé en
palier 3 comme cas limite volontaire (crise économique, classification officielle mouvante).

**Bug réel trouvé pendant la vérification (pas en relecture) : `modules_actifs` jusqu'ici
100 % côté client.** En creusant l'implémentation, `toggleModule` n'écrivait que dans
`localStorage` (`storageSet`/`storageGet`, voir `utils/storage.js`) — jamais synchronisé au
serveur, jamais scopé par `entreprise_id`. Impossible de calculer un prix suggéré fiable côté
platform-admin sans ça. Nouvelle colonne `entreprises.modules_actifs JSONB DEFAULT '{}'` +
routes `GET`/`PUT /api/entreprise/modules` (`PUT` réservé `admin`/`directeur`, filtre les clés
inconnues et force des booléens — jamais un objet arbitraire écrit tel quel en JSONB).
`toggleModule` reste optimiste en local (inchangé) mais persiste désormais aussi côté serveur
en best-effort.

**Deuxième bug réel trouvé en vérification navigateur (pas en relecture) : le rafraîchissement
des modules depuis le serveur n'était branché que sur la restauration de session au
rechargement de page, pas sur un login classique.** Une connexion normale via `LoginScreen`
passe par `finalizeAuth`, un chemin de code différent de l'effet « token déjà en localStorage
au montage » où le fetch avait été ajouté en premier — un utilisateur qui venait de se
reconnecter voyait donc l'ancien état localStorage plutôt que l'état serveur réel, jusqu'au
prochain rechargement. Fixé en extrayant `refreshModulesActifs()` (fonction partagée) appelée
désormais des deux côtés.

**Nouvelles routes** : `GET /api/billing/tarifs` (route locataire — palier de l'appelant +
prix suggéré à partir de ses modules réellement actifs, converti dans sa devise via l'utilitaire
`currencyRates.js` déjà construit pour le multi-devise réel, repli silencieux sur le montant
USD brut si la devise est inconnue/l'appel réseau échoue) ; `GET /billing/entreprises/:id`
(platform-admin) étendu avec un `prixSuggere` identique, pré-remplissant (sans jamais forcer)
le champ montant du formulaire d'activation dans `BillingAdminPanel.jsx`.

**Frontend** : `ModulesScreen` affiche désormais un vrai prix par module (au lieu du texte
factice « Option incluse dans l'abonnement ») + un bandeau « Les 3 modules d'activité pour
X/mois au lieu du plein tarif » quand les 3 sont actifs.

**Tests** : nouveau `tarificationModules.test.js` (unitaire, fonction pure `calculerPrixUSD` —
paliers, bundle, modules non facturés toujours à 0, cohérence des tables de prix) + 6 tests
d'intégration dans `abonnement.test.js` (persistance/filtrage des modules, rôle gate PUT,
tarifs calculés correctement, `prixSuggere` de l'admin, isolation multi-tenant). **Piège de
test évité** : les nouveaux tests touchant la conversion de devise devaient mocker
`global.fetch` (même patron que `devis.test.js`/`devisesTaux.test.js`) — sans ça, le premier
appel non mocké de toute la suite déclenche un vrai appel réseau qui écrit de vrais taux dans
`currency_rates` pour la date du jour et casse les tests de devis/devisesTaux qui s'attendent
à leurs propres taux mockés (confirmé en le reproduisant, pas supposé). **343/343 tests
d'intégration, zéro régression** ; `npm test` (103/103) + build frontend verts.

**Vérifié en conditions réelles** (entreprise jetable, Mali → palier 4, promue platform-admin
temporairement pour la vérification puis dépromue par la suppression du compte) : formulaire
d'inscription → `ModulesScreen` affiche 3 954 F CFA/mois par module + bandeau bundle à
9 603 F CFA/mois (conversion USD→XOF réelle, taux du jour) ; activation d'un module → persisté
en base (`modules_actifs`) ; **après correction du bug de connexion classique** : l'état
« Activée » apparaît immédiatement après un login normal, plus seulement après un rechargement
de page ; panneau `Abonnements` (platform-admin) → détail de l'entreprise affiche bien
« Prix suggéré : 3 954 F CFA (1 module(s) activé(s), palier 4) » avec le formulaire
montant/devise pré-rempli. Entreprise de test nettoyée, images Docker backend + frontend
reconstruites.

**Révision du même jour** : l'utilisateur s'est renseigné sur un prix réel constaté au Mali
pour un ERP agricole comparable — 5 000 F CFA/module — contre 3 954 F CFA obtenus avec la
grille initiale (7 $/module, palier 4). Recalcul au taux du jour (1 $ ≈ 564,86 F CFA) :
5 000 F CFA ≈ 8,85 $, arrondi à 9 $ ; les 3 autres paliers recalculés au même facteur d'échelle
(×~1,26 par rapport à 70/35/15/7) puis arrondis par l'utilisateur. **Nouvelle grille :**
75 $/45 $/19 $/9 $ par module (paliers 1 à 4), bundle 180 $/108 $/46 $/22 $ (même règle de
remise ~20 % sur la somme des 3, dérivée mécaniquement, pas renégociée). Seuls
`PRIX_MODULE_USD`/`PRIX_BUNDLE_USD` dans `tarificationModules.js` ont changé — aucun autre
fichier touché, les tests (qui référencent ces constantes plutôt que des montants en dur)
restent verts sans modification. Vérifié : `calculerPrixUSD('ML', {poulailler:true})` →
9 $ (≈ 5 084 F CFA au taux du jour, l'écart de ~1,7 % vient de l'arrondi 8,85→9 accepté par
l'utilisateur) ; `npm test` (11/11 unitaires) vert ; image Docker backend reconstruite.

### 2026-09-07 — Blocage d'accès par module payant (suite de la tarification)

Chantier demandé comme suite logique du calcul de prix par module. Portée précisée avec
l'utilisateur avant de coder : jusqu'ici, `entreprises.modules_actifs` ne servait qu'à
calculer un prix affiché — un module désactivé n'empêchait rien réellement (le contrôle
d'accès `subscriptionGuard` existant ne connaît que l'entreprise dans son ensemble, pas la
notion de module). Ce chantier lui donne un vrai effet, sans toucher à `subscriptionGuard`.

**Découpage des ~44 groupes de routes montés (`app.js`)**, confirmé avec l'utilisateur avant
implémentation (un découpage erroné aurait soit cassé des fonctions gratuites, soit laissé des
trous) :
- **Modules payants** (bloqué si CE module précis est inactif) : `cultures`
  (+ `/planning`, `/recoltes`, `/applications-intrants`, `/precision` — logiquement rattachés
  bien que montés sous un préfixe différent), `poulailler`, `pisciculture`.
- **« Inclus dès qu'un module payant est actif »** (bloqué seulement si aucun des 3 n'est
  actif) : contacts, banques, finances, salariés/RH, devis/achats/factures/paiements, tout
  l'écosystème catalogue produit, comptabilité (taxes/journaux/comptes/conditions de
  paiement), transformation/HACCP, **et équipements** (décision explicite de l'utilisateur —
  pas un module à part avec son propre prix, juste rattaché à cette catégorie « any »).
- **Hors périmètre, jamais bloqué** : auth, entreprise, mfa, feedback, billing, devises,
  météo, observations, calendrier, recherche, activités, messages — jamais fait partie du
  système de modules payants, les bloquer serait un nouveau péage sur des fonctions jusqu'ici
  gratuites, pas l'application de la tarification existante.

**Mécanique** (`server/src/middleware/moduleGuard.js`), même patron que `subscriptionGuard.js`
(cache par process, TTL 60 s, invalidation explicite depuis `PUT /entreprise/modules`) :
lecture (GET/HEAD/OPTIONS) toujours permise même module inactif — seule l'écriture est
bloquée (403, `{error, reason:'module_required', module}`) — pour ne jamais couper l'accès aux
données déjà créées quand un module est désactivé après coup, même logique que le mode
« lecture seule » de l'abonnement expiré.

**Bug réel trouvé en construisant (pas en relecture) : le grand-père manquant.**
`modules_actifs` vaut `{}` par défaut pour toute entreprise — y compris les ~7 entreprises
déjà existantes dans la base de dev, jamais bloquées jusqu'ici. Sans backfill, ce chantier
aurait cassé l'accès en écriture de toute entreprise réelle du jour au lendemain. Même
patron que le grand-père de l'abonnement Phase 1, mais avec une subtilité : `modules_actifs`
ne peut pas servir de proxy à lui-même (`{}` est une valeur légitime après grand-père comme
avant — une entreprise peut choisir plus tard de tout désactiver). Nouvelle colonne
`entreprises.modules_actifs_initialises` pour distinguer les deux cas : posée à `TRUE` par
`routes/auth.js:register` pour toute nouvelle inscription (qui démarre volontairement vide),
et par le backfill `seedModulesActifsBackfill()` pour toute ligne où elle valait encore
`FALSE` (activant les 3 modules). Vérifié : 7 entreprises grand-périsées lors du premier
passage, 0 au second (idempotent).

**Tests** : nouveau `moduleGuard.test.js` unitaire (fonctions pures `exigenceModulePourChemin`/
`evaluerAccesModule`, tous les cas dont les collisions de préfixe type `/produits` vs
`/produit-categories`) + nouveau `moduleGuard.test.js` d'intégration (blocage réel par route
HTTP, cache invalidé immédiatement après activation, catégorie « any », routes hors périmètre,
isolation multi-tenant). Le helper partagé `registerEntreprise()` accepte désormais
`opts.modulesActifs` (défaut : les 3 modules actifs, pour ne pas casser les ~340 tests
existants qui supposent un accès complet ; les tests qui testent le blocage lui-même passent
`{}` explicitement).

**Flakiness préexistante corrigée en passant** : en ajoutant ces nouveaux fichiers de test,
`devis.test.js`/`devisesTaux.test.js` ont commencé à échouer de façon intermittente (taux de
change réels au lieu des taux mockés attendus — reproduit 2 fois sur 5 lancements). Cause
racine identifiée : `obtenirTaux()` ne rafraîchit que si AUCUN taux n'existe encore pour la
devise/date demandée — si un autre fichier de test avait déjà écrit un taux (réel ou mocké
différent) pour aujourd'hui avant que ces tests ne s'exécutent, leur propre mock était
silencieusement ignoré. Bug préexistant (déjà rencontré une fois avec `abonnement.test.js`,
voir plus haut), mais jusqu'ici masqué par un ordre de fichiers favorable — l'ajout de
nouveaux fichiers a suffi à perturber l'ordonnancement de Jest et le rendre visible. Corrigé
proprement cette fois : les 3 `mockerFetchTaux()` locaux (`devis.test.js`,
`devisesTaux.test.js`, `abonnement.test.js`) purgent désormais `currency_rates` pour la date
du jour avant d'installer leur mock, rendant chaque test déterministe quel que soit l'ordre
d'exécution. **3 passages consécutifs à 351/351 tests, zéro régression** après ce correctif
(contre un échec intermittent avant).

**Vérifié en conditions réelles** (entreprise jetable, aucun module puis Poulailler seul
activé) : appel direct à l'API (contournant l'UI, qui empêche déjà normalement d'atteindre un
module non activé) → `POST /cultures/parcelles` → 403 avec le message
« Le module « Cultures » n'est pas actif pour votre entreprise. » ; `POST /poulailler/mouvements`
(module actif) → 400 de validation métier normal, jamais 403 — confirme que le garde-fou
laisse bien passer ; `POST /contacts` (catégorie « any », un module payant actif) → 201,
succès. Entreprise de test nettoyée, image Docker backend reconstruite.

### 2026-09-08 — Multi-devise : montants faux hors de l'en-tête des documents

Point de départ : une passe de vérification de santé du projet, puis le choix de reprendre la
« limite connue » notée à l'étape 3 du multi-devise réel (« les sous-tableaux lignes/échéances/
paiements restent en devise entreprise »). En vérifiant champ par champ à la source plutôt
qu'en s'en tenant à cette note, ce n'était pas une finition d'affichage mais **trois défauts
distincts**, dont deux touchent des chiffres, pas des étiquettes.

**Le point de confusion central**, à retenir avant de retoucher quoi que ce soit ici :
`account_move.amount_residual` est dans la devise **du document**, alors que
`account_move_line.amount_residual` appartient au grand livre et est donc en devise **de
l'entreprise**. Deux champs quasi homonymes, deux devises. Même dualité pour
`account_move.amount_total` (document) vs `debit`/`credit`/`balance` (entreprise).

**1. Balance âgée : total arithmétiquement faux (le plus grave).**
`GET /api/factures/aged-receivable` sommait `m.amount_residual` de toutes les factures
impayées sans conversion — une facture de 100 € s'ajoutait donc comme « 100 » à des francs
CFA. Ce n'est pas une étiquette trompeuse : le total du rapport sur lequel on décide qui
relancer était faux. Corrigé en convertissant chaque résidu au **taux figé de sa propre
facture** (`invoice_currency_rate`, déjà stocké — pas d'appel réseau, résultat déterministe),
comme le fait un ERP pour ce rapport, qui est par nature en devise de la société.
`GET /overdue`, qui liste facture par facture sans agréger, garde au contraire les montants
dans la devise du document et les affiche comme tels.
*Démontré empiriquement, pas seulement par lecture* : le nouveau test échoue sans le
correctif avec `Received: 1100` au lieu de `66595.7` (vérifié en retirant temporairement la
correction), et en conditions réelles la balance âgée est passée de « 140 » à 91 833,90 F CFA
pour un résidu de 140 €.

**2. Affichage : lignes, sous-totaux, échéances et paiements.**
`FacturesModule` et le détail de `DevisModule` formataient avec `fmtMoney` (devise entreprise)
des montants stockés en devise du document : prix unitaires, totaux de ligne, montant HT,
montant des taxes, échéances, paiements. Une échéance de 100 € s'affichait « 100 F CFA », soit
un facteur ~656 d'écart à l'écran. Un helper `enDevise(montant, devise)` dans chacun des trois
fichiers concernés remplace les appels fautifs. **Ce qui n'a délibérément pas été touché** :
les colonnes débit/crédit des écritures comptables, les montants « à affecter » (issus de
`account_move_line.amount_residual`) et la balance âgée désormais convertie — tous déjà en
devise entreprise ; les convertir aurait réintroduit le bug en sens inverse.

**3. `computeMarge` : soustraction entre deux devises.**
`marge = devis.total - coutTotal` mélangeait un total en devise du devis et un coût catalogue
toujours en devise entreprise. Sur un devis en euros, la marge était absurde. Corrigé en
ramenant la vente en devise entreprise (`totalDeviseEntreprise`) avant de soustraire — la
marge reste par construction un indicateur interne, en devise entreprise.

**4. Le PDF envoyé au client (trouvé en fin de passe, le plus exposé).**
`devisPdf.js` suffixait **« FCFA » en dur** et arrondissait à l'entier via `Math.round`, quelle
que soit la devise. Deux conséquences : un devis en euros partait chez le client étiqueté
« 290 FCFA », et — indépendamment du multi-devise — **toute entreprise dont la devise n'est pas
le franc CFA** recevait des PDF faux, en perdant au passage les centimes (25,50 € imprimé
« 26 »). `formatMontant(n, devise)` applique désormais les décimales de la devise (XOF/XAF
sans, les autres à deux) et `libelleDevise(devise)` imprime le code ISO — sauf pour XOF, qui
garde son libellé usuel « FCFA » pour ne pas faire régresser les documents déjà émis. Le code
ISO plutôt qu'un symbole : la police par défaut de PDFKit n'a pas de glyphe pour « F CFA ».

**Correction à la source, pas seulement à l'affichage** : le move de paiement était inséré sans
`devise` ni `invoice_currency_rate` alors que son `amount_total` est en devise du document —
la donnée elle-même était incohérente (`MOVE_COLUMNS` retombe sur la devise de l'entreprise
quand `devise` est NULL). Les deux colonnes sont désormais renseignées, avec le taux
réellement appliqué au règlement. Écarté en revanche : exposer `devise` dans
`GET /api/paiements`, qui n'a aucun consommateur (ce tableau n'affiche que `unallocated`, déjà
en devise entreprise) — pas de code sans usage.

**Tests** : +1 test d'intégration (balance âgée avec une facture en devise étrangère, vérifié
rouge sans le correctif) → **352/352**. +5 tests unitaires sur le formatage PDF, qui n'était
jusqu'ici couvert que par « le PDF fait plus de 0 octet » → **68 unitaires**. `formatMontant`
et `libelleDevise` sont exportées uniquement pour cela. Frontend 103/103, build et `oxlint`
(0 erreur) verts.

**Vérifié en conditions réelles** (entreprise jetable en XOF, client facturé en EUR, devis de
290 € validé, facturé en deux échéances, une échéance payée, au vrai taux du jour 655,956) :
détail du devis et de la facture entièrement en euros avec l'équivalent 190 227 F CFA, grand
livre équilibré et bien en F CFA (163 989 + 26 238 = 190 227 face à la créance), balance âgée
à 91 834 F CFA, entrée Finances à +98 393 F CFA pour l'échéance de 150 €. Entreprise de test
intégralement supprimée ensuite (nettoyage multi-tables : le plan comptable est en `RESTRICT`,
un simple `DELETE FROM entreprises` ne suffit pas — voir la note de nettoyage du 2026-08-13).

**Repéré en passant, non traité** : dans le module Finances, le libellé de l'axe du graphique
« Revenus récents » affiche un fragment de date ISO brut (`09-08T21:30:45.904Z`) au lieu d'une
date formatée.

### 2026-09-08 — Correctif : date ISO brute sur l'axe des graphiques Finances

Défaut repéré pendant la vérification navigateur du chantier multi-devise ci-dessus, traité
juste après. Les deux graphiques de `src/modules/finances.jsx` (« Revenus récents » /
« Dépenses récentes ») étiquetaient leurs barres avec `String(e.date).slice(5)` — un découpage
qui suppose une date au format `'YYYY-MM-DD'` pour n'en garder que `MM-DD`. Or
`GET /api/business/finances` renvoie `f.created_at` brut, donc un horodatage ISO complet : la
barre affichait `09-08T21:30:45.904Z`. Le tableau juste en dessous, lui, passait déjà par
`fmtDate` et affichait correctement.

Corrigé en réutilisant `fmtDate`, qui accepte déjà des options Intl — `{ day: 'numeric',
month: 'short' }` donne « 8 sept. » — plutôt qu'en ajoutant un formateur maison. Effet de bord
positif : le libellé suit désormais la locale de l'entreprise (« Sep 8 » en anglais), ce que le
découpage de chaîne ne faisait pas.

**Second défaut, révélé par le premier** : `MiniChart` (`components/ui.jsx`) utilisait
`key={item.label}` comme clé React. Tant que les libellés contenaient l'heure ils étaient
quasi uniques ; avec une date courte, deux opérations du même jour produisent le même libellé
et donc une clé dupliquée. La clé prend maintenant `item.id` quand l'appelant en fournit un
(cas de Finances) et retombe sur `label-index` sinon, pour les appelants historiques qui
passent des séries littérales.

**Ce que le test a corrigé dans mon propre diagnostic** : le premier test écrit affirmait que
la seconde barre était « écrasée silencieusement ». Vérification faite en retirant le
correctif, **c'est faux** — React rend bien les deux barres, il émet seulement un avertissement
de clé dupliquée et perd la stabilité d'identité entre deux rendus. Le test a donc été réécrit
pour asserter sur l'absence de cet avertissement (`console.error` espionné), et vérifié rouge
sans le correctif / vert avec. Une première version de cette assertion passait dans les deux
cas parce qu'elle attendait 4 arguments là où React en passe 3 — d'où la vérification
systématique qu'un test échoue bien sans son correctif, sans quoi il ne garantit rien.

2 nouveaux tests frontend (`ui.test.jsx`) → **105/105**, build et `oxlint` (0 erreur) verts.
Pas de vérification navigateur dédiée pour ce correctif : le libellé produit a été contrôlé
directement (`8 sept.` en fr-FR, `Sep 8` en en-US) plutôt qu'en recréant une entreprise de test.

### 2026-09-09 — Chasse aux chiffres faux : agrégations, données fabriquées

Passe d'audit demandée dans la veine du correctif multi-devise de la veille : chercher des
calculs faux plutôt que des bugs visibles. Quatre constats, dont un identique à celui déjà
corrigé — ailleurs, et sur des écrans plus exposés.

**1. Le ledger des ventes additionnait des devises différentes (6 écrans).**
`GET /api/devis/ledger` renvoyait `prix_unitaire` brut, c'est-à-dire dans la devise DU DEVIS.
Or il alimente tout ce qui somme des ventes : **Rapports** (et son export CSV + son PDF
imprimé), l'onglet **Comptabilité** des trois modules, l'**Analyse des ventes**, les
**Prévisions** et l'**Assistant IA** (dépense par client → « meilleur client » faussé). Une
ligne à 25 € y était comptée comme 25 F CFA. Le ledger expose désormais `devise`,
`tauxChange`, `montant` (devise d'origine, pour l'affichage ligne à ligne) et
`montantDeviseEntreprise` — seule valeur sommable ; un helper `montantLigneEntreprise` côté
frontend remplace les 9 calculs concernés. Les achats sont volontairement inchangés :
`achats_documents` n'a pas de colonne devise, ils sont toujours en devise entreprise.
*Vérifié en conditions réelles* (un devis de 250 € + un de 2 000 XOF) : l'ancien calcul donnait
2 250, le nouveau 165 989,10, et l'écran Rapports affiche bien 165 989 F CFA.

**2. Les « Prévisions » n'en étaient pas.** Le module multipliait le mois COURANT par des
coefficients figés (×1,08 ventes, ×1,05 dépenses, ×1,1 récoltes, ×0,9 aliment) tout en
annonçant « basées sur les tendances récentes ». Pire, sa note affirmait que l'humidité des
parcelles et le chiffre d'affaires client « servent à ajuster la projection » alors qu'aucun
des deux n'entrait dans le moindre calcul. Remplacé (choix explicite de l'utilisateur) par une
moyenne des **mois révolus réellement enregistrés** — le mois courant est exclu parce
qu'incomplet, et seuls les mois porteurs de données comptent dans la moyenne, sinon trois mois
dont deux vides donneraient une projection deux fois trop basse. Sans aucun mois révolu, le
module le dit au lieu d'afficher des zéros. L'indicateur « consommation d'aliments prévue »
(stock actuel × 0,9) est supprimé : rien ne mesure la consommation, il n'y avait pas de base
pour le calculer. La note est reformulée en contexte assumé (« ces chiffres sont indicatifs,
ils n'entrent pas dans le calcul »). *Vérifié* : avec 300 000/200 000 de ventes et
50 000/100 000 de dépenses sur les deux mois précédents, l'écran affiche 250 000 / 75 000 /
175 000 et annonce « moyenne des 2 derniers mois révolus ».

**3. « Évolution du stock » était un graphique inventé.** Trois de ses quatre points étaient
fabriqués en soustrayant 120, 80 puis 40 du total actuel — une progression régulière qui n'a
jamais eu lieu, présentée sans rien qui la distingue d'une donnée réelle (contrairement aux
capteurs simulés, eux assumés). Remplacé par une vraie reconstitution serveur
(`GET /api/produits/evolution-stock`) depuis `stock_moves` : on part de la valeur actuelle et
on remonte le temps en défaisant les mouvements `fait` postérieurs à chaque fin de mois.
**L'axe passe en VALEUR (quantité × coût)** parce qu'un module mélange kilos, litres et sacs,
dont la somme brute ne veut rien dire — ce qui règle du même coup le constat 4 ci-dessous pour
cet écran. Les articles sans coût comptent pour zéro et leur nombre est affiché, plutôt que de
laisser croire à un stock qui vaut moins.

**4. Défauts mineurs.** Le filtre `categorie === 'Aliment'` de l'Assistant IA était une égalité
stricte sur un libellé semé par défaut, alors que les catégories sont configurables depuis la
fusion du catalogue : renommer la catégorie renvoyait 0 sans que rien ne le signale. Assoupli
en « commence par aliment », casse et espaces ignorés.

**Piège rencontré, à retenir** : les requêtes SQL de ce projet vivent dans des template
literals JS. Mettre un identifiant entre backticks dans un commentaire SQL (`-- ... `champ` ...`)
ferme la chaîne et casse le module — l'erreur remonte sous forme d'un `SyntaxError` de Jest sur
un fichier de test qui, lui, est valide. Un fichier de sonde minimal a permis de localiser la
vraie source en une passe.

**Tests** : +2 d'intégration (`ventesLedger.test.js` : montant converti, brut conservé pour
l'affichage, et assertion explicite que la somme brute — l'ancien calcul — diffère du total
correct) et +4 (`evolutionStock.test.js` : reconstitution mois par mois, articles sans coût,
bornes et validation, isolation) → **358/358**. Frontend 105/105, build et `oxlint` (0 erreur)
verts. Vérifié en navigateur réel sur une entreprise jetable (deux clients, l'un facturé en
EUR, l'autre en devise entreprise), supprimée ensuite.

**Non traité, repéré en passant** : sur l'écran Rapports, la période « Journalier » affiche 0
alors que les ventes datent du jour — `matchesPeriod` mérite un coup d'œil.

### 2026-09-09 — Vérification navigateur du registre HACCP (dette fermée) + correctif du badge

Dernière dette de vérification du projet : l'étape 3 de la transformation agroalimentaire
(registre HACCP) avait été livrée le 2026-09-06 sans contrôle visuel, l'extension navigateur
étant indisponible ce jour-là. Refaite ici sur une entreprise jetable (recette de mouture,
ordre de transformation, deux contrôles dont un non conforme), supprimée ensuite.

**Défaut trouvé — exactement ce que cette vérification devait attraper.** `HaccpPanel` ne
chargeait ses données qu'à l'ouverture du panneau (`useEffect(… if (open && !loaded) charger())`).
Or son en-tête porte un badge « N non conforme(s) » dont l'intérêt est justement d'alerter
**sans** qu'on ait à déplier le panneau. Tant que les contrôles n'étaient pas chargés,
`controles` restait vide, `nonConformes` valait 0, et ni le compteur `(N)` ni le badge ne
s'affichaient : le badge n'a jamais prévenu personne depuis sa mise en service. Aucun test ne
le couvrait, et l'API-level testing du 2026-09-06 ne pouvait pas le voir.

Corrigé en scindant le chargement : les **contrôles** sont chargés au montage (c'est ce qui
alimente le badge), les **ordres de transformation** restent en chargement paresseux à
l'ouverture puisqu'ils ne servent qu'au formulaire d'ajout — inutile d'appeler cette route sur
un panneau que l'utilisateur n'ouvrira peut-être jamais.

**Tests** : nouveau `src/components/HaccpPanel.test.jsx` (3 tests : badge visible panneau
replié, compteur dans l'en-tête au chargement, et absence d'appel aux ordres tant que le
panneau est fermé). Vérifiés rouges sans le correctif, verts avec. **108 tests frontend.**

**Reste de la vérification, tout conforme** : saisie d'un contrôle par le formulaire (type,
valeur mesurée + unité, opérateur) → apparaît dans le tableau, compteur passé à 3, badge
inchangé à 1 non conforme ; filtrage par module correct ; snapshot texte de l'ordre lié
affiché. L'export CSV ne lève aucune erreur console, mais **le fichier lui-même n'a pas pu
être ouvert** : le navigateur intégré bloque les téléchargements déclenchés par la page. La
génération a donc été relue dans le code (colonnes, échappement des guillemets, séparateur
`;`) sans être exécutée de bout en bout — seul point non vérifié en conditions réelles.

Note : un « — » affiché en valeur mesurée pendant la mise en place venait du script de
préparation (champ `valeur` au lieu de `valeurMesuree`), pas de l'application.

### 2026-09-09 — Allègement du chargement initial (code splitting)

Dernier chantier de performance non bloqué : le bundle faisait **906 kB en un seul fichier**
(231,4 kB gzippés), sans aucun `React.lazy` dans le projet — tout partait au premier
chargement, y compris la pisciculture pour qui n'a que des cultures, et les deux catalogues de
traduction pour qui n'en lit qu'un. Pour une application visant des connexions mobiles lentes,
c'était le point de friction le plus tangible qui restait.

**Trois étapes, mesurées à chaque fois.**

1. **Chunks tiers séparés** (`manualChunks` dans `vite.config.js`) : `vendor-react` (171,9 kB),
   `vendor-i18n` (56,9 kB), `vendor-icons` (27,7 kB). Le gain n'est pas sur le poids total mais
   sur le cache : les dépendances changent bien moins souvent que le code applicatif, un
   déploiement ne réinvalide donc plus que le chunk de l'app. Au passage, mesure rassurante :
   `lucide-react` pèse 29 Mo sur disque mais seulement 27,7 kB une fois secoué.

2. **Catalogues i18n à la demande.** Les deux JSON pesaient **167 kB** (fr 86,8 + en 79,9) dans
   le bundle initial alors qu'un utilisateur n'en lit jamais qu'un. `fr` reste importé
   statiquement — c'est le `fallbackLng`, il doit toujours être là pour combler une clé
   manquante — et les autres langues passent par `import()`, avec mémorisation de la promesse
   et repli silencieux sur le fallback si le chargement échoue. `setLanguage` devient async et
   attend le catalogue avant de basculer. Le commentaire d'en-tête du fichier prévoyait
   exactement ce changement « quand la liste s'allongera » ; à 167 kB, ce n'était plus
   négligeable. −61 kB sur le chunk principal.

3. **Modules d'onglets en `React.lazy`** (9 : Factures, Équipements, Billing admin, Météo,
   Mon espace RH, Feedback, Aide, Registre des intrants, Observations), avec **un seul
   `<Suspense>`** autour de la zone de contenu — chaque onglet n'en rend qu'un à la fois, un
   Suspense par module aurait été du bruit. Volontairement **non** lazy : `HaccpPanel`, dont le
   badge de non-conformité doit justement charger ses données dès le montage (voir l'entrée
   précédente) — le rendre paresseux aurait réintroduit le défaut corrigé le matin même.

**Résultat mesuré** : chargement initial **231,4 → 193,3 kB gzippés (−16 %)**, plus 44,7 kB
désormais différés (chargés seulement si l'utilisateur ouvre l'onglet concerné ou passe en
anglais). Chunk applicatif brut : 906 → 494,5 kB.

**Vérifié en navigateur réel** (entreprise jetable, supprimée ensuite) — et pas seulement par
la taille des fichiers : le journal réseau confirme que `HelpModule`, `MeteoModule`,
`FeedbackModule`, `ObservationListView` ne sont récupérés qu'en ouvrant leur onglet, et
`en-*.js` uniquement au changement de langue, qui bascule bien toute l'interface en anglais.
108 tests frontend, `oxlint` (0 erreur) et build verts.

**Limite honnête** : le chunk applicatif reste à 494,5 kB parce qu'`App.jsx` (9 200 lignes)
contient encore la majorité des modules — Cultures, Poulailler, Pisciculture, Devis, Employés,
Contacts, Finances… On ne peut pas charger paresseusement ce qui vit dans le même fichier.
Descendre nettement plus bas suppose l'extraction d'`App.jsx` en modules séparés, chantier
explicitement différé à l'avant-production (mémoire `project_appjsx_extraction_deferred`).

### 2026-09-09 — Fuseau horaire par entreprise (décalage serveur/utilisateur)

Le décalage repéré lors de l'audit précédent, traité ici. Le serveur et la base tournent en
**UTC** : `CURRENT_DATE` y renvoyait donc la date civile UTC, alors que le filtrage par période
côté client raisonnait dans le fuseau du **navigateur**. Deux horloges, deux réponses. Une
vente saisie à 00h30 à Paris (22h30 UTC la veille) était datée de la veille par le serveur et
disparaissait du rapport « Journalier » — c'est très exactement ce qui avait été observé, et
que j'avais d'abord attribué à tort à un bug de `matchesPeriod`, lequel était correct.

**Périmètre réel : 24 emplacements, pas 39.** Le chiffre annoncé au départ comptait aussi les
`now()`, qui écrivent des `timestamptz` — des instants absolus, correctement restitués quel que
soit le fuseau. Seules les **dates civiles** (`CURRENT_DATE` sur des colonnes `DATE`) étaient
concernées.

**Le fuseau est porté par l'ENTREPRISE**, pas par l'utilisateur : une pièce est datée dans le
fuseau de la société (convention comptable), pas dans celui de l'employé en déplacement — et
l'entreprise a déjà une localisation en base (ville/latitude/longitude, posées pour la météo).
Nouvelle colonne `entreprises.fuseau TEXT NOT NULL DEFAULT 'UTC'` : le défaut reproduit le
comportement actuel, donc **aucune entreprise existante ne voit ses dates bouger**.

**Une fonction SQL plutôt que 24 requêtes paramétrées.** `date_entreprise(p_entreprise_id)`
(plpgsql, `STABLE`) remplace `CURRENT_DATE` partout. Écrite en plpgsql avec un handler
d'exception, et non en SQL validant contre `pg_timezone_names` : cette vue compte ~1200 lignes
et la fonction est appelée depuis des `WHERE`, la valider à chaque ligne aurait coûté cher. La
validation se fait donc à l'écriture (`PUT /api/entreprise` refuse un fuseau inconnu en 400) ;
le handler n'est qu'un filet — fuseau invalide ou entreprise inconnue retombent sur UTC sans
jamais faire échouer la requête. Le paramètre passé est celui déjà présent dans la requête
(`$1` = entreprise_id) ou la **colonne** `entreprise_id` de la table : aucune signature de
fonction JS n'a changé, sauf trois cas sans entreprise en table (maintenance d'équipement,
avances salarié) où un paramètre a été ajouté.

**Côté client**, le fuseau accompagne devise/locale : ajouté aux payloads de `login`,
`/auth/me`, `confirmer-inscription`, `GET`/`PUT /api/entreprise`, porté par `LocaleProvider`,
et réglable dans Mes préférences (~419 fuseaux listés depuis `Intl.supportedValuesOf`, repli
sur une sélection multi-continents).

**Deux défauts trouvés par la vérification, pas par la relecture :**
1. Le sélecteur affichait « UTC » alors que la base disait « Pacific/Honolulu » — le fuseau
   n'était renvoyé par aucune route d'authentification. Corrigé sur les 7 points concernés.
2. Plus subtil, et introduit par moi : `matchesPeriod` convertissait la date de la pièce en
   objet `Date` puis la reprojetait dans le fuseau de l'entreprise. **Double conversion** : une
   date civile désigne un jour du calendrier, pas un instant, et la reprojeter la faisait
   reculer d'un jour. Nouvelle fonction `jourCivil()` qui lit le jour **tel quel** (par
   position, sans regex — les échappements ne survivent pas aux scripts d'édition utilisés
   ici) ; seul « aujourd'hui » est calculé dans le fuseau de l'entreprise, et la comparaison se
   fait en chaînes AAAA-MM-JJ, qui s'ordonnent naturellement.

**Tests** : 6 tests d'intégration (`fuseauEntreprise.test.js` : défaut UTC, suivi du fuseau,
repli sur fuseau invalide/entreprise inconnue, validation du `PUT`, exposition en `GET`,
datation réelle d'une pièce) → **364/364**. 5 tests frontend (`fuseau.test.jsx`) sur
`jourEntreprise`, dont un qui a attrapé un vrai défaut au passage : `new Date(null)` vaut
1970-01-01 et non une date invalide, la fonction ne renvoyait donc pas `null` sur une entrée
vide. **113 tests frontend.**

**Vérifié en conditions réelles**, entreprise jetable réglée sur `Pacific/Honolulu` (UTC−10,
donc la veille au moment du test) : le serveur était le 9 septembre en UTC, `date_entreprise`
renvoyait le 8, l'achat créé sans date portait bien le 8, et le rapport « Journalier » affichait
ses 100 F CFA — là où l'ancien code, calé sur le jour du navigateur (le 9), l'excluait.
Entreprise supprimée ensuite.

**Limite connue** : un fuseau reste global à l'entreprise. Une exploitation à cheval sur deux
fuseaux daterait tout dans celui qu'elle a choisi — cas jugé théorique, non traité.

### 2026-09-09 — Fuseau, suite : les dates posées côté client court-circuitaient le serveur

Reprise de la « limite » laissée par l'entrée précédente (« une exploitation à cheval sur deux
fuseaux daterait tout dans celui qu'elle a choisi »). En cherchant comment la traiter, le
constat a changé de nature : **ce cas est déjà couvert** — 12 des 18 dates de pièces acceptent
une date explicite (`COALESCE($n, date_entreprise(...))`), les 6 autres étant des dates système
(relance, paiement d'abonnement, comparaison d'échéance) où une saisie n'aurait pas de sens, et
l'interface expose 39 champs date. Une opération faite dans un autre fuseau se date donc à la
main. Le fuseau de l'entreprise ne fixe que le **défaut**.

**Mais en vérifiant ce défaut, un vrai reliquat est apparu**, plus concret que le cas théorique
de départ : plusieurs endroits du client posaient une date avec
`new Date().toISOString().slice(0, 10)`, c'est-à-dire le jour **UTC du navigateur** — ni le
fuseau de l'entreprise, ni même le jour local de l'utilisateur.

- **`AchatModule` envoyait cette date explicitement**, écrasant donc le `date_entreprise()` que
  le serveur venait d'apprendre à poser : la correction serveur était court-circuitée pour tous
  les achats créés depuis l'UI. Corrigé en **cessant d'envoyer la date** — sans elle, la route
  applique son défaut, qui est la source qui fait autorité. (À noter : cette ligne venait du
  correctif du 2026-08-13, qui avait remplacé un `toLocaleDateString('fr-FR')` produisant du
  `JJ/MM/AAAA` mal interprété par Postgres ; le format avait été corrigé, le fuseau non.)
- **Champs pré-remplis** (`EmployeeRhModal`, `MonEspaceRh`, `RegistreIntrantsView`) : ils
  proposaient une date qui pouvait différer de celle que le serveur aurait retenue. Nouveau
  helper `aujourdhuiEntreprise()` dans `lib/locale.jsx`.
- **`FacturesModule`** calculait « J+n » / « n j de retard » contre le jour UTC : la même
  facture pouvait s'afficher « à échoir » dans la liste et « en retard » dans la balance âgée.

**Tests** : 2 tests frontend supplémentaires sur `aujourdhuiEntreprise` (dont un qui fige
`Date` à un instant où Paris et Honolulu ne sont pas le même jour) → **115 tests frontend**,
build et `oxlint` (0 erreur) verts.

**Vérifié en conditions réelles**, entreprise réglée sur `Pacific/Honolulu` : le champ date du
registre des intrants s'est pré-rempli au **2026-09-08**, alors que le navigateur était au
**2026-09-09** en local comme en UTC. Avant le correctif, il aurait proposé une date en avance
d'un jour sur la réalité de l'exploitation. Entreprise supprimée ensuite.

**Note d'outillage** : `form_input` du navigateur intégré écrit la valeur dans le DOM sans
déclencher le `onChange` de React ; l'état du composant reste vide et le formulaire de
connexion, qui refuse silencieusement une saisie vide, ne se soumettait pas — symptôme
trompeur, sans rapport avec l'application (l'API répondait 200). Contourné en posant le token
en `localStorage` puis en rechargeant, ce que fait déjà la restauration de session.

### 2026-09-09 — Envoi d'un devis par WhatsApp (lien click-to-chat)

Première des deux options demandées par l'utilisateur. Trois voies étaient possibles, comparées
avant de coder (recherche réelle sur la tarification Meta, pas de mémoire) :

1. **Lien « click-to-chat » (`wa.me`)** — gratuit, sans compte Meta, sans API. Ouvre WhatsApp
   avec le numéro et le message pré-remplis ; c'est l'utilisateur qui appuie sur envoyer.
2. **WhatsApp Business Cloud API** — envoi automatique côté serveur, mais compte Meta Business
   vérifié, numéro dédié, modèles de messages pré-approuvés, et facturation **par message**
   depuis le 1er juillet 2025 (catégorie « utility » : 0,004 à 0,046 $ selon le pays). À noter,
   Meta étend la facturation aux réponses de service **au 1er octobre 2026**.
3. Intermédiaires (Twilio, 360dialog) : mêmes contraintes plus leur marge.

**Option 1 retenue** (choix de l'utilisateur), parce qu'elle s'appuie sur deux briques déjà
construites : le **lien public de devis** (`/devis/:token` + `DevisPublicView`, livrés le
2026-09-05) et le **téléphone du contact**, déjà en base. WhatsApp n'accepte pas de pièce
jointe par ce mécanisme, mais le lien vaut mieux qu'un PDF : le client consulte **et signe** en
ligne.

**Backend** — `POST /api/devis/:id/lien-whatsapp` : n'expédie rien, prépare le lien public et
un message tout prêt. Deux points de conception qui auraient pu mordre :
- **Le token public est réutilisé s'il existe déjà.** En régénérer un aurait invalidé le lien
  qu'un client aurait reçu par email quelques jours plus tôt — le devis serait devenu
  inaccessible sans que personne ne le sache.
- Le statut passe à « Envoyé » (et le taux de change est refigé, comme `/envoyer`) : sans cela
  le lien public ne serait pas exploitable. Limite assumée : si l'utilisateur ferme WhatsApp
  sans envoyer, le devis est marqué envoyé — il reste remettable en brouillon, action existante.

**Frontend** — `src/lib/whatsapp.js` : normalisation du numéro et construction du lien. Le
point délicat est la normalisation : le téléphone est saisi en texte libre, et on **ne devine
jamais l'indicatif pays**. Un numéro national (commençant par 0) est refusé avec un message
explicite plutôt que transformé en lien mort — ou pire, en conversation avec un inconnu.

**Tests** : 4 d'intégration (lien + message + passage à « Envoyé » + lien public réellement
consultable ; réutilisation du token vérifiée en confirmant que le premier lien reste valide ;
client sans téléphone → 400 sans changer le statut ; isolation) → **368/368**. 4 tests frontend
sur la normalisation et l'encodage → **119 tests frontend**.

**Vérifié en navigateur réel** (entreprise jetable, client au +223 76 12 34 56, supprimée
ensuite) : le bouton produit
`https://wa.me/22376123456?text=Bonjour%20Aminata%20Diallo…` — numéro correctement normalisé —
et le lien contenu dans le message ouvre bien le devis avec son bouton « Approuver et signer ».

### 2026-09-09 — Module Surveillance : registre de caméras, sans stockage vidéo

Seconde option demandée par l'utilisateur. Le cadrage a beaucoup changé en cours de route et
c'est ce qui rend ce chantier petit : l'utilisateur visait d'abord l'anti-intrusion (le cas le
plus lourd — enregistrement continu, rétention, alertes), puis a précisé que **l'application ne
servira jamais à stocker des enregistrements** : elle sert à *se connecter aux caméras pour
surveiller*, le stockage restant à la charge de l'entreprise. Sans enregistrement ni relais, il
ne reste qu'un registre et de l'affichage.

**Réserve exprimée avant de coder**, et maintenue : reconstruire un NVR dans YEELEN aurait été
un mauvais emploi du temps disponible (serveur média, stockage vidéo, bande passante permanente
— sur un hébergement pas encore financé, pour des exploitations en connexion mobile), face à
des produits matures à quelques dizaines d'euros. La valeur propre de l'app est le
**rattachement à l'exploitation** : une caméra reliée à un module ou une parcelle.

**Deux contraintes techniques, dites d'emblée à l'utilisateur** :
- **Le RTSP ne s'affiche dans aucun navigateur** sans passerelle de transcodage — or c'est le
  protocole de la plupart des caméras IP. Le module gère donc `snapshot` (image HTTP
  rafraîchie), `mjpeg`, `hls` et `lien`, et **refuse explicitement une URL `rtsp://` à la
  saisie**, avec un message qui dit quoi utiliser à la place. Mieux vaut un refus clair qu'un
  cadre noir inexpliqué.
- **L'accès réseau** : une caméra du réseau local n'est joignable que depuis ce réseau. L'app
  n'y peut rien ; c'est écrit dans l'intro de l'écran et dans le message d'erreur.

**Conception.** Table `cameras` (`type_flux` en CHECK, `emplacement_type`/`emplacement_id` sans
FK — une caméra doit survivre à la suppression de la parcelle qu'elle observait, même patron
que les snapshots texte de `applications_intrants`). `routes/cameras.js`, écritures gated
`requireRole('admin','directeur')`, lecture ouverte. Le serveur **ne relaie aucune image** :
c'est le navigateur qui va la chercher auprès de la caméra. `verifierUrl` n'accepte que
http(s) — une URL saisie librement finit dans un `<img src>`, où `javascript:` ou `data:`
seraient une injection. Onglet `surveillance` monté en `React.lazy` comme les autres modules
d'onglets, hors périmètre des modules payants (même posture que météo et observations).

**Deux défauts trouvés par les tests, pas par la relecture :**
1. `Number(rafraichissement) || 10` renvoyait 10 pour une valeur 0 — le piège classique du
   `||` avec une valeur falsy légitime : la borne basse ne s'appliquait jamais. Remplacé par
   `normaliserRafraichissement`, qui distingue « champ absent » (→ défaut) de « valeur hors
   bornes » (→ ramenée dans les bornes).
2. **Le piège des backticks, retombé dedans le jour même où je l'ai documenté** : des
   backticks dans les commentaires SQL du bloc `cameras` de `migrate.js` ont fermé le template
   literal ; l'erreur remontait comme `Unexpected identifier 'type_flux'`, pointant le SQL
   plutôt que la vraie cause. Consigné cette fois en mémoire, pas seulement au journal.

**Tests** : 7 d'intégration (CRUD, refus du RTSP avec message utile, refus des schémas non
http(s) dont `javascript:`, validations, bornes de rafraîchissement, gate de rôle, isolation)
→ **375/375**. Frontend 119/119, build vert.

**Vérifié en conditions réelles** avec une **fausse caméra** (petit serveur HTTP servant un
JPEG) : l'image s'affiche avec son paramètre anti-cache, et la caméra a reçu **27 appels
espacés de 2 s** — le rafraîchissement fonctionne réellement, ce qu'un simple affichage n'aurait
pas prouvé. Serveur ensuite coupé pour vérifier le cas le plus fréquent en production : le
message « Image indisponible… une caméra du réseau local n'est pas visible à distance »
s'affiche à la place du cadre vide. Entreprise de test supprimée.

**Suite possible, non construite** : réception d'alertes de mouvement (les caméras et NVR grand
public savent appeler un webhook), pour un journal horodaté rattaché au module concerné — c'est
là que l'app apporterait ce qu'un Reolink ne fait pas. Rien n'est commencé.

### 2026-09-09 — Alertes de mouvement : le journal rattaché à l'exploitation

Suite du module Surveillance, et la partie qui justifie que l'app s'en mêle : un enregistreur
du commerce sait dire « mouvement caméra 2 », il ne sait pas dire « mouvement au poulailler,
portail nord ». Ici l'alerte est rattachée à la caméra, donc au module ou à la parcelle.

**Le point de conception central : une caméra ne peut pas s'authentifier.** Elle ne porte pas
de JWT, et beaucoup de modèles grand public ne savent qu'appeler une URL — sans choisir la
méthode ni envoyer de corps. Le secret est donc le **token de l'URL** : 24 octets aléatoires,
un par caméra, généré à la création et **régénérable** (seul recours si l'adresse a fuité, et
révocation immédiate de l'ancienne). La route accepte GET autant que POST pour cette raison.

Vérifié au préalable que `subscriptionGuard` et `moduleGuard` laissent passer une requête non
authentifiée (`if (!req.user?.entrepriseId) return next()`) — sans quoi le webhook aurait été
bloqué par un 402 qu'une caméra n'aurait pas su interpréter.

**Regroupement plutôt qu'empilement.** Une caméra en détection continue émet des dizaines
d'appels par minute : une nuit de vent aurait noyé le journal. Tant qu'une alerte de la même
caméra et du même type date de moins de 120 s, on incrémente `occurrences` et on repousse
`derniere_occurrence` au lieu de créer une ligne. L'écran affiche « Mouvement détecté ·
7 détections », ce qui est à la fois plus lisible et plus informatif qu'une ligne par appel.

**Ce qui n'est délibérément pas fait**, conformément au principe posé pour la surveillance :
aucune image n'est reçue, transmise ni stockée — seulement l'événement. Une caméra désactivée
cesse d'alimenter le journal sans qu'il faille toucher à sa configuration. Purge à
l'insertion au-delà de 90 jours, bornée à la caméra concernée et indexée, plutôt qu'une tâche
planifiée qui n'existe pas dans ce projet.

**Frontend** : journal en tête de l'écran Surveillance (badge de non-lues, bouton « Vu »), et
sur chaque carte un bloc pliable donnant **l'URL à coller dans la caméra**, avec bouton de
copie et de régénération. Le texte d'aide dit où la coller (« notification HTTP » / « webhook »)
et rappelle qu'aucune image ne transite.

**Tests** : 11 d'intégration (token généré à la création, alerte rattachée au module,
regroupement, GET accepté, types distincts = lignes distinctes, token inconnu/trop court → 404,
caméra désactivée muette, marquage vu, rotation de token invalidant l'ancien, suppression en
cascade, isolation) → **386/386**. Frontend 119/119, build vert.

**Vérifié en navigateur réel** (entreprise jetable, supprimée ensuite) : deux épisodes simulés
donnent bien « Portail nord — Poulailler · Mouvement détecté · 7 détections » et « Intrusion
signalée · Portail ouvert la nuit », le badge passe de « 2 non lue(s) » à « 1 » après un clic
sur « Vu », et l'URL de webhook affichée est bien celle qui répond.

### 2026-09-09 — Palette et formes unifiées (direction terreuse)

Point de départ : une discussion design, pas une demande de correctif. L'audit a montré que
**deux palettes coexistaient**, et que c'était structurel : `COLORS` déclaré dans `App.jsx`
(bleu-gris, vert émeraude) contre une seconde palette **jamais déclarée**, écrite en dur dans
les composants (noir-vert, vert forêt, terre cuite, beige). C'est la seconde qui l'emportait
en pratique, puisque `ui.jsx` — d'où viennent boutons, cartes et champs — la portait. Et elle
ne pouvait pas importer `COLORS`, `App.jsx` important `ui.jsx` : le cycle d'import est la
cause réelle du problème. Une **troisième** palette locale a même été trouvée en cours de
route dans `modules/finances.jsx`, avec les mêmes noms de jetons et un fond beige différent.

Chiffres du constat : 133 occurrences du même gris en dur, 12 valeurs d'arrondi, 28 fichiers.
Un aperçu comparatif a été publié en artifact pour trancher (les deux nuanciers, le même écran
décliné, l'échelle des arrondis).

**La direction a été choisie sur un critère mesuré, pas au goût.** Contrastes calculés sur les
deux palettes : la palette *déclarée* échouait sur ses trois couleurs sémantiques — son vert
d'action avec du texte blanc tombait à **3,25:1**, son rouge à 3,94:1, son ocre à 2,39:1. La
terreuse tient 6,22:1 sur le même bouton et 5,64:1 sur l'alerte. Pour une application
consultée dehors sur des écrans bon marché, cela tranche. Elle est en outre déjà ce que voient
les utilisateurs, donc l'unification ne déplace presque rien — sauf la navbar, qui passe de
l'émeraude au vert forêt **et y gagne son contraste** (3,25:1 → 6,22:1).

**Corrections de contraste au passage** : l'ambre `#C1861F` (3,00:1, et 3,14:1 en fond de
bouton) devient `#8A5C0C` (5,81:1) ; le bleu `#3B82F6` et le violet `#9B6BD6` des catégories de
navigation, qui échouaient aussi (3,52:1 et 3,67:1) et n'appartenaient à aucune des deux
palettes, deviennent `#2E6E8E` et `#6B5B8E`.

**Mise en œuvre** : `src/lib/theme.js` (palette + `RADIUS`), importé par `App.jsx` **et** par
les composants — le nom `COLORS` est conservé pour que les ~1000 usages d'`App.jsx` restent
inchangés, seules les valeurs bougent. 275 littéraux remplacés par leur jeton dans 27 fichiers,
puis 48 couleurs enfermées dans des chaînes composées (`'1px solid #DAD6C4'`) converties en
template literals, puis 6 reliquats traités à la main. **Vérification finale par grep : il ne
reste que 5 couleurs littérales**, toutes dans les feuilles de style des documents imprimés —
laissées volontairement et désormais commentées, un PDF s'imprimant sur blanc et non sur le
fond beige de l'écran.

**Trois bugs de mes propres scripts, trouvés par le build** : l'import inséré au milieu d'un
`import { … }` multi-ligne (11 fichiers) ; des attributs JSX écrits sans accolades
(`color="#B23B2E"` devenu `color=COLORS.red`, invalide — 4 cas) ; et la palette locale de
`finances.jsx` devenue auto-référente puis en conflit avec l'import.

**Limite assumée** : les arrondis ont été **consolidés** (12 valeurs → 3, 154 occurrences) mais
pas **réassignés par rôle** — un bouton qui portait 8 px reçoit `RADIUS.card` plutôt que
`RADIUS.control`, faute de pouvoir distinguer automatiquement un bouton d'une carte. L'écran
est donc inchangé (le rayon des boutons passe de 9 à 8 px), mais le nom du jeton ne dit pas
encore le rôle partout. Un second passage, à la main dans `ui.jsx` et les primitives, reste à
faire si l'on veut que chaque jeton porte vraiment son sens — c'est un choix d'apparence, donc
à valider par l'utilisateur avant.

**Vérifié** : build, `oxlint` (0 erreur), 119/119 tests frontend, et rendu réel sur une
entreprise jetable (navbar vert forêt, bouton d'ajout, jauges bleu-vert et ambre assorties,
badges et bordures beiges) — supprimée ensuite. Les trois variantes de bouton passent
désormais le seuil AA avec leur texte blanc (15,3:1 / 6,2:1 / 5,8:1).

### 2026-09-10 — Base typographique : sortir du gabarit Vite, poser une échelle

Suite du chantier design de la veille (palette unifiée). Le point de départ était de ramener
les tailles de police à une échelle ; la mesure préalable a montré que le problème principal
était ailleurs — **`src/index.css` et les 185 premières lignes de `src/App.css` étaient le
gabarit de départ de Vite, jamais retiré et toujours actif**.

**Ce que le gabarit imposait, et qui n'avait jamais été décidé pour cette application**

- `#root { text-align: center }` — tout le contenu héritait du texte centré. Les 37
  `textAlign: 'left'` posés en style inline dans le JSX ne sont pas des choix de mise en page :
  ce sont des réparations locales de ce défaut, là où quelqu'un s'en est aperçu. Ailleurs, le
  centrage restait. Le cas le plus net, vérifié en avant/après sur le tableau de bord : la liste
  « Alertes importantes » affichait sa puce collée au bord gauche de la carte et son texte au
  milieu — un `<ul>` sous `text-align: center` met le marqueur à gauche et le texte au centre.
  Sur l'écran d'accueil de l'application.
- `:root { font: 18px/145%; letter-spacing: .18px; color: #6b6375 }` — une base de 18 px et un
  texte gris-violet, contredits partout en style inline.
- `color-scheme: light dark` + un bloc `prefers-color-scheme: dark` — chez un utilisateur dont
  le système est en thème sombre, les contrôles natifs se rendaient en sombre par-dessus une
  palette claire. **Trois contournements locaux distincts existaient déjà dans le dépôt pour ce
  seul bug** (bordures de `.data-table` figées en littéral plutôt qu'en `var(--border)` ;
  couleurs de `.flat-input` idem ; `.global-search-input { color-scheme: light }`), chacun
  documenté par un commentaire renvoyant au symptôme. Aucun n'était allé à la cause.
- `--accent: #aa3bff`, `.counter`, `.hero`, `#center`, `#next-steps`, `#docs`, `#spacer`,
  `.ticks`, `h1 { 56px }`, `code {}` — sélecteurs du gabarit, aucun usage dans le JSX.

`index.css` est réécrit : une base explicite (Inter, 13 px, interligne 1.5, `COLORS.ink` sur
`COLORS.bg`, `color-scheme: light`), les seules remises à zéro utiles, et des tailles de
l'échelle pour `h1`/`h2`/`h3` (le JSX les emploie 12 fois). `App.css` perd ses 185 lignes de
gabarit et ne garde que ce qu'un style inline ne peut pas exprimer.

**Deux défauts trouvés en passant, corrigés ici**

- `App.css` gardait encore l'**ancienne palette** (`#E2E8F0` en bordure, `#2D374A` en texte,
  `#9AA5B1` en placeholder) : le script d'unification de la veille ne traitait que les `.jsx`.
  Les 20 tableaux et 52 champs plats étaient donc restés en gris-bleu pendant que le reste
  passait au beige.
- L'`@import` des polices vivait dans le bloc `<style>` d'`App.jsx`, rendu par le seul shell de
  l'application — si bien que **la page publique de devis** (`DevisPublicView`, montée hors de
  `<App/>`) demandait Inter sans jamais la charger, et retombait sur la police système. C'est la
  page que voit le client d'un utilisateur. L'import vit maintenant dans `index.css`.

**L'échelle typographique**

Vingt tailles distinctes sur 648 usages : 12 et 12,5 px pour le même rôle (186 usages à eux
deux), 13 / 13,5 / 14 / 14,5 pour du texte courant, 15 / 16 / 17 pour la même mise en avant.
Des écarts d'un demi-pixel, invisibles isolément, qui empêchent deux libellés de même nature de
s'aligner. Sept pas dans `lib/theme.js` (`TEXT`), nommés par rôle plutôt que par taille :
`xs: 11` / `sm: 12` / `base: 13` / `md: 15` / `lg: 18` / `xl: 20` / `title: 22`.

`xl` et `title` restent distincts malgré leurs 2 px d'écart : ils ne se ressemblent qu'en
taille — `xl` est un grand chiffre en JetBrains Mono, `title` un titre en Space Grotesk. Les
fondre ferait passer les indicateurs du tableau de bord pour des titres. Sept pas honnêtes
valent mieux que six dont un serait un compromis.

646 des 648 occurrences converties par script. Les 2 restantes sont volontaires :
`fontSize: size / 3` (initiale d'avatar, proportionnelle par construction) et le
`small ? 13 : 14` de `Button`, ramené à `TEXT.base` — un pixel d'écart ne distinguait rien, le
rembourrage s'en charge déjà.

**Vérification** — `npx vite build` et `oxlint` verts, 119/119 tests frontend. Comparaison
avant/après en navigateur (mise de côté par `git stash`, captures des mêmes écrans, restauration)
sur le tableau de bord et Mes préférences : le centrage hérité est bien ce qui disparaît, et
rien d'autre ne bouge. Thème sombre système vérifié **avec l'émulation réellement active**
(`matchMedia('(prefers-color-scheme: dark)').matches === true` contrôlé, pas supposé) :
`color-scheme` calculé reste `light`, contrôles natifs clairs. Page publique de devis :
`document.fonts.check('16px Inter')` renvoie `true`. Entreprise jetable supprimée après coup.

**Reste à faire** — les points 3 et 4 du chantier, non engagés : l'échelle d'espacement
(gap/padding sur 8, 10, 6, 16, 12, 20, 4, 5, 14, 7 — plus de 350 occurrences, le morceau le plus
risqué visuellement puisqu'il change la densité de toute l'application) et la réassignation des
arrondis par rôle (dette déclarée la veille).

### 2026-09-10 — Espacements sur une grille de 4 px, et arrondis rendus à leur rôle

Points 3 et 4 du chantier design, les deux derniers.

**L'échelle d'espacement**

Vingt et une valeurs distinctes sur 993 occurrences de `gap` / `padding` / `margin`. Comme pour
les tailles de police, la dispersion n'exprimait aucune hiérarchie : `gap: 6` (43), `gap: 8`
(61) et `gap: 10` (64) servaient tous les trois d'écart entre éléments d'une même ligne ;
`marginBottom` se répartissait sur 10 / 12 / 16 / 8 / 14 / 6 sans règle discernable.

Sept pas sur une grille de 4 px (`SPACE` dans `lib/theme.js`). Deux décisions méritent d'être
écrites, parce qu'elles ne découlent pas d'un arrondi mécanique :

- **Les ex æquo (10, 14, 22, 26) sont arrondis vers le bas.** Ce n'est pas un choix esthétique :
  réduire un espacement ne peut jamais provoquer un retour à la ligne ni un débordement,
  l'augmenter si. À défaut de pouvoir ouvrir les ~200 écrans concernés, c'est la règle qui rend
  la conversion sûre par construction.
- **Seule exception : 6 → 8 plutôt que 6 → 4.** Ces 114 occurrences sont presque toutes l'écart
  entre une icône et son libellé ; les ramener à 4 px collerait l'icône au texte au lieu de l'en
  séparer. La règle générale aurait donné le mauvais résultat ici, donc elle cède.

**Les valeurs de 0 à 3 px ne sont pas converties** (111 occurrences). Ce ne sont pas des
espacements mais des corrections optiques — un `marginTop: 1` qui aligne une icône sur la ligne
de base du texte. Les porter à 4 px casserait précisément l'alignement qu'elles servent à
obtenir. 882 occurrences converties, 111 laissées, délibérément.

**Hors périmètre, assumé** : les 166 rembourrages écrits en chaîne (`padding: '9px 12px'`).
Ce sont majoritairement des rembourrages de contrôles calés sur le CSS de l'ERP de référence, où
un pixel change la hauteur du composant — un autre problème (dimensionnement d'un composant) que
le rythme de mise en page traité ici.

**Les arrondis rendus à leur rôle**

Dette déclarée la veille : les douze valeurs avaient été ramenées à trois jetons, mais classées
sur leur valeur d'origine et non sur leur rôle — d'où 122 `RADIUS.card` contre 15
`RADIUS.control`. Le symptôme concret, mesuré dans le navigateur : dans le formulaire « Récoltes »,
le bouton « Ajouter » affichait 8 px et le champ de date juste à côté 4 px. Deux contrôles
voisins, deux arrondis.

Reclassement, sur le rôle réel et non sur la valeur :

- `Button` (primitive de `ui.jsx`) → `control`. Un seul changement qui corrige tous les boutons
  de l'application d'un coup.
- 14 `<button>` stylés en ligne → `control`, trouvés en remontant depuis chaque occurrence
  jusqu'à la balise englobante plutôt qu'en cherchant sur la même ligne (le style et la balise
  sont presque toujours sur des lignes différentes).
- Le conteneur du sélecteur segmenté Connexion/Inscription → `control` : son cadre extérieur
  était plus rond que les boutons qu'il contient.
- Les entrées du menu mobile → `control` : ce sont des boutons, pas des surfaces.
- Les étiquettes de taxes (`TaxSelect`) → `pill`, pour rejoindre `Badge`, qui est le même objet.
- **`.app-shell` perd son arrondi.** Un élément qui occupe tout l'écran n'a pas de coins à
  arrondir : ces 8 px ne faisaient que rogner le fond aux quatre angles de la page.

Ce qui **reste** en `card` a été vérifié un par un : bandeaux d'erreur, panneaux de modale,
sous-panneaux bordés, lignes de liste. Ce sont des surfaces, pas des contrôles — les passer en
`control` aurait été un changement de goût déguisé en règle. Répartition finale : 103 `card`,
32 `control`, 18 `pill`.

**Vérification** — build et `oxlint` verts, 119/119 tests. Comparaison avant/après en navigateur
sur le même écran à la même largeur (`git stash`, captures, restauration) : l'écart se lit à
environ 5 px sur la hauteur totale d'une carte de formulaire, rien ne casse. Contrôles mesurés
après coup plutôt que jugés à l'œil : bouton « Ajouter » et champ de date renvoient tous deux
`4px`, une carte `8px`, `.app-shell` `0px`. Absence de débordement horizontal confirmée
(`scrollWidth === clientWidth`), le correctif de largeur du 2026-09-06 tient toujours. Panneau
de navigation mobile ouvert et vérifié. Entreprise jetable supprimée après coup.

Le chantier design est terminé : palette, base typographique, échelle de texte, échelle
d'espacement, arrondis. Tout passe désormais par `src/lib/theme.js`.

### 2026-09-10 — Devis et Achats : rapprochement de la vue de l'ERP de référence

Écart signalé par l'utilisateur sur les onglets Ventes et Achats. Comparaison faite sur le clone
local (`sale/views/sale_order_views.xml`, `purchase/views/purchase_views.xml`), pas sur
l'instance hébergée.

**Le constat**

L'écart de fond n'a pas été traité ici : dans l'ERP de référence, la liste et le formulaire sont
deux écrans, et créer un document passe par un bouton « Nouveau ». Chez nous le formulaire de
création est ouvert en permanence au-dessus de la liste. Le corriger changerait le modèle
d'interaction ; c'est l'option C proposée à l'utilisateur, qui a retenu A et B.

**A — corrections ciblées**

- **Les référentiels ne sont plus sur l'écran des documents.** Conditions de paiement, Taxes et
  Comptabilité — Configuration étaient empilés en haut de l'onglet « Commandes », alors qu'un
  sous-onglet « Configuration » existait et ne contenait que les listes de prix. Les trois y sont
  passés. `DevisModule` continue de charger `taxes`/`paymentTerms` pour son formulaire ; il est
  démonté au changement de sous-onglet, donc il relit ces données au retour.
- **La liste des devis n'avait aucune colonne date.** Ajoutée, et l'ordre des colonnes aligné sur
  la référence (numéro, date, client, total, état — le total avant l'état, l'inverse d'avant).
- **Défaut latent trouvé en chemin** : `DEVIS_COLUMNS` renvoyait `d.date` brute. C'est une
  colonne `DATE` ; node-postgres en fait une `Date` JS lue dans le fuseau du serveur, ce qui
  décale l'affichage d'un jour. La date était déjà affichée dans la fiche d'un devis, donc le
  décalage était déjà visible ; l'ajouter à la liste l'aurait simplement rendu plus fréquent.
  `to_char` appliqué, même correctif que `validity_date`/`date_echeance` avant elle. Idem pour
  `achats_documents.date`.
- **Les achats n'avaient aucune référence.** `achats_documents.numero` (`ACH-2026-0007`), affiché
  en première colonne et en titre de la fiche. Les achats déjà en base sont numérotés par le
  backfill, par entreprise et par année, dans l'ordre chronologique.

**Le test a corrigé ma propre conception.** La première version dérivait le numéro du `MAX`
existant, avec un commentaire affirmant que cela évitait la réutilisation d'un numéro — ce que
fait `genererNumero()` de `routes/devis.js`, qui compte les lignes. Le test écrit pour épingler
cette différence a échoué : `MAX` ne réutilise pas un numéro du milieu, mais réutilise bien celui
du dernier achat supprimé. Remplacé par un vrai compteur, `achats_numero_sequence` (entreprise,
année, dernier), incrémenté par un UPSERT atomique et jamais décrémenté — une suppression laisse
un trou, ce qui est le comportement attendu d'une numérotation de pièces. Le compteur est amorcé
par la migration au plus haut numéro du backfill, sans quoi la première création après migration
heurtait l'index unique. `routes/devis.js` garde son `COUNT`, non touché ici : le corriger
demande la même table de compteurs et une reprise des devis existants, à faire séparément.

**B — Achats aligné sur Ventes**

Les deux objets sont symétriques et étaient présentés de deux façons différentes : Ventes avec
cinq sous-onglets, Achats sans aucun.

- Nouveau `AchatsAvecSousNav` (pendant de `VentesWithDevis`) : **Commandes | À recevoir |
  Produits**. « À recevoir » est à l'achat ce que « À facturer » est à la vente — une liste
  filtrée sur l'étape en cours, sans formulaire de création, exactement le comportement de
  `DevisModule` sous `filtreStatut`. Pas d'onglet Configuration : les achats n'ont aucun
  référentiel propre.
- La barre de sous-onglets, jusqu'ici écrite en dur dans `VentesWithDevis`, devient
  `SousNavOnglets`, partagée — pour que les deux écrans ne puissent plus diverger au fil des
  retouches.
- La fiche d'un achat reçoit une **barre d'état en chevrons** (Brouillon → Commandé → Reçu) et
  les boutons de transition, jusque-là dans la colonne Actions de chaque ligne. La liste ne garde
  que modifier et supprimer, soit exactement les deux icônes de la liste des devis, et la ligne
  entière devient cliquable. `DevisStatusBar` est généralisée en `StatusBarChevrons` plutôt que
  recopiée une troisième fois — `MoveStatusBar` de `FacturesModule` garde la sienne, en CSS et
  calée au pixel sur la référence.

**Vérification** — build et `oxlint` verts, 119/119 tests frontend, **389/389 tests
d'intégration** (+3 sur la numérotation, dont celui qui a trouvé le défaut ci-dessus). Migration
rejouée deux fois, compteur inchangé au second passage. Vérifié en navigateur sur une entreprise
jetable : références `ACH-2026-0001`/`0002` affichées, sous-onglets et « À recevoir » filtré
correctement, fiche d'achat avec chevrons et action « Marquer reçu » dans l'en-tête, référentiels
présents et fonctionnels sous Configuration, colonne date sur la liste des devis. Entreprise
nettoyée après coup.

### 2026-09-10 — Modèle liste-puis-formulaire (option C) sur Devis et Achats

Dernier des trois volets demandés sur l'écart de vue avec l'ERP de référence, et le seul qui
touche au modèle d'interaction : dans la référence, la liste et le formulaire sont deux écrans,
et créer passe par un bouton « Nouveau ». Chez nous le formulaire de création était ouvert en
permanence au-dessus de la liste, qui se retrouvait sous la ligne de flottaison — sur Ventes, il
fallait dépasser le formulaire complet pour voir ne serait-ce qu'un devis existant.

**Ce qui change**

- La liste est l'écran. Un bandeau de contrôle la surmonte : **création à gauche**, bascule
  Liste/Kanban à droite pour les devis (elle vivait tout en bas, sous le formulaire), exports à
  droite pour les achats.
- Le formulaire de création et la fiche d'un document **occupent l'écran à tour de rôle** au lieu
  de flotter au-dessus. Les deux fiches étaient des modales plein écran : l'overlay `position:
  fixed` devient un conteneur ordinaire, et les zones de défilement internes (`maxHeight: 92vh` +
  `overflow-y: auto` sur chaque colonne) disparaissent — c'est la page qui défile. Vérifié dans
  le navigateur : **zéro zone de défilement imbriquée** après coup, contre deux avant.
- Un **fil d'ariane local** (« Devis / DEV-2026-0001 », « Achats / ACH-2026-0001 ») avec retour à
  la liste. Le fil d'ariane de l'application s'arrête à l'onglet (voir `TopNavbar`) ; la
  référence y remonte le nom du document, mais l'y brancher demanderait de faire remonter un état
  interne de module jusqu'au shell — la fiche porte donc le sien.
- Après création, retour à la liste, où le document créé est visible. La référence reste sur la
  fiche du document enregistré ; ici le formulaire de création ne devient pas une fiche, la liste
  est le repère le plus proche.

**Coût réel : un seul état par module.** `detailId` (devis) et `detailDoc` (achats) marquaient
déjà qu'une fiche était ouverte ; il ne manquait qu'un booléen `creationOuverte` et deux dérivés
(`enFiche`, `enFormulaire`). Aucun changement de routage : l'URL reste au niveau de l'onglet,
ce qui veut dire qu'un rechargement de page ramène à la liste et qu'une fiche n'est pas
partageable par lien. Limite assumée — la brancher supposerait d'étendre le routage par onglet
existant à un niveau document.

**Deux reliquats de modale trouvés en vérifiant, pas en relisant** : la croix de fermeture des
deux fiches, positionnée en absolu dans l'angle du panneau. Une fois la fiche mise à plat, celle
du devis se retrouvait posée sur la colonne « Messages ». Retirées toutes les deux — le retour
passe par le fil d'ariane.

**Hors périmètre, assumé** : la modification d'un devis ou d'un achat reste une modale, lancée
depuis la fiche. Dans la référence, l'édition se fait dans le formulaire lui-même ; fusionner
fiche et édition est un chantier distinct, plus profond que le passage modale → écran traité ici.

**Vérification** — build et `oxlint` verts, 119/119 tests frontend. En navigateur, sur une
entreprise jetable : liste seule à l'arrivée, « Nouveau devis » et « Nouvel achat » ouvrant leur
écran avec fil d'ariane, retour fonctionnel, fiche rendue en pleine page avec sa barre de
chevrons. **Les deux cycles de création menés jusqu'au bout** par saisie réelle dans les champs
(événements React déclenchés, pas un appel d'API déguisé) : `ACH-2026-0002` et `DEV-2026-0002`
créés, écran revenu à la liste, documents visibles dedans. Absence de débordement horizontal
contrôlée. Entreprise nettoyée après coup.

### 2026-09-10 — Fonctions de liste : recherche, filtres, regroupement, tri, pagination

Suite de la comparaison avec l'ERP de référence. Après la structure des écrans, la liste
elle-même : elle n'avait que ses colonnes. Au-delà d'une vingtaine de pièces, retrouver un devis
signé de tel client relevait du défilement à l'œil.

**Une brique partagée, `src/components/ListeOutils.jsx`** — le hook `useListeOutils` porte tout
le calcul (recherche, filtres, tri, regroupement, pagination) et les composants
`BarreOutilsListe` / `EnteteTriable` / `LigneGroupe` / `PiedListe` le rendu des contrôles. **Le
rendu des cellules reste dans chaque module** : les deux listes ont des cellules très différentes
(pastilles d'état, boutons d'action, montants en devise), et les décrire en configuration aurait
coûté plus de cérémonie que le partage n'en fait gagner pour deux appelants. Le partage porte
donc sur la logique, pas sur le tableau.

Deux décisions à connaître avant de retoucher :

- **Les filtres se cumulent en OU, pas en ET.** Cocher « Brouillon » et « Signé » montre les
  deux. En ET, deux statuts exclusifs ne renverraient jamais rien.
- **Le regroupement désactive la pagination.** Couper un groupe en travers d'une page le rendrait
  illisible, et regrouper sert précisément à réduire ce qu'on a sous les yeux.

Tout se calcule côté client, sur la liste déjà chargée — cohérent avec le reste de l'application,
qui charge les documents d'une entreprise en une fois. Une pagination serveur deviendrait
nécessaire à un volume que ces écrans n'atteignent pas.

En vue Kanban, la recherche et les filtres s'appliquent aussi (ses colonnes regroupent déjà par
statut, et il n'y a rien à y paginer).

**Une erreur de ma part, trouvée en vérifiant.** L'insertion de la barre d'outils des achats
s'appuyait sur un motif `</div></Card>)}` qui n'était pas unique : elle a atterri dans
`ParcelMapTab`, à 2 600 lignes de sa cible. Le build passait — `enFormulaire` et `outilsAchats`
y sont simplement indéfinis — mais l'onglet Carte aurait planté au premier rendu. Elle n'est
apparue qu'en cherchant le champ de recherche dans l'écran Achats et en ne le trouvant pas.
Leçon déjà connue mais reprise ici : ancrer un remplacement sur un motif qui n'apparaît qu'une
fois, ou vérifier le nombre d'occurrences avant d'écrire.

**Un test creux, corrigé aussi.** La première vérification des filtres portait sur 30 devis tous
au même statut : filtrer par « Brouillon » renvoyait 30, exactement comme sans filtre. Le test ne
prouvait rien. Statuts diversifiés (18 brouillons / 7 signés / 5 envoyés), puis chaque
combinaison recoupée avec les comptes en base : 18, 25 (18+7), 7, 12 (7+5), 30 — tous exacts.

**Vérification** — build et `oxlint` verts, **130/130 tests frontend** (+11 : `ListeOutils.test.jsx`
couvre tri par défaut, inversion, tri numérique des références, recherche multi-champs, cumul des
filtres, regroupement et repli, pagination et sa désactivation en mode groupé, retour à la
première page, liste absente). Un de ces tests est lui-même né faux — un paramètre par défaut
faisait retomber le cas « liste absente » sur les données normales — et a été corrigé.
En navigateur, sur une entreprise jetable de 30 devis et 30 achats : pagination (1-25 puis
26-30), recherche par client et par référence, tri par total croissant puis décroissant,
regroupement par client (3 groupes de 10) et par fournisseur (7+8+8+7), filtres recoupés en base.
Onglet Carte revérifié après le correctif. Entreprise nettoyée, image frontend reconstruite.

**Observation, non traitée** : sur cette entreprise de test, un rechargement de page a créé une
seconde série de parcelles par défaut (6 au lieu de 3), suivie de 404 « Parcelle introuvable ».
C'est antérieur à ce chantier et sans rapport avec lui — signalé plutôt que corrigé en passant.

### 2026-09-10 — Parcelles dupliquées : la simulation tournait sur des données fictives

Observation signalée en fin du chantier précédent : sur une entreprise de test, un rechargement
de page créait une seconde série de parcelles par défaut (6 au lieu de 3), suivie de 404
« Parcelle introuvable ». Deux défauts distincts derrière, dont le second est le plus sérieux.

**Le symptôme visible : double amorçage.** `CulturesModule` charge les parcelles, et si le
serveur en renvoie zéro, il crée les trois parcelles par défaut. L'effet n'avait aucune garde de
concurrence : deux exécutions rapprochées trouvent toutes deux une liste vide et amorcent
chacune. React double les effets en mode strict *en développement* — d'où les 6 parcelles
constatées sur le serveur de dev. En production, `StrictMode` ne double pas les effets, mais un
remontage rapide produirait le même résultat. Corrigé par un `chargementRef` qui bloque une
seconde exécution tant que la première est en vol. Vérifié en base : aucune entreprise réelle
n'a de doublon, le problème était resté confiné aux entreprises de test.

**Le défaut de fond : l'état initial était `DEFAULT_PARCELLES`.** Trois parcelles fictives
portant les identifiants **1, 2 et 3**. Elles n'ont jamais été affichées — le rendu court-circuite
sur un écran de chargement tant que `loaded` est faux — mais la simulation d'irrigation, elle,
démarre immédiatement : toutes les 6 secondes elle fait varier humidité et température, et dès
qu'un seuil est franchi en mode automatique elle **écrit au serveur** (`updateParcelle`,
`createParcelleHistorique`).

`parcelles.id` est une séquence globale. En base, l'identifiant 3 appartient à une vraie parcelle
de l'entreprise 1. Autrement dit : tant que le chargement n'avait pas répondu, un ordre de vanne
calculé sur une humidité aléatoire pouvait partir vers une parcelle réelle. La fenêtre est
étroite (il faut que le chargement dépasse 6 secondes) et la portée limitée à l'entreprise dont
les identifiants coïncident — mais c'est une écriture sur des données réelles à partir de données
inventées, pas un simple bruit dans la console. Les 404 observés étaient la même cause vue de
l'autre côté : les identifiants 1 et 2 n'existent pas.

Corrigé en deux temps : l'état initial démarre **vide** (le placeholder ne servait à rien, le
rendu ne l'affichait jamais), et la simulation est **conditionnée à `loaded`** — elle ne peut
plus écrire avant que les vraies parcelles soient là.

**Vérification** — build, `oxlint` et 130/130 tests verts. Reproduction du scénario exact sur une
entreprise jetable neuve : premier chargement → 3 parcelles et exactement trois `POST
/cultures/parcelles` dans le journal réseau ; trois rechargements successifs → toujours 3
parcelles, uniquement des `GET`. Auparavant, un seul rechargement suffisait à en produire 6.
Entreprise nettoyée, image frontend reconstruite.

**Question laissée à l'utilisateur** : faut-il qu'une entreprise qui s'inscrit reçoive trois
parcelles de démonstration (« Parcelle A / Maïs / 46 % ») écrites dans sa base ? C'est un choix
d'accueil, pas un défaut — mais un nouvel utilisateur doit aujourd'hui les supprimer avant de
saisir les siennes.

### 2026-09-10 — Plus de parcelles de démonstration à l'inscription

Suite de la correction précédente, sur décision de l'utilisateur. `CulturesModule` créait trois
parcelles (« Parcelle A / Maïs », etc.) dans la base de toute entreprise arrivant avec une liste
vide. Un nouvel utilisateur devait les supprimer avant de saisir les siennes.

Le code se contredisait d'ailleurs déjà : le commentaire au-dessus de `DEFAULT_STOCKS` affirme
que « Cultures démarre volontairement vide plutôt que d'inventer des données agricoles », juste
au-dessus de stocks de démonstration pour le Poulailler. L'amorçage des parcelles disait
l'inverse. Retiré : `DEFAULT_PARCELLES`, `seedDefaultParcelles` et la branche de chargement qui
l'appelait. Le chargement se contente désormais de lire ce que le serveur renvoie.

**Deux états vides ajoutés**, sans quoi une exploitation neuve verrait deux écrans muets :
l'onglet Parcelles affiche une carte « Aucune parcelle enregistrée / Ajoutez votre première
parcelle avec le formulaire ci-dessus », et le fond de la Carte porte « La carte affichera vos
parcelles dès que vous en aurez ajouté une ». `ParcelMapTab` gérait déjà l'absence de parcelle
sans planter (`{selected && …}`), il lui manquait seulement de le dire.

**Les entreprises existantes gardent leurs parcelles.** Ce sont leurs données maintenant,
possiblement modifiées ; rien n'a été supprimé en base. Elles peuvent les retirer depuis l'écran
si elles le souhaitent.

**Vérification** — build, `oxlint` et 130/130 tests verts. Sur une entreprise jetable neuve :
aucune parcelle créée (0 en base, confirmé), les deux états vides affichés, puis ajout manuel
d'une parcelle « Parcelle Nord / Sorgho » — l'état vide disparaît, la parcelle apparaît, une
seule ligne en base. Contrôle final : les trois entreprises réelles ont toujours leur compte de
parcelles inchangé. Entreprise nettoyée, image frontend reconstruite.

**Non traité, à décider séparément** : Poulailler et Pisciculture amorcent eux aussi des stocks
de démonstration (`DEFAULT_STOCKS`, `DEFAULT_STOCKS_PISCICULTURE` — aliment, œufs, alevins…).
La demande portait sur les parcelles ; le même raisonnement leur est applicable si voulu.

### 2026-09-10 — Finitions de liste, et les champs de saisie enfin visibles

Deux demandes en une : terminer les fonctions de liste, et traiter des champs de formulaire
qu'on ne voyait qu'en cliquant dedans.

**Les champs de saisie.** `.flat-input` posait `border: 1px solid transparent` au repos, révélée
au survol ou au focus : sur fond blanc, un champ vide était indiscernable du fond. Relevé dans
le SCSS de la référence (`views/fields/fields.scss`, `.o_input`) : `border-width: 0 0 1px 0` —
**un soulignement seul, visible en permanence**, `--o-input-border-color` valant
`$o-form-lightsecondary` au repos et `$o-action` au focus, padding `2px 4px`. Repris à
l'identique, couleurs de notre palette. Un soulignement n'est pas le « rectangle » retiré à la
demande de l'utilisateur en août : les deux exigences tiennent ensemble. Le halo de focus
maison est restreint aux champs bruts — autour d'un simple trait, il donnait une auréole
flottante.

**Les finitions de liste.** Elles supposaient toutes de savoir quelles colonnes existent, ce
qu'un tableau écrit à la main ne dit pas. Les deux tableaux passent donc à des **colonnes
déclarées** rendues par un `TableauListe` générique, ce qui fait tomber d'un coup :

- **Sommes en pied** (`sum=`), portant sur l'ensemble filtré et non sur la page affichée —
  additionner une page n'aurait aucun sens comptable. Vérifié : 36 000 F CFA sans filtre,
  33 000 une fois les annulés écartés.
- **Sélection multiple** avec case « tout cocher » et barre d'actions groupées. Les actions se
  limitent à ce qui existe déjà à l'unité — suppression des brouillons côté devis, réception
  côté achats — et chaque document passe par la route unitaire : rien de neuf côté serveur,
  donc rien qui puisse se comporter autrement en lot qu'à l'unité.
- **Colonnes masquables** (`optional`), avec le mode `hide` pour celles cachées par défaut.
- **Colonnes ajoutées** : Vendeur et Facturation côté devis, Acheteur et « Reçu le » côté
  achats, plus « Valable jusqu'au » et Notes. Vendeur/Acheteur résolvent le nom du salarié
  quand le compte y est rattaché, sinon l'e-mail — `users` ne stocke rien d'autre.
- **Documents annulés atténués** (`decoration-muted`).
- **Montants alignés à droite**, comme toute colonne monétaire de la référence : les chiffres
  et leur somme tombent sur le même axe.

**Un défaut que j'ai introduit, trouvé par les tests.** La sous-requête donnant l'état de
facturation avait d'abord été ajoutée à `DEVIS_COLUMNS`. Or cette constante est relue par
`getDevisComplet`, lui-même appelé **depuis des transactions ouvertes** qui écrivent dans
`account_move` (`facturer`, `remettre-brouillon`) : la suite du cycle de vie s'est mise à
expirer, sur un test différent à chaque exécution. J'ai d'abord cru à l'instabilité déjà
documentée de ce fichier ; trois exécutions vertes après avoir mis mon changement de côté ont
montré que non, c'était bien moi. Isolé en neutralisant une sous-requête à la fois. Corrigé par
un `DEVIS_LISTE_COLUMNS` réservé à la route de liste — exactement la leçon déjà écrite pour
`DOCUMENT_COLUMNS` dans `achats.js` : une constante de colonnes lue dans plusieurs contextes
doit rester simple.

**Et un piège pour la troisième fois** : des backticks dans un commentaire SQL, à l'intérieur
d'un template literal JS. L'erreur remonte sous la forme d'un `SyntaxError: Unexpected
identifier` dans un fichier sans rapport. Voir la mémoire dédiée.

**Vérification** — build, `oxlint`, 130/130 tests frontend et **389/389 tests d'intégration**
(la suite devis rejouée trois fois de suite après correction). En navigateur, sur une entreprise
jetable de 8 devis et 8 achats : sommes recoupées à la main, sélection et désélection, menu des
colonnes basculant réellement les en-têtes, annulés grisés, soulignement des champs mesuré
(`border-width` 0/0/0/1, couleur au repos non transparente, padding 2px 4px). **Les deux actions
groupées exécutées jusqu'au bout** : 4 achats reçus → 4 écritures de finances pour −40 000 F CFA
en base, et 6 devis supprimés sur 8 sélectionnés — les 2 annulés, non supprimables, correctement
écartés de l'action. Entreprise nettoyée, images backend et frontend reconstruites.

**Ce qui reste hors d'atteinte sans inventer des données** : la priorité en étoile et l'« arrivée
prévue » d'un bon de commande supposent des champs que nous ne collectons pas. Les ajouter est
une décision produit, pas une finition.

### 2026-09-10 — Édition dans le formulaire, et routage par document

Les deux derniers écarts structurels que j'avais déclarés sur Devis et Achats.

**Routage par document.** L'URL s'arrêtait à l'onglet : un rechargement ramenait à la liste et
une fiche ne se partageait pas. Nouveau `src/lib/urlParams.js` — `useParametreUrl(nom)` lit et
écrit un paramètre de requête comme un état, prolongeant le principe déjà posé dans `App.jsx`
pour l'écran et l'onglet (« dérivés de l'URL plutôt que stockés en state »). Trois strates y
passent : `?onglet=` pour l'onglet interne d'un module, `?devis=` et `?achat=` pour le document
ouvert, avec la valeur `nouveau` pour l'écran de création.

**Le sens de dépendance est unique : l'URL commande, la fiche suit.** Un effet observe le
paramètre et charge le document ; les gestionnaires n'écrivent que dans l'URL. Écrire dans les
deux endroits les aurait laissés diverger.

**Un réglage corrigé après l'avoir vu échouer.** Le hook remplaçait l'entrée d'historique par
défaut, y compris à l'ouverture — j'avais raisonné « ouvrir puis fermer ne doit pas empiler deux
entrées ». Résultat mesuré : le bouton retour du navigateur quittait le module au lieu de
refermer la fiche. Ouvrir empile désormais explicitement, fermer remplace ; retour depuis une
fiche revient à la liste, ce qui est le contrat web habituel et le comportement de la référence.

**Écart assumé** : la référence route ses enregistrements par un segment de chemin
(`/odoo/sales/12`), nous par une chaîne de requête. Un chemin par document supposerait de
refaire le routage par onglet d'`App.jsx`, alors que le bénéfice recherché — rechargement
fidèle, lien partageable, retour navigateur — est déjà obtenu.

**Édition dans le formulaire.** Modifier un devis ou un achat ouvrait une fenêtre par-dessus la
fiche, qui se fermait au passage : on quittait le document pour l'éditer. Dans la référence, la
fiche EST l'éditeur. Les deux enveloppes modales deviennent des panneaux rendus dans l'écran du
document ; le contenu des formulaires est inchangé, seule leur enveloppe bouge. La fiche en
lecture cède la place au formulaire (`{detailId && detailData && !editingId}`), le fil d'ariane
signale « · en modification », et l'icône crayon de la liste ouvre maintenant le document
**puis** son édition, au lieu d'une fenêtre détachée de tout contexte.

**Vérification** — build, `oxlint`, 130/130 tests frontend, 389/389 tests d'intégration. En
navigateur, sur une entreprise jetable : un lien direct `?onglet=ventes&devis=110` ouvre à froid
le bon onglet et la bonne fiche ; un clic sur une ligne écrit `?devis=110` ; le retour navigateur
ramène à la liste ; le crayon depuis la liste ouvre le document en édition ; et une modification
de quantité enregistrée depuis le formulaire est retrouvée en base (10 → 25, total recalculé à
12 500). Même chaîne vérifiée côté achats. Entreprise nettoyée, image frontend reconstruite.

**Fausse alerte, notée pour mémoire** : ma sonde de vérification cherchait le texte « Rechercher
un devis » dans `innerText` pour conclure que la liste était revenue — c'est un `placeholder`,
qui n'y figure pas. La liste était bien là. La sonde était fausse, pas l'application.

### 2026-09-10 — Cycle de vie des achats : deux axes au lieu d'un

Dernier écart de fond signalé sur le module Achats, tranché avec l'utilisateur parmi trois
options : séparer l'état de commande de l'état de réception, sans aller jusqu'aux quantités
reçues ligne par ligne.

**Le défaut.** Un seul champ `statut` valait Brouillon → Commandé → Reçu. « Reçu » y était à la
fois une étape de commande et un constat de livraison, si bien que rien ne distinguait une
commande confirmée en attente de marchandise d'une commande jamais confirmée — et qu'annuler
une réception faisait reculer tout le document. L'ERP de référence tient deux champs séparés
(`purchase.order.state` draft/sent/purchase/cancel, et `receipt_status` pending/partial/full).

**Ce qui est en place.**
- Axe commande : `statut` ∈ Brouillon / **Envoyée** / Commandé / **Annulée**. L'étape d'envoi au
  fournisseur et l'annulation manquaient toutes deux.
- Axe réception : nouvelle colonne `etat_reception` ∈ en_attente / partiel / recu.
- **Stock et finances ne se déclenchent plus que sur l'axe réception**, à la réception complète.
  Confirmer une commande n'engage plus rien ; annuler une réception laisse la commande
  confirmée et ne fait repartir que la marchandise.
- Sept routes au lieu de trois : `envoyer`, `commander`, `annuler`, `remettre-brouillon`,
  `reception-partielle`, `recevoir`, `annuler-reception`.
- Migration des lignes existantes avant la pose des contraintes : « Reçu » devient
  « Commandé + recu », « Commandé » devient « Commandé + en_attente ».

**Limite assumée, inscrite dans le code.** Sans quantité reçue par ligne, « Partiellement reçu »
est un **constat**, pas un mouvement : on ne sait pas quoi entrer en stock. L'état sert à
l'équipe (« une partie est arrivée, la commande reste ouverte ») ; stock et finances attendent la
réception complète. C'est l'option choisie ; les quantités par ligne lèveraient la limite.

**Côté écran** : la barre de chevrons ne porte plus que la commande, « Annulée » en sort comme
statut terminal (badge rouge, même traitement qu'un devis annulé) ; la fiche affiche deux lignes
d'en-tête, COMMANDE et RÉCEPTION, chacune avec ses propres actions ; la liste gagne une colonne
Réception à côté de la colonne Commande, et sept pastilles de filtre couvrant les deux axes. Le
sous-onglet « À recevoir » devient le croisement des deux — commande confirmée, marchandise pas
entièrement arrivée — ce qui est exactement la question qu'il posait.

**Deux défauts de ma part, trouvés en vérifiant.**
- **Quatrième occurrence des backticks dans un commentaire SQL.** Une note en mémoire n'a
  manifestement pas suffi : j'ai ajouté un **test** (`server/src/test/sqlBackticks.test.js`) qui
  balaie `server/src` et échoue en nommant fichier et ligne. Vérifié par test négatif — un
  backtick réintroduit volontairement le fait bien échouer.
- **Deux colonnes portaient l'identifiant `reception`** dans la liste des achats : la date de
  réception (masquée par défaut) et le nouvel état. Le masquage portant sur l'identifiant,
  il éteignait les deux — la colonne Réception n'apparaissait tout simplement pas, sans erreur.
  Trouvée en lisant les en-têtes du tableau rendu, pas le code.

**Et une fragilité préexistante, corrigée à la racine.** Ajouter quatre tests a suffi à faire
échouer, à chaque exécution, des tests différents et sans rapport (RH, journaux, récoltes). Trois
exécutions vertes après avoir mis mon changement de côté ont montré que le déclencheur venait
bien de moi ; la cause, elle, était ailleurs : `POST /register` limite les inscriptions par IP, et
l'assistant de test dérivait l'IP de `Date.now() + seq`. Deux fichiers démarrant dans la même
milliseconde partageaient donc le même compteur de limite, et le `beforeAll` d'un describe entier
tombait. Une part aléatoire rend la collision négligeable. **393/393 deux fois de suite** après
correction, contre des échecs tournants avant.

**Vérification** — build, `oxlint`, 130/130 frontend, 69/69 unitaires backend, 393/393
d'intégration (+4 sur les deux axes). En navigateur, les quatre combinaisons créées puis lues :
Brouillon/en attente, Envoyée/en attente, Commandé/partiellement reçu, Commandé/reçu — avec **une
seule écriture de finances**, celle du reçu. Puis « Marquer reçu » depuis la fiche (deuxième
écriture, −7 000 F CFA au total) et « Annuler réception » (retour à une écriture, commande
toujours confirmée, date effacée, réapparition dans « À recevoir »). Entreprise nettoyée, images
backend et frontend reconstruites.

### 2026-09-10 — Champs de saisie : le soulignement seul ne suffisait pas

Signalé à l'usage après la première correction : les champs restaient difficiles à repérer.
Mesuré plutôt que discuté — le trait posé la veille valait `#DAD6C4`, soit **1,46:1 sur blanc**.
Un cheveu. Et la valeur de la référence elle-même (`$o-form-lightsecondary` = `#ccc`) ne dépasse
pas 1,61:1 : sur ce point précis, la référence n'atteint pas le seuil WCAG 1.4.11, qui demande
**3:1 pour la limite d'un élément d'interface**.

Deux changements, tous deux dans la palette et non dans la structure :
- **Un fond léger** (`COLORS.surfaceAlt`) : c'est lui qui fait lire le champ comme une *zone* à
  remplir, et non comme un trait. C'est le mot employé par l'utilisateur — « les rectangles qui
  servent de remplissement » — et le soulignement seul n'y répondait pas.
- **Un trait à `#888E81`** (nouveau jeton `COLORS.inputLine`) : 3,37:1 sur blanc, 3,00:1 sur le
  fond du champ. Le seuil est tenu dans les deux contextes.

Au focus, le champ passe au blanc et son trait au vert d'action : la zone active se détache de
toutes les autres, ce que la référence obtient en changeant `--o-input-border-color`.

Le « rectangle » retiré à la demande de l'utilisateur en août ne revient pas : il n'y a toujours
ni encadré ni coins arrondis, seulement un fond et une base. **Écart assumé avec la référence sur
la valeur du trait**, sur un point où elle est en dessous du seuil d'accessibilité — et
l'utilisateur avait posé « tout respecter sauf la couleur ».

### 2026-09-10 — Audit Stocks et Comptabilité face à l'ERP de référence (sans modification)

Demandé après l'alignement de Ventes et Achats. Lecture croisée du clone local (menus et vues des
modules `stock` et `account`) et de nos deux écrans, ouverts dans le navigateur. **Aucun code
touché** : ce qui suit est un constat, classé par valeur.

#### Stocks

**Le constat qui domine tous les autres : une machinerie entière est construite et invisible.**
- `stock_quants` (quantité par produit ET par emplacement) : 7 lignes en base, alimentées à
  chaque mouvement — **aucune route ne les lit, aucun écran ne les affiche**.
- `emplacements_stock` : 5 emplacements par entreprise (dont « production », ajouté pour la
  transformation), 40 lignes en base — jamais montrés.
- `stock_moves` : lu par **un seul** consommateur, le graphique « Valeur du stock »
  (`produits.js`). Aucune liste de mouvements, alors que la table est le registre de traçabilité.

Autrement dit, l'étape « stock multi-emplacements » livrée le 2026-09-04 n'a pas d'interface.
Même classe de défaut que le module Observations sans point d'entrée, ou le lien public de devis
sans écran : construit, testé, maintenu — et hors de portée de l'utilisateur.

**Écart de structure.** La référence sépare Opérations / Produits / Rapports / Configuration.
Notre onglet empile sur une seule page : formulaire de création, puis quatre panneaux de
configuration (Gabarits, Recettes, Ordres de transformation, HACCP), puis un graphique, puis la
liste des articles. C'est le défaut déjà corrigé sur Ventes — la configuration posée sur l'écran
de travail — à plus grande échelle.

**Fonctions absentes**, de la plus utile à la plus discutable pour une exploitation :
1. **Ajustement d'inventaire.** Corriger un écart entre stock théorique et stock compté est
   aujourd'hui impossible autrement qu'en modifiant la quantité de l'article à la main, ce qui
   contourne le registre de mouvements. Un stock qui ne peut pas être recompté dérive.
2. **Rebut / perte.** Aucune façon d'enregistrer une avarie, une casse ou une péremption. Sur des
   denrées agricoles, c'est le mouvement de stock le plus banal après l'achat et la vente.
3. **Règles de réapprovisionnement.** Nous avons un seuil d'alerte ; la référence en tire une
   proposition de commande (min/max par emplacement).
4. **Transferts (`stock.picking`)** — l'objet central de la référence : réception, livraison et
   transfert interne sont des documents à part entière, avec leur cycle. Chez nous le mouvement
   de stock n'est qu'un effet de bord d'un achat ou d'un devis. C'est le plus gros écart, et le
   plus discutable : sur une exploitation mono-site, sa valeur reste à démontrer.
5. **Prévisionnel** (entrées/sorties à venir).

#### Comptabilité

**Un problème de nommage, d'abord.** L'onglet « Comptabilité » d'un module (Cultures, Poulailler,
Pisciculture) affiche trois totaux — ventes, achats, solde — et la liste des transactions du
module. C'est un relevé, pas de la comptabilité. La vraie comptabilité vit ailleurs, sous
Finance → Factures. Deux endroits portent donc des noms qui invitent à les confondre.

**Les fondations sont solides**, et il faut le dire avant la liste des manques : `account_move` /
`account_move_line` en partie double, journaux et séquences, plan de comptes, taxes, conditions
de paiement, lettrage partiel et total, avoirs, écart de change, chaîne d'inaltérabilité par
hachage, balance âgée, paiements autonomes. C'est plus profond que ce qu'on trouve dans la
plupart des applications de gestion agricole.

**Ce qui manque tient en un mot : les états.** On saisit des écritures correctes, mais on ne peut
en tirer aucune des lectures pour lesquelles on tient une comptabilité :
- **Grand livre** (mouvements par compte) — absent.
- **Balance générale** (soldes de tous les comptes, contrôle débit = crédit) — absent.
- **Compte de résultat** et **bilan** — absents.
- **Déclaration de TVA** (taxes collectées / déductibles sur une période) — absent, alors que
  `account_move_line_taxes` porte déjà la donnée.
- **Écritures diverses** : les pièces de type `entry` sont exclues de la liste des factures (fix
  du 2026-09-01) et aucun autre écran ne les montre — elles sont saisissables par l'API,
  invisibles à l'écran.
- **Date de clôture / verrouillage d'exercice** — absent (la chaîne de hachage protège une pièce,
  pas une période).

#### Classement proposé

1. **Rendre visible le stock par emplacement** — la donnée existe, est juste et est maintenue ;
   il manque une route et un écran. Rapport valeur/coût le plus élevé des deux modules.
2. **Grand livre + balance générale** — les deux états dont tout le reste découle, et les données
   sont déjà là. Sans eux, la profondeur comptable existante ne sert à personne.
3. **Ajustement d'inventaire et rebut** — les deux mouvements qui manquent pour qu'un stock reste
   juste dans la durée.
4. **Séparer configuration et travail** sur l'écran Stocks, comme fait sur Ventes.
5. **Compte de résultat, bilan, déclaration de TVA** — plus lourds, et dépendants du plan de
   comptes réellement utilisé par l'entreprise.
6. **Transferts et prévisionnel** — à ne considérer qu'une fois le reste en place, et seulement
   si l'usage réel les réclame.

### 2026-09-10 — Le stock par emplacement devient visible (chantier 1 de l'audit)

Premier point du classement de l'audit, et le meilleur rapport valeur/coût : la donnée existait,
juste et maintenue, il manquait une route et un écran.

**Deux routes de lecture** dans `routes/produits.js` :
- `GET /produits/stock-emplacements?module=` — une ligne par couple produit × emplacement, avec
  quantité, réservée et disponible. Liste à plat plutôt que matrice : une matrice devient
  illisible dès qu'un module a beaucoup d'articles, et la liste se regroupe à l'écran par produit
  ou par emplacement. Les lignes à zéro sont exclues — un quant retombé à zéro n'apprend rien.
- `GET /produits/mouvements?module=&limite=` — le registre de `stock_moves`, provenance et
  destination comprises. À ne pas confondre avec `GET /:id/mouvements`, qui lit `stock_mouvements` :
  **deux tables de mouvements coexistent** dans ce projet, un journal simple par article (un delta,
  sans emplacement) et ce registre-ci. Les fusionner est un chantier à part ; les exposer toutes
  les deux, non.

**Un écran**, `StockEmplacementsPanel.jsx`, monté dans `StocksTab` : deux panneaux pliables,
« Stock par emplacement » et « Mouvements de stock », l'un et l'autre chargés paresseusement.
Ils réutilisent les outils de liste partagés — recherche, filtres, regroupement, tri, pagination,
colonnes masquables : regrouper un inventaire par emplacement ou par article est exactement ce
qu'on veut en faire. Les emplacements sont colorés par type, et le texte d'aide dit ce que
l'utilisateur doit savoir : **seul l'emplacement interne est du stock disponible**, le reste est
chez un tiers, en production ou perdu.

**Constat noté au passage** : l'emplacement « Pertes » existe déjà en base pour chaque
entreprise. L'infrastructure du rebut est donc là ; il manque l'opération qui y déplace de la
marchandise — c'est le point 3 du classement, pas celui-ci.

**Une erreur de ma part dans les tests** : `createProduit` renvoie `{ id, categorieId, nom }` et
non un identifiant nu ; passer l'objet entier comme `stockId` faisait échouer la création d'achat
en 500. Diagnostiquée en faisant remonter le corps de la réponse plutôt qu'en relisant.

**Vérification** — build, `oxlint`, 130/130 frontend, **398/398 d'intégration** (+5 : stock reçu
visible sur l'emplacement interne avec sa quantité disponible, lignes à zéro exclues, mouvement
portant sa provenance et sa destination, module invalide → 400 sur les deux routes, isolation
entre entreprises). En navigateur sur une entreprise jetable : un achat de 30 sacs reçu apparaît
en « Emplacement principal | 30 | 30 », et le mouvement « Fournisseurs → Emplacement principal,
30, achat_reception » s'affiche dans le registre. Entreprise nettoyée, image frontend reconstruite.

### 2026-09-10 — L'écran Stocks en quatre sous-onglets (chantier 4 de l'audit)

Signalé par l'utilisateur : les panneaux pliables « sont moches comme ça ». Il avait raison, et
j'y avais contribué la veille — en exposant le stock par emplacement, j'ai porté l'écran à **six
barres grises empilées** sous le formulaire de création.

Découpage repris de la référence (Opérations / Produits / Rapports / Configuration), avec la même
`SousNavOnglets` que Ventes et Achats — un troisième écran qui se lit comme les deux autres :

- **Articles** — formulaire de création, filtres par type d'intrant, liste, alerte des lots
  périmés. Plus aucun panneau replié : c'est l'écran de travail.
- **Inventaire** — stock par emplacement, mouvements, valeur du stock. Les trois lectures.
- **Transformation** — ordres de transformation et registre HACCP, l'opération et sa pièce
  sanitaire.
- **Configuration** — gabarits & attributs, recettes de transformation.

**Un panneau seul sur son onglet s'ouvre** (nouveau `ouvertParDefaut`) : un onglet dont tout le
contenu serait une barre repliée n'aurait aucun intérêt. Le repli garde son sens quand deux
panneaux se partagent l'écran.

**« Gérer les catégories » reste dans le formulaire de création** malgré sa nature de
configuration : c'est là qu'on en a besoin, au moment de classer un article qu'on saisit. La
référence fait de même avec ses « créer et modifier » depuis un champ.

**Un texte rendu faux par le déplacement, corrigé** : « Créez d'abord une recette **ci-dessus** »
ne valait plus rien une fois les recettes passées en Configuration. Il dit maintenant où aller.
Trouvé en lisant l'écran, pas le code — un renvoi à une position sur la page ne survit pas à une
réorganisation, et rien ne l'aurait signalé.

**Vérification** — build, `oxlint`, 130/130 tests frontend. Les quatre onglets ouverts en
navigateur : Articles réduit à son formulaire et sa liste, Inventaire avec le stock ouvert et les
mouvements repliés, Transformation avec ses deux registres, Configuration avec ses deux
formulaires. Entreprise jetable nettoyée, image frontend reconstruite.

### 2026-09-10 — Ventes rangé, et une régression que j'avais laissée passer

Même demande que pour Stocks. Mais la lecture de la source a déplacé le sujet : sous Ventes →
Configuration, **seules les listes de prix relèvent des ventes**. Conditions de paiement, taxes,
journaux et plan de comptes sont, dans l'ERP de référence, sous Comptabilité → Configuration
(`account/views/account_menuitem.xml`). Ils étaient chez Ventes parce que c'est là qu'ils ont
été construits, pas parce que c'est leur place.

- **Ventes → Configuration** ne garde que les listes de prix.
- **Finance → Factures** gagne une barre de sous-onglets — **Factures | Rapports |
  Configuration** — et accueille les trois référentiels comptables. C'est cet écran qui EST notre
  comptabilité ; `ComptaReportsPanel`, jusqu'ici posé en permanence au-dessus de la liste des
  factures, prend l'onglet Rapports.
- `SousNavOnglets` **quitte `App.jsx` pour `ListeOutils.jsx`** : `FacturesModule` en a besoin, et
  un composant ne peut pas importer `App.jsx` sans créer un cycle. Exactement la raison qui avait
  fait sortir la palette dans `lib/theme.js`.

#### La régression

L'onglet Ventes rendait un **écran blanc**, et depuis le commit du cycle de vie des achats
(5aacd52) — soit plusieurs heures pendant lesquelles l'utilisateur a testé l'application.

Cause : en renommant `filtreStatut` en `filtreReception` dans `AchatModule`, j'ai utilisé un
remplacement de chaîne **global** sur tout `App.jsx`. Le motif
`{!filtreStatut && creationOuverte && (` existait aussi dans `DevisModule`, à 1 100 lignes de là.
Renommée, cette garde lisait une variable jamais déclarée dans ce composant — et lire un
identifiant non déclaré lève une `ReferenceError` en module strict, ce qui fait tomber tout
l'arbre React.

Ni le build, ni `oxlint`, ni les 130 tests frontend ne l'ont vue : le fichier reste
syntaxiquement valide, et aucun test ne monte `DevisModule`. Je ne l'ai vue qu'en rouvrant
l'onglet Ventes — que je n'avais pas rouvert après le changement des achats, ayant vérifié
seulement l'écran que je modifiais.

**Ce qu'il faut en retenir**, et qui vaut au-delà de ce cas : un remplacement global dans un
fichier de 9 000 lignes doit être borné à la portée visée, ou compté avant d'être appliqué. Et
après une modification qui touche un motif partagé, rouvrir les écrans **voisins**, pas seulement
celui qu'on visait — c'est la deuxième fois de la journée qu'une ancre non unique casse quelque
chose à distance (voir la barre d'outils atterrie dans `ParcelMapTab`).

**Vérification** — build, `oxlint`, 130/130 tests. En navigateur : Ventes → Commandes rend de
nouveau sa liste, Ventes → Configuration ne montre plus que les listes de prix, et Finance →
Factures affiche ses trois onglets, Configuration comprise avec ses quatre conditions de paiement
et ses cinq journaux. Entreprise jetable nettoyée, image frontend reconstruite.

### 2026-09-10 — Grand livre et balance générale (chantier 2 de l'audit)

La partie double était complète depuis fin août — écritures, journaux, plan de comptes, lettrage,
avoirs, écart de change — mais **aucun état n'en sortait**. On saisissait ; on ne pouvait rien
lire. L'audit du matin l'avait classé deuxième manque du module ; c'est le plus structurant,
parce que tout le reste (compte de résultat, bilan, déclaration de TVA) se lit sur ces deux
états-là.

- `GET /api/factures/grand-livre` — lignes d'écriture par compte, avec **solde d'ouverture** et
  solde progressif calculés côté serveur. Le progressif est une valeur comptable : la laisser
  calculer à l'écran l'aurait rendue dépendante de l'ordre de tri de la liste.
- `GET /api/factures/balance` — un compte par ligne : à-nouveau, débit, crédit, clôture, plus des
  totaux qui portent le drapeau `equilibre`. Un compte jamais mouvementé **et** sans à-nouveau
  est exclu ; un compte soldé à zéro sur la période mais qui avait un solde avant reste visible —
  c'est justement ce qu'on vérifie en clôture.
- Frontend : `src/components/ComptaEtatsPanel.jsx`, dans Finance → Factures → **Rapports**,
  au-dessus du suivi client. Période partagée entre les deux états — les consulter sur des bornes
  différentes serait le meilleur moyen de comparer deux choses qui ne se comparent pas.

#### Trois pièges connus, évités volontairement

L'utilisateur avait demandé d'éviter les erreurs déjà mémorisées. Les trois qui s'appliquaient :

1. **Routes déclarées avant `GET /:id`**, comme `aged-receivable` et `overdue` — sinon
   `/grand-livre` serait capté comme un identifiant.
2. **Aucun backtick dans les commentaires SQL** des littéraux de gabarit. Le garde permanent
   (`sqlBackticks.test.js`, écrit la veille après la 4ᵉ occurrence) est passé au vert.
3. **`fmtMoney`, jamais `enDevise`** : `debit`/`credit` sont toujours en devise de l'entreprise.
   Y appliquer la devise du document réintroduirait le bug multi-devise en sens inverse. C'est
   écrit en tête des deux fichiers, pas seulement ici.

#### Deux défauts trouvés en construisant, pas en relisant

- `String.prototype.replace` **consomme les `$`** d'une chaîne de remplacement : le filtre par
  compte s'est écrit `${paramsLignes.length}` littéralement au lieu de s'interpoler. Corrigé en
  passant une fonction plutôt qu'une chaîne.
- Numérotation de paramètres décalée : le même filtre utilisait `$4` dans une requête qui n'en
  comptait que deux. Séparé en `paramsLignes`/`paramsOuverture` — la requête d'ouverture n'a pas
  les mêmes bornes que celle des lignes, prétendre le contraire ne pouvait que casser.

**Vérification** — 6 tests d'intégration ajoutés, **404/404** ; build, `oxlint`, 130/130 tests
frontend. En navigateur sur une entreprise jetable à deux factures postées : balance équilibrée
(74 000 au débit comme au crédit), grand livre avec ses soldes progressifs (50 000 → 74 000), et
une période déplacée après la dernière écriture qui reporte correctement le à-nouveau sans
afficher un seul mouvement. Onglets voisins (Factures, Configuration) rouverts — le garde que je
m'étais donné la veille. Entreprise jetable purgée, image frontend reconstruite.

### 2026-09-10 — Ajustement d'inventaire et rebut (chantier 3 de l'audit)

Jusqu'ici, aucun mouvement de stock ne partait de l'utilisateur : tout passait par un achat, une
vente, un intrant ou une transformation. Compter ses articles et constater un écart, ou déclarer
une marchandise perdue, n'avait aucun point d'entrée. Deux routes (`POST /api/produits/inventaire`
et `/rebuts`, déclarées avant `/:id/…`) et un panneau dans **Stocks → Inventaire**.

Aucune table nouvelle : `stock_moves` porte déjà date, quantité, trajet, motif et
`document_type`, et le registre des mouvements livré le matin même en est l'historique. Aucune
des deux opérations n'est réversible — l'ERP de référence interdit de supprimer un rebut validé
(`stock_scrap.py`, `_unlink_except_done`) et une erreur de comptage se corrige par un nouveau
comptage. Une opération annulable aurait coûté une table et un cycle de vie pour rien.

**Un sixième emplacement virtuel, `inventaire`.** `perte` sert déjà aux intrants consommés ; y
verser aussi les écarts de comptage rendrait impossible de répondre à « combien ai-je jeté ce
mois-ci ? ». Un écart n'est pas une perte identifiée, et la référence les sépare pour cette
raison. Le backfill jumeau de celui de `production` a été généralisé en une fonction paramétrée
plutôt que copié : `seedEmplacementTypePourEntreprisesExistantes(type)`. 7 entreprises au premier
passage, 0 au second.

#### Le piège visé, et la preuve qu'il est gardé

`resoudreEmplacements` (`stockSync.js`) filtre sur une liste `type IN (...)` **codée en dur**.
C'est elle qui avait fait échouer `production` à l'étape 2 de la transformation :
`produits.quantite` restait juste, `stock_quants` et `stock_moves` restaient silencieusement
vides. Le nouveau type y a été ajouté en même temps que la migration — et surtout, les tests
assèrent le **quant et le mouvement**, pas seulement la colonne pont. Vérifié en le prouvant :
le type retiré de la liste, deux tests tombent (`quant attendu 120, reçu 0`) pendant que
l'assertion sur `produits.quantite` passe toujours. Un test qui n'aurait regardé que cette
colonne n'aurait rien vu.

#### Un chiffre faux, trouvé en vérifiant la base après coup

Après un ajustement, `produits.quantite` valait 780 et le quant interne 0 — donc « Stock par
emplacement » affichait **0 ligne** pour une entreprise détenant 940 kg d'articles. Cause
préexistante : ni `POST` ni `PUT /api/produits` n'écrivent de `stock_quants`, si bien qu'un
article créé avec un stock initial n'en a jamais eu. Le chantier 1 avait exposé le défaut, le
chantier 3 le rendait criant.

Le correctif tenait dans la sémantique de l'opération : un comptage **pose** la quantité, il ne
l'incrémente pas — c'est ce que fait la référence (`inventory_quantity` est une valeur absolue).
`ajusterInventaire` écrit donc le quant interne à la quantité comptée, ce qui fait de cet écran
l'outil qui réaligne réellement le stock. Corollaire trouvé dans la foulée : l'appel doit avoir
lieu **même à écart nul**, sinon un article compté et trouvé juste resterait invisible du stock
par emplacement. Trois comptages sans écart plus tard, les trois quants concordent avec la liste
des articles et aucun mouvement parasite n'a été créé.

Le théorique, enfin, est le disponible **plus** le réservé, à l'écran comme au serveur : ce
qu'on s'attend à trouver en rayon inclut la marchandise promise par un devis signé mais toujours
là. Le disponible seul aurait fait passer chaque réservation en cours pour un manquant.

**Vérification** — 9 tests d'intégration, **413/413** (`stockQuants.test.js` passe de « 5
emplacements » à 6, cassure attendue, même mise à jour qu'à l'arrivée de `production`) ; build,
`oxlint`, 130/130 frontend. En navigateur : comptage à 780 sur 800 avec l'écart affiché avant
validation, rebut refusé au-delà du stock (« Quantité supérieure au stock disponible (45) », la
saisie conservée), rebut de 5 accepté, mouvements tracés vers deux emplacements distincts, liste
des articles à jour sans rechargement. Écrans voisins rouverts : Articles, Transformation,
Configuration, et le même panneau sous Poulailler — `StocksTab` est partagé par les trois
modules.

**Signalé sans corriger** : le seed de stocks de démonstration de Poulailler/Pisciculture crée
les articles **en double** (constaté en base : trois articles, six lignes). Le bloc
`if (fetched.length === 0 && seedList)` n'a aucun garde-fou contre un double montage — le même
défaut que celui déjà corrigé pour les parcelles de démonstration de Cultures. Hors périmètre, et
une décision de l'utilisateur est déjà en attente sur ces stocks de démonstration.

### 2026-09-10 — Compte de résultat, bilan et déclaration de TVA (chantier 5 de l'audit)

Les trois états qui se lisent sur le grand livre et la balance livrés le matin même. Comme la
météo ou le registre HACCP, ils sont conçus ici : **la source communautaire de l'ERP de
référence ne contient aucun module de rapport comptable**. Ce qu'on lui reprend, ce sont les deux
règles portées par `account_type` (`account_account.py`), et elles décident de toute la forme :

1. `_get_internal_group` = le préfixe d'`account_type` avant le premier `_`. income/expense font
   le compte de résultat, asset/liability/equity font le bilan, `off_balance` n'entre dans aucun
   des deux.
2. `_compute_include_initial_balance` est faux pour income/expense : un compte de résultat repart
   de zéro à chaque exercice, un compte de bilan cumule depuis toujours. D'où la différence de
   forme — **le compte de résultat se lit sur une période, le bilan à une date**.

Trois routes dans `factures.js`, déclarées avant `/:id` comme leurs aînées, et trois sections
dans `ComptaEtatsPanel` qui réutilisent la période déjà partagée.

#### Le bilan ne pouvait pas s'équilibrer, et c'était structurel

Le plan de comptes par défaut n'a **ni capitaux propres ni compte de résultat de l'exercice**
(`equity_unaffected`), et l'application ne passe aucune écriture de clôture. Dès la première
facture, l'actif portait la créance client face à un passif vide. Plutôt que d'exiger une
clôture qui n'existe nulle part, le bilan porte deux lignes calculées au passif : **résultat de
l'exercice** (produits − charges de la période) et **report à nouveau** (ce qui précède). C'est
ce qu'affiche un bilan tant que la clôture n'est pas passée, et l'égalité est vérifiée à l'écran
comme celle de la balance — pas laissée à l'addition mentale du lecteur.

Le test qui compte n'est pas « le total vaut 128 120 » mais « l'actif égale le passif, y compris
quand la période exclut les écritures » : le résultat bascule alors du résultat de l'exercice
vers le report à nouveau, et un découpage bâclé se verrait immédiatement. Vérifié aux deux
niveaux, test et navigateur.

#### Le piège du `$`, repris par un autre chemin

`resultatEntre` construisait `m.date >= $${params.length}` — et l'insertion du bloc dans
`factures.js` via `String.prototype.replace` a **mangé le `$`**, produisant `m.date >= 3` et un
`operator does not exist: date >= integer`. C'est exactement le défaut déjà rencontré sur le
filtre par compte du grand livre, arrivé cette fois par le script d'insertion et non par le code
lui-même. Trouvé par les tests, pas en relisant : quatre d'entre eux sont tombés d'un coup.

#### Deux décisions d'honnêteté

- **La TVA déductible est partielle, et l'écran le dit.** Les achats du module Achats ne
  produisent aucune écriture comptable — `achats_documents` n'est relié à aucun `account_move` —
  donc seules les factures fournisseurs saisies dans Finance → Factures y entrent. Un bandeau le
  déclare sur l'état lui-même : un chiffre partiel présenté comme complet est pire que pas de
  chiffre.
- **La charge utile de la TVA a été normalisée en positif.** La première version publiait la base
  et la taxe déductibles en négatif (`credit - debit` sur une facture fournisseur) et l'écran les
  ré-inversait. Une API dont il faut connaître l'astuce du signe est un piège pour le prochain
  lecteur ; le signe se corrige à la source, avec un test qui le garde.

Deux pièges connus visés au passage : le calcul de base par taxe passe par **deux agrégats
séparés** — les montants viennent des lignes portant `tax_line_id`, les bases des lignes produit
liées par `account_move_line_taxes` — car une seule requête aurait donné un produit cartésien dès
qu'une ligne porte deux taxes ; un test le vérifie explicitement. Et `fmtMoney` partout, jamais
`enDevise` : `debit`/`credit` sont en devise de l'entreprise.

**Vérification** — 11 tests d'intégration, **424/424** ; build, `oxlint`, 130/130 frontend. En
navigateur sur une entreprise jetable à deux factures de vente et une facture fournisseur :
résultat 104 000 − 30 000 = 74 000 avec le badge « Bénéfice », bilan équilibré à 128 120 des deux
côtés, TVA 18 720 collectée − 5 400 déductible = 13 320 nets. Période déplacée après la dernière
écriture : le compte de résultat se vide, le bilan garde son actif et bascule les 74 000 en
report à nouveau sans rompre l'équilibre. Écrans voisins rouverts (Factures, Configuration),
aucune requête en échec. Entreprise jetable purgée, images reconstruites.

### 2026-09-10 — Transferts entre emplacements et stock prévisionnel (chantier 6, audit COMPLET)

Dernier item de l'audit du matin. Il a commencé par un constat qui a redéfini le chantier :
**une entreprise n'avait qu'un seul emplacement interne**, seedé à l'inscription, et
`emplacements_stock` n'avait aucune route. Un « transfert entre emplacements » n'avait donc
aucune destination possible. Créer des emplacements était le préalable, pas un supplément.

- `/api/emplacements-stock` : CRUD des **internes** seulement. Les virtuels (client, fournisseur,
  perte, production, inventaire) sont structurels — `stockSync.js` les résout par type pour
  qualifier chaque mouvement, en créer ou en supprimer casserait la traçabilité. Écriture réservée
  à admin/directeur : c'est de la configuration, pas une opération de terrain.
- `POST /api/produits/transferts` : **le seul mouvement de l'application qui ne change pas
  `produits.quantite`**. Il ne peut donc pas passer par `mouvementStock`, qui l'ajuste
  systématiquement — d'où un chemin dédié qui n'écrit que les deux quants et le mouvement. Un
  test l'affirme explicitement, pour le jour où quelqu'un voudra « unifier » les chemins.
- `GET /api/produits/previsionnel` : disponible + entrant. Panneau dans **Stocks → Inventaire**,
  après le stock par emplacement — on constate où est la marchandise, puis on la déplace.

#### Le piège central, et la preuve qu'il est gardé

`resoudreEmplacements` faisait `parType[type] = id` : **un seul identifiant par type, la dernière
ligne l'emportant**. Dès qu'une entreprise a deux entrepôts, c'est l'ordre de la requête qui
décide où atterrit une réception d'achat — sans erreur, sans trace, la pire forme de défaut.
Nouvelle colonne `emplacements_stock.par_defaut`, un seul par entreprise garanti par un **index
unique partiel** plutôt que par du code applicatif, tri explicite, et la boucle garde désormais la
première ligne.

Prouvé en retirant le tri : le test « une réception entre dans l'emplacement PAR DÉFAUT » tombe
seul (`attendu 25, reçu undefined`), les douze autres restent verts. Vérifié aussi en conditions
réelles — Silo Nord promu par défaut alors qu'il a l'identifiant le plus grand, puis une commande
reçue : les 150 unités y sont bien allées.

#### Trois dépendances que ce changement a ouvertes

1. La sous-requête du réservé (`chargerProduitPourMouvement`) prenait le quant du **premier**
   interne : passée en `SUM`, sans quoi un comptage aurait inventé un manquant.
2. L'ajustement d'inventaire livré le matin même **pose** le quant interne : il accepte désormais
   un `emplacementId` (défaut : l'emplacement par défaut) et compte cet emplacement-là.
3. **Un test a rattrapé une règle trop fragile.** J'avais écrit « le théorique est le quant de
   l'emplacement, sauf si aucun quant n'existe ». Or un article créé avec un stock initial n'a
   jamais de quant, et une vente signée peut y poser une *réservation* sans jamais créer la
   quantité physique : le quant existe alors à `(0, 15)` et ma règle renvoyait 0 au lieu de 115.
   État parfaitement réel, pas artificiel. Départage désormais explicite par la **somme des quants
   internes** : nulle, c'est `produits.quantite` qui dit le vrai et le défaut porte tout ; non
   nulle, les quants font foi emplacement par emplacement.

#### L'entrant, et ce qu'on refuse de faire dire aux chiffres

La référence sépare `free_qty` (en main − réservé) de `virtual_available` (en main − sortant +
entrant) ; notre seule sortie planifiée étant la réservation d'un devis signé, c'est elle qui
tient lieu de sortant. Pour l'entrant, le cycle d'achat à deux axes marque « partiellement reçu »
**sans stocker les quantités reçues ligne à ligne** : compter un partiel en entier gonfle le
prévisionnel, l'exclure le sous-estime. Il est donc exclu du chiffre et **son nombre est affiché
à côté**, en clair. Un test vérifie que l'entrant reste à zéro et que le compteur passe à un.

**Vérification** — 13 tests d'intégration, **437/437** ; build, `oxlint`, 130/130 frontend.
Migration rejouée deux fois (7 entreprises marquées, puis « déjà défini partout »), et exactement
un défaut par entreprise en base. En navigateur : création de « Silo Nord », transfert de 180 kg
avec le disponible de la source affiché avant validation, répartition 320/180 pendant que la
quantité détenue reste à 500 — le point du chantier —, bascule du défaut, puis réception d'achat
arrivant au bon endroit. Écrans voisins rouverts (Articles, Transformation, Configuration, et
Poulailler, qui partage `StocksTab`). Entreprise jetable purgée, images reconstruites.

**L'audit Stocks/Comptabilité du 2026-09-10 est terminé : ses six chantiers sont livrés.**

### 2026-09-11 — Numéro de facture FAC, et WhatsApp sur une pièce facturée

Deux demandes de l'utilisateur : remplacer « INV » par « FAC » dans les numéros de facture, et
pouvoir envoyer une facture par WhatsApp.

#### INV → FAC

Le préfixe n'était écrit nulle part : c'est le **code du journal de vente** qui le devient
(`CODE/AAAA/NNNN`, `RCODE/…` pour un avoir). Un seul point à changer dans le code de production
(`comptaDefauts.js`), plus une migration pour les entreprises existantes.

**Deux règles non négociables, et la seconde est un piège.**

1. Les pièces **déjà émises gardent leur numéro `INV/…`**, jamais renommées. Une pièce émise a
   une valeur légale, et son `name` entre dans le hachage d'inaltérabilité
   (`chaineIntegriteMove`) : les réécrire romprait la chaîne de sécurisation d'un journal
   verrouillé. Vérifié après migration : la facture existante s'appelle toujours `INV/2026/0001`.
2. **Le compteur devait être reporté.** `account_journal_sequence` est indexée par préfixe : sans
   report, la première facture après migration se serait appelée `FAC/2026/0001` alors que
   `INV/2026/0001` existait déjà — deux pièces perçues comme « numéro 1 » du même exercice. La
   migration recopie le compteur sur le nouveau préfixe avant de renommer le code, `RINV/` →
   `RFAC/` compris. Vérifié en base : l'entreprise 1 avait `INV/2026/` à 1, elle a désormais
   `FAC/2026/` à 1 — sa prochaine facture sera `0002`. Un test le garde en rejouant l'opération
   sur un troisième code.

Les anciennes lignes `INV/…` de la séquence sont conservées : plus jamais consultées puisque le
préfixe dérive du code, elles gardent la trace du point d'arrêt.

#### WhatsApp sur une pièce facturée

Tout existait déjà, sauf le lien entre les deux : le PDF s'intitule « FACTURE » dès que le devis
est facturé (`devisPdf.js`), le lien public fonctionne, et la route `lien-whatsapp` n'a aucune
restriction de statut. **C'est le bouton qui s'arrêtait à « Envoyé »** — il disparaissait
exactement au moment où la facture existait. Il est désormais visible sur toute pièce non annulée,
et son libellé devient « Envoyer la facture par WhatsApp » quand un `account_move` est lié.

**Un vrai défaut trouvé en étendant.** La route refigeait le taux de change à chaque appel. Sur
une pièce facturée, c'est interdit : le taux est figé à l'émission et la facture comptable a été
postée à ce taux-là — le rouvrir aurait désaccordé le devis de son écriture. Le refigeage est
maintenant conditionné à l'absence de facture liée, et un test vérifie que le taux et le statut
d'une pièce facturée ne bougent pas après l'appel.

**Le mot compte aussi** : le message annonçait « voici votre devis » quel que soit l'état. Il dit
maintenant « votre facture » le cas échéant.

#### Ce qui n'a pas changé, et pourquoi

**WhatsApp par lien click-to-chat ne transporte aucune pièce jointe** — c'était déjà le constat du
chantier devis. On envoie un lien vers la pièce, que le client ouvre pour consulter et télécharger
le PDF ; joindre un vrai fichier exigerait la Cloud API de Meta (compte Business vérifié, numéro
dédié, modèles pré-approuvés, facturation par message).

**Le message cite `DEV-2026-0001`, pas `FAC/2026/0001`, et c'est délibéré** : le PDF imprime
`devis.numero`, donc citer le numéro comptable renverrait le client à une référence introuvable
sur son document. Cela révèle une incohérence de fond, préexistante et hors périmètre : une pièce
facturée porte un numéro commençant par « DEV- ». Signalée à l'utilisateur plutôt que corrigée en
passant — changer le numéro imprimé sur des pièces déjà envoyées relève de la même prudence que
le point 1 ci-dessus.

**Vérification** — 2 tests d'intégration ajoutés, **439/439** ; build, `oxlint`, 130/130 frontend.
Migration rejouée deux fois (7 entreprises renommées, puis « déjà FAC »). En navigateur sur une
entreprise jetable : facture comptable créée en `FAC/2026/0001`, bouton « Envoyer la facture par
WhatsApp » présent sur la pièce facturée, et lien produit capturé sans rien envoyer
(`window.open` intercepté) — message et numéro conformes. Écrans voisins rouverts (liste Ventes,
écran Factures). Entreprise jetable purgée, images Docker backend et frontend reconstruites.

### 2026-09-11 — La pièce facturée porte enfin un numéro de facture

Suite immédiate du renommage INV → FAC : le numéro comptable existait bien, mais **le client ne
le voyait jamais**. Le PDF, la page publique et le message WhatsApp citaient tous
`devis.numero` — une facture arrivait donc chez le client sous le numéro `DEV-2026-0001`.

**Principe retenu : deux pièces, deux numéros.** Le devis garde le sien, la facture affiche le
sien, et le numéro du devis reste imprimé en « Référence devis » — l'équivalent d'`invoice_origin`
dans l'ERP de référence, où un bon de commande et sa facture ne partagent jamais leur
numérotation. Renommer `devis.numero` à la facturation aurait cassé la traçabilité du devis pour
un résultat moins juste.

Un helper exporté (donc testable) porte la décision : `identiteDocument(devis)` renvoie titre,
numéro et référence. **Il se fie à la facture liée, pas au statut** — et c'est un défaut réel
corrigé au passage : l'ancien test `statut === 'Facturé'` imprimait « DEVIS » sur une facture
déjà payée, puisque « Payé » est un statut distinct. Un test le garde explicitement.

#### Le piège du nom de fichier

`FAC/2026/0001` contient des `/`, interdits dans un nom de fichier : l'en-tête
`Content-Disposition: filename="FAC/2026/0001.pdf"` aurait cassé le téléchargement. D'où
`nomFichier()`, testé, qui produit `FAC-2026-0001.pdf` sans toucher au numéro affiché. Vérifié en
conditions réelles sur les trois routes PDF.

#### Trois surfaces à aligner, pas une

La route PDF publique et la route de consultation publique construisent **leur propre SELECT**
au lieu de passer par `getDevisComplet` : sans y joindre `account_move`, le client aurait reçu
« DEVIS » par le lien qu'on venait de lui envoyer, pendant que le propriétaire voyait « FACTURE ».
Les deux jointures ont été ajoutées, et la page publique affiche désormais le numéro de facture.
Le message WhatsApp cite le même numéro que la pièce — les trois surfaces disent enfin la même
chose.

**Vérification** — 6 tests unitaires ajoutés (identité du document, nom de fichier), **439/439**
tests d'intégration, build et 130/130 frontend. En conditions réelles sur une entreprise jetable :
PDF propriétaire, PDF public et page publique d'une pièce facturée portent tous `FAC/2026/0001`
avec `filename="FAC-2026-0001.pdf"`, tandis qu'un devis non facturé de la même entreprise reste
`DEV-2026-0001`. Message WhatsApp conforme. Écran Ventes rouvert — la liste des commandes garde
les numéros de devis, ce qui est sa nature. Entreprise jetable purgée, images Docker
reconstruites.

### 2026-09-11 — Le PDF part vraiment en pièce jointe WhatsApp

L'utilisateur voulait le PDF **joint** au message, pas un lien. La limite annoncée jusqu'ici
(« WhatsApp n'accepte aucune pièce jointe ») était vraie du seul mécanisme utilisé — le lien
click-to-chat `wa.me`, qui ne transporte que du texte — mais pas de la plateforme.

**Le partage natif (Web Share API niveau 2) joint réellement le fichier.**
`navigator.share({ files: [...] })` ouvre la feuille de partage du système ; l'utilisateur touche
WhatsApp et le PDF part en pièce jointe. Aucun compte Meta, aucun numéro dédié, aucun coût — la
Cloud API restait l'autre voie, avec vérification d'entreprise et facturation par conversation,
et elle a été écartée à nouveau.

**Le compromis, énoncé à l'utilisateur avant de coder** : aucun des deux mécanismes ne fait les
deux. `wa.me` cible le numéro du client mais sans fichier ; le partage natif joint le fichier mais
laisse choisir le contact dans WhatsApp. Un geste de plus contre une vraie pièce jointe.

Le bouton tente donc le partage d'abord et retombe sur le lien quand il n'est pas disponible
(ordinateur, navigateur sans support fichiers). `partagerFichier` distingue **trois** issues et
non deux : `partage`, `annule` et `indisponible` — parce qu'un utilisateur qui ferme la feuille de
partage vient précisément de renoncer, et enchaîner sur le lien ferait exactement le contraire de
ce qu'il demande. Le cas `NotAllowedError` (activation du geste expirée pendant la génération du
PDF, Safari est strict) retombe sur le lien.

#### Le défaut CORS, trouvé en vérifiant

Premier essai en navigateur : le fichier partagé s'appelait **`document.pdf`**. Le serveur
envoyait pourtant le bon `Content-Disposition: filename="FAC-2026-0001.pdf"` — mais le JavaScript
d'une page ne peut lire que les en-têtes **simples** d'une réponse cross-origin, et
`Content-Disposition` n'en fait pas partie. `cors()` sans `exposedHeaders` le masquait donc, sans
la moindre erreur : le client aurait reçu sa facture sous le nom « document.pdf ». Corrigé à la
source (`app.use(cors({ exposedHeaders: ['Content-Disposition'] }))`) plutôt qu'en reconstruisant
le nom côté client — le serveur reste seul à savoir que `FAC/2026/0001` devient
`FAC-2026-0001.pdf`.

**Vérification** — 6 tests frontend ajoutés sur `peutPartagerFichier`/`partagerFichier` (chemin
non exerçable sur un poste de bureau : `navigator` est simulé, sinon rien ne couvrirait ce code
avant le téléphone de l'utilisateur), **136/136** frontend, **439/439** intégration, build et
`oxlint` verts. En navigateur, les deux chemins exercés sur une entreprise jetable : avec partage
simulé, un fichier `FAC-2026-0001.pdf` de 1875 octets — le vrai PDF — part avec le bon texte et
aucun lien n'est ouvert ; sans support du partage, le lien `wa.me` prend le relais vers le bon
numéro. Entreprise purgée, images Docker reconstruites.

**Ce qui reste non vérifiable ici** : l'ouverture réelle de la feuille de partage et l'arrivée du
PDF dans WhatsApp, qui demandent un vrai téléphone. Le chemin de code est exercé, le rendu final
ne l'est pas.

### 2026-09-11 — Harmonisation des listes, étape 1

Demande de l'utilisateur : « harmoniser l'appli » et viser le niveau des ERP agricoles matures,
avant l'hébergement. Le constat a été mesuré, pas supposé.

**Ce que la mesure a montré.** `App.jsx` fait 9 915 lignes et 63 composants — 55 % du frontend.
Les outils de liste construits la veille (recherche, filtres, tri, regroupement, pagination,
colonnes masquables) ne servaient que sur **2 écrans** ; treize autres fichiers gardaient des
tableaux bruts. Et sur un écran de 375 px, la liste des devis réclamait **802 px dans une fenêtre
de 329**, avec 88 px par ligne : trois devis illisibles remplissaient l'écran.

**Le rendu carte, dans le composant partagé.** Sous 700 px, chaque ligne devient une carte — la
colonne `principale` fait le titre, celle qui porte une `somme` passe à droite, le reste s'empile
en paires ; `masqueeSurCarte` écarte ce qui n'a pas de sens hors tableau. Les écrans appelants
n'ont **rien** à déclarer de plus : c'est ce qui permet d'harmoniser sans reprendre chaque liste
à la main, et c'est aussi ce qui servira à une future application mobile, qui réutilisera ce même
code. Groupes, sélection et totaux sont conservés dans les deux formes.

`matchMedia` plutôt qu'un écouteur de redimensionnement, avec un garde-fou sur son absence :
jsdom ne le fournit pas, et sans lui **toute** la suite de tests tomberait. Un test couvre
précisément ce garde-fou.

**Trois listes converties**, chacune vérifiée en largeur bureau ET téléphone :
- **Factures** — avait deux filtres serveur et rien d'autre. Les filtres Type/Statut restent côté
  serveur (ils pilotent la requête) ; le reste vient des outils partagés. Gagne un total TTC
  qui n'existait pas.
- **Équipements** — gagne un total du parc, qui n'était calculé nulle part, et qui suit le
  filtre : vérifié, 12 665 000 sur quatre équipements, 8 120 000 sur les deux indisponibles.
- **Registre des intrants** — deux filtres à conséquence réelle (délai avant récolte en cours,
  ZNT non respectée). Le style de cellule et la constante de bordure devenus morts ont été
  retirés, le lint les signalait.

**Deux corrections à mon propre plan, issues de la mesure :**
1. J'avais annoncé que les écrans avaient « des tableaux bruts ». Faux pour les **Contacts**, déjà
   en cartes avec panneau de détail : leur défaut est ailleurs — une grille figée à deux colonnes,
   soit **deux colonnes de 160 px sur un téléphone**.
2. La liste des **Articles/Stocks** n'a pas été convertie : elle porte des **lignes dépliables**
   (les lots), que `TableauListe` ne sait pas rendre. La convertir demande d'abord d'ajouter ce
   mécanisme au composant partagé — un vrai ajout, pas une conversion mécanique. Laissé de côté
   sciemment plutôt que bâclé en fin de chantier.

**Vérification** — 142/142 tests frontend (6 nouveaux sur la bascule et le garde-fou), build et
`oxlint` verts. Entreprise jetable purgée, image frontend reconstruite. Poussé en quatre commits
séparés (`b9a0d0e`, `49755f6`, `a7dd06a`, `3541a75`) pour que chaque écran soit testable seul.

**Reste à faire sur cette étape** : lignes dépliables dans le composant puis Articles/Stocks, la
grille responsive des Contacts et du RH, les référentiels comptables, et le manifeste PWA qui
porte encore l'ancienne palette (`#38A169` alors que le thème est à `#3F6B3B`).

### 2026-09-11 — Lignes dépliables, et les articles rejoignent les outils

Suite directe de l'étape 1, qui s'était arrêtée devant la liste des articles : elle porte des
**lignes dépliables** (les lots), que `TableauListe` ne savait pas rendre. Le mécanisme manquait
au composant, ce n'était pas une conversion mécanique — d'où l'arrêt plutôt que l'improvisation.

**Le dépli dans le composant partagé.** Une prop `rendreDepli(ligne)` : l'écran garde la main sur
qui est déplié et sur ce que le dépli contient, le composant ne fait que lui ménager la place —
une ligne de tableau en pleine largeur sur écran large, un bloc sous la carte sur téléphone, où
il n'y a aucune colonne à étendre. Renvoyer une valeur fausse ne change rien au rendu existant.

**Les articles.** La rangée de pastilles maison qui filtrait par type d'intrant est remplacée par
les filtres de la barre d'outils : deux mécanismes de filtrage côte à côte sur le même écran,
c'était exactement le genre de disparate que cette harmonisation vise. S'y ajoute un filtre qui
déclenche une action — les articles sous leur seuil d'alerte — plus la recherche (nom, variété,
matière active, numéro AMM), le tri, le regroupement et la pagination.

`filtreType`, devenu sans lecteur, a été retiré plutôt que laissé en état mort.

**Le piège des ancres, une fois de plus.** Le premier remplacement a été refusé par ma propre
garde d'unicité : le motif de fermeture `</tbody></DataTable></Card>` existe **ailleurs** dans un
fichier de 9 900 lignes. C'est précisément ce qui avait cassé l'onglet Ventes la veille. L'ancre
longue, incluant les fermetures de fragment, était unique — vérifiée avant d'écrire.

**Vérification** — 142/142 frontend, build et `oxlint` verts. En navigateur : filtres et alertes
de stock bas conservés, dépliage des lots exercé (lot proche péremption surligné, quantité
restante éditable), et le même dépli rendu sous la carte en 375 px sans faire déborder la page.
Entreprise jetable purgée, image frontend reconstruite.

**Limite connue et signalée** : le tableau des lots *à l'intérieur* du dépli reste dense sur
téléphone (six colonnes dans 329 px). Il possède son propre défilement et ne casse pas la mise en
page, mais il n'a pas été converti — il n'utilise pas `TableauListe` et porte un champ éditable.

### 2026-09-11 — Contacts et RH : les écrans liste-détail

Troisième volet de l'harmonisation. Ces deux écrans ne sont pas des tableaux, et c'est ce qui
les distingue des précédents : il ne fallait pas leur imposer `TableauListe`, mais leur donner ce
qui manquait.

**Contacts — deux défauts distincts.** Le premier : aucun outil au-delà d'un champ de recherche
maison. Le hook partagé apporte filtres, tri, regroupement et pagination, et la barre d'outils
remplace le champ ; **le rendu en cartes avec panneau de détail est conservé**, c'est la bonne
forme pour un écran liste-détail.

Le second n'avait rien à voir avec les listes : **trois grilles figées à deux colonnes**. En
375 px, cela donnait deux colonnes de 160 px où ni la liste, ni le détail, ni le formulaire
n'étaient lisibles — et l'avatar de 130 px écrasait les champs voisins. Toutes s'empilent
désormais sous le seuil. Mesuré après correction : **zéro champ hors écran, zéro débordement**.

**Un import manquant, attrapé de justesse.** `useAffichageEtroit` n'était pas importé dans
`App.jsx`. Le build ne dit rien d'un identifiant non déclaré — l'erreur n'arrive qu'à
l'exécution, et fait tomber tout l'arbre React. C'est **exactement** le défaut qui avait donné un
écran blanc sur l'onglet Ventes avant-hier. Vu en relisant les imports après coup, puis confirmé
en ouvrant réellement l'écran.

**RH — une hypothèse fausse, corrigée par la mesure.** J'avais annoncé qu'il souffrait du même
défaut de grille que les Contacts. Faux : ses grilles utilisent déjà `repeat(auto-fit, minmax(…))`
et sont responsives par construction. Ce qui lui manquait, c'était la recherche, le tri et la
pagination. Le filtre par département reste **côté serveur** (il pilote `getSalaries`), et les
deux modes d'affichage — liste et trombinoscope — sont conservés, tous deux branchés sur les
lignes filtrées. Les libellés de regroupement pointaient vers `rh.departement` et `rh.poste`, deux
clés **inexistantes** : corrigées en `rh.fieldDepartement` / `rh.fieldPoste` avant vérification.

**Vérification** — 142/142 frontend, build et `oxlint` verts. En navigateur : filtre « sans
téléphone » exercé sur les contacts (isole le seul contact concerné), tri alphabétique des
salariés vérifié, les deux modes d'affichage RH exercés, et les deux écrans contrôlés en 375 px
comme en largeur bureau. Entreprise jetable purgée, image frontend reconstruite.

### 2026-09-11 — Référentiels comptables et manifeste PWA : fin de l'étape 1

#### Le manifeste portait encore l'ancienne palette

`theme_color: '#38A169'` sur `background_color: '#F7FAFC'` — l'émeraude et le gris-bleu abandonnés
le 2026-09-09. L'écran de démarrage et la barre système d'une application installée ne
ressemblaient donc plus à l'application. Les **icônes**, elles, étaient déjà terreuses : seules
les couleurs déclarées étaient périmées.

Plutôt que de recopier les bonnes valeurs — ce qui divergerait à nouveau — `vite.config.js`
**importe `theme.js`**. Le fichier n'a aucune dépendance, la config de build peut donc le lire, et
la divergence ne peut plus se reproduire en silence.

**Deux défauts de langue trouvés en passant.** Le manifeste déclarait `lang: "en"` sous une
description française, et `index.html` portait `<html lang="en">` : un lecteur d'écran lisait le
français avec une phonétique anglaise. Corrigé à la source plutôt qu'en figeant `fr` —
`i18n` pose désormais `document.documentElement.lang` au démarrage et à chaque changement de
langue, donc l'attribut suit réellement l'interface.

#### Les référentiels : un arbitrage, pas une recette

Taxes, conditions de paiement et journaux comptent quelques lignes. Leur imposer recherche,
filtres et pagination aurait été disproportionné : le pied de liste afficherait « 1-3 sur 3 », du
bruit pur. Ce qui leur manquait vraiment, c'est le **rendu en cartes** — cinq colonnes ne tiennent
pas dans 329 px. Ils reçoivent donc `TableauListe` seul, sans barre d'outils ni pied.

Le **plan de comptes** est le seul à mériter le traitement complet : un vrai plan comptable
grossit, celui-ci peut dépasser la page. Recherche, filtre « lettrable », regroupement par type et
pied de liste.

**Vérification** — 142/142 frontend, build et `oxlint` verts (zéro avertissement sur les trois
fichiers). En navigateur : les quatre référentiels rendus correctement en largeur bureau, et en
375 px **plus aucun tableau sur l'écran** — tout est en cartes, sans débordement. Le manifeste
généré porte bien `#3F6B3B` / `#FBFAF4` et `lang: fr`, `dist/index.html` aussi. Entreprise jetable
purgée, image frontend reconstruite.

**Fausse alerte notée pour mémoire** : j'ai cru le plan de comptes disparu parce qu'une capture
s'arrêtait avant lui. Le DOM disait le contraire — mesurer avant de conclure vaut aussi pour les
captures d'écran.

**Étape 1 terminée.** Onze écrans harmonisés : Devis, Achats, Stock par emplacement, Factures,
Équipements, Registre des intrants, Articles, Contacts, RH, plus les quatre référentiels
comptables. Reste, pour aller vers l'application mobile : le tableau des lots imbriqué dans un
dépli (dense sur téléphone), et le choix d'une technologie d'empaquetage.

### 2026-09-11 — Étape 2 : les mises en page, et un défaut qui traînait sur tous les écrans

Les listes réglées, l'inventaire des **grilles figées** a donné onze emplacements, tous dans
`App.jsx`. La carte a changé l'ordre des priorités — toutes ne devaient pas être traitées pareil :

- **Devis et Achats** (fiches et formulaires de lignes) : empilés sous le seuil. Ce sont les
  écrans les plus utilisés, et `2fr 1fr 1fr auto` dans 375 px ne laisse pas la place à un montant.
- **Carte des parcelles** : le panneau passe sous la carte.
- **Sous-contacts** : empilés.
- **Calendrier (`repeat(7, 1fr)`) : laissé tel quel.** C'est la semaine — tout calendrier mobile
  garde ses sept colonnes, les empiler détruirait l'objet même de l'écran.
- **Kanban (`repeat(4, 1fr)`) : mis à défiler, pas empilé.** Empiler ferait perdre la lecture en
  colonnes qui EST l'intérêt d'un kanban ; quatre colonnes de 78 vw défilent latéralement, comme
  le fait n'importe quel kanban sur téléphone.

#### Le défaut trouvé en vérifiant le kanban n'était pas le kanban

Première tentative : le kanban défilait bien, mais **toute la page glissait vers la droite**,
onglets et boutons coupés à gauche. Les mesures disaient pourtant « aucun débordement » sur
`document.documentElement` — parce que le coupable était ailleurs : `.dashboard-shell`, qui porte
`overflow-x: auto`, avait défilé de 117 px.

En cherchant l'élément fautif, ce n'était **ni le kanban ni ma modification** : c'était le bouton
« Configuration » de `SousNavOnglets`. Cinq onglets ne tiennent pas dans 375 px, la barre poussait
le conteneur, et la page entière glissait — **sur tous les écrans à sous-onglets**, Ventes,
Stocks, Factures compris. Un défaut préexistant que seule cette vérification a mis au jour.

Corrigé dans le composant partagé : la barre défile sur elle-même (`overflowX`, `maxWidth: 100%`)
et `flexShrink: 0` empêche les libellés d'être écrasés. Mesure après correction : le conteneur
fait exactement 375 px pour 375 px de viewport, plus aucun décalage.

Le kanban avait besoin du même `maxWidth: '100%'` : sans contrainte de largeur, `overflow-x` sur
une grille ne l'empêche pas de pousser son parent.

**Deux erreurs de ma part, rattrapées par les outils.** Un commentaire JSX inséré dans une
fonction fléchée à retour implicite — deux expressions là où une seule est permise, le build l'a
refusé. Et un ternaire dont les deux branches étaient identiques, écrit puis retiré : un code qui
prétend décider quelque chose sans rien décider est pire que pas de code.

**Vérification** — 142/142 frontend, build et `oxlint` verts. En navigateur, en 375 px : carte
empilée, kanban défilant sur lui-même avec la page en place, sous-onglets défilants. En largeur
bureau, kanban à quatre colonnes et onglets alignés, aucune régression. Entreprise jetable purgée,
image frontend reconstruite.
