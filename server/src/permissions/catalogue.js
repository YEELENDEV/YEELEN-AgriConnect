// Le vocabulaire des permissions, et la carte qui relie chaque route montée à un couple
// (ressource, action).
//
// C'est ici — et nulle part ailleurs — que l'application décide de ce qui EXISTE comme
// permission. Ce que chaque entreprise en fait, c'est-à-dire quels rôles elle crée et ce qu'elle
// y met, est une donnée et vivra en base (étape 3).
//
// Étape 1 du chantier « rôles définis par l'entreprise » : cette carte ne bloque encore rien.
// Elle est seulement vérifiée par `catalogue.test.js`, qui échoue si une route montée n'est
// couverte ni par la carte ni par la liste hors périmètre. C'est ce test qui rend l'oubli
// impossible : une route ajoutée sans permission fait échouer la suite.

export const ACTIONS = ['lire', 'creer', 'modifier', 'supprimer'];

// Actions métier exposées à part parce qu'elles déplacent de l'argent ou du stock : une
// entreprise doit pouvoir dire « il modifie un devis mais ne le facture pas ». Les 30 autres
// routes d'action (envoyer, annuler, remettre en brouillon…) sont repliées sur « modifier »,
// sinon la matrice devient illisible.
export const ACTIONS_SENSIBLES = ['valider', 'facturer', 'receptionner', 'encaisser'];

export const TOUTES_ACTIONS = [...ACTIONS, ...ACTIONS_SENSIBLES];

// Les ressources, groupées en sections pour l'écran d'administration (étape 4). Le découpage ne
// suit pas mécaniquement les fichiers de routes : `salaries.js` porte six sujets qu'une
// entreprise voudra distinguer (on confie les congés sans ouvrir les salaires), et `factures.js`
// mêle les pièces et les états comptables.
export const RESSOURCES = {
  // ── Opérations ──
  parcelles: { section: 'operations', libelle: 'Parcelles' },
  cultures_mouvements: { section: 'operations', libelle: 'Mouvements Cultures' },
  poulailler: { section: 'operations', libelle: 'Poulailler' },
  pisciculture: { section: 'operations', libelle: 'Pisciculture' },
  recoltes: { section: 'operations', libelle: 'Récoltes' },
  observations: { section: 'operations', libelle: 'Observations' },
  calendrier: { section: 'operations', libelle: 'Calendrier' },
  activites: { section: 'operations', libelle: 'Activités planifiées' },
  planning: { section: 'operations', libelle: "Plans d'intervention" },
  equipements: { section: 'operations', libelle: 'Équipements' },
  cameras: { section: 'operations', libelle: 'Surveillance' },
  meteo: { section: 'operations', libelle: 'Météo' },
  precision: { section: 'operations', libelle: 'Agriculture de précision' },

  // ── Stocks ──
  produits: { section: 'stocks', libelle: 'Articles' },
  lots: { section: 'stocks', libelle: 'Lots et péremption' },
  inventaire: { section: 'stocks', libelle: 'Inventaire, rebut et transferts' },
  emplacements_stock: { section: 'stocks', libelle: 'Emplacements de stock' },
  applications_intrants: { section: 'stocks', libelle: 'Registre phytosanitaire' },
  recettes: { section: 'stocks', libelle: 'Recettes de transformation' },
  ordres_transformation: { section: 'stocks', libelle: 'Ordres de transformation' },
  haccp: { section: 'stocks', libelle: 'Contrôles HACCP' },

  // ── Commercial ──
  contacts: { section: 'commercial', libelle: 'Clients et fournisseurs' },
  listes_prix: { section: 'commercial', libelle: 'Listes de prix' },
  devis: { section: 'commercial', libelle: 'Devis' },
  achats: { section: 'commercial', libelle: 'Achats' },
  messages: { section: 'commercial', libelle: 'Fils de discussion' },

  // ── Finance ──
  finances: { section: 'finance', libelle: 'Écritures de trésorerie' },
  banques: { section: 'finance', libelle: 'Comptes bancaires' },
  factures: { section: 'finance', libelle: 'Factures et avoirs' },
  paiements: { section: 'finance', libelle: 'Paiements' },
  etats_comptables: { section: 'finance', libelle: 'États comptables' },

  // ── Ressources humaines ──
  salaries: { section: 'rh', libelle: 'Salariés' },
  contrats: { section: 'rh', libelle: 'Contrats' },
  conges: { section: 'rh', libelle: 'Congés' },
  presences: { section: 'rh', libelle: 'Présences et temps' },
  avances: { section: 'rh', libelle: 'Avances sur salaire' },
  bulletins: { section: 'rh', libelle: 'Bulletins de paie' },
  referentiels_rh: { section: 'rh', libelle: 'Référentiels RH' },

  // ── Configuration ──
  entreprise: { section: 'configuration', libelle: "Fiche de l'entreprise" },
  modules_actifs: { section: 'configuration', libelle: 'Modules activés' },
  referentiels_produits: { section: 'configuration', libelle: 'Catégories, unités, attributs' },
  referentiels_comptables: { section: 'configuration', libelle: 'Journaux, comptes, taxes, conditions' },
  journal_audit: { section: 'configuration', libelle: "Journal d'audit" },
  // La gestion des rôles n'est pas soumise aux rôles : elle appartient au propriétaire du compte
  // (routes/roles.js). Elle figure au catalogue pour que la carte reste complète, et se retrouve
  // donc en lecture seule côté restrictions — retirer « lire » à un rôle masque l'écran.
  roles: { section: 'configuration', libelle: 'Rôles et restrictions' },
};

// Préfixe de montage → ressource par défaut. L'action se déduit alors de la méthode HTTP.
const MONTAGES = {
  '/api/activites': 'activites',
  '/api/applications-intrants': 'applications_intrants',
  '/api/banques': 'banques',
  '/api/calendar': 'calendrier',
  '/api/cameras': 'cameras',
  '/api/contacts': 'contacts',
  '/api/contact-tags': 'contacts',
  '/api/devis': 'devis',
  '/api/achats': 'achats',
  '/api/emplacements-stock': 'emplacements_stock',
  '/api/equipements': 'equipements',
  '/api/haccp': 'haccp',
  '/api/listes-prix': 'listes_prix',
  '/api/messages': 'messages',
  '/api/meteo': 'meteo',
  '/api/observations': 'observations',
  '/api/ordres-transformation': 'ordres_transformation',
  '/api/paiements': 'paiements',
  '/api/pisciculture': 'pisciculture',
  '/api/planning': 'planning',
  '/api/poulailler': 'poulailler',
  '/api/precision': 'precision',
  '/api/produits': 'produits',
  '/api/produit-recettes': 'recettes',
  '/api/recoltes': 'recoltes',
  '/api/rh': 'referentiels_rh',
  '/api/salaries': 'salaries',
  // Référentiels de configuration, regroupés : personne ne veut cocher huit lignes pour dire
  // « il peut gérer les référentiels ».
  '/api/produit-categories': 'referentiels_produits',
  '/api/produit-templates': 'referentiels_produits',
  '/api/attributs-produit': 'referentiels_produits',
  '/api/unites-mesure': 'referentiels_produits',
  '/api/unites-mesure-categories': 'referentiels_produits',
  '/api/taxes': 'referentiels_comptables',
  '/api/journals': 'referentiels_comptables',
  '/api/accounts': 'referentiels_comptables',
  '/api/payment-terms': 'referentiels_comptables',
  '/api/factures': 'factures',
  '/api/roles': 'roles',
};

const PAR_METHODE = { GET: 'lire', POST: 'creer', PUT: 'modifier', PATCH: 'modifier', DELETE: 'supprimer' };

// Les routes qui ne suivent pas la règle « méthode → action », soit parce qu'elles agissent au
// lieu de créer (42 POST sont dans ce cas), soit parce qu'elles relèvent d'une autre ressource
// que celle de leur préfixe de montage.
const EXCEPTIONS = {
  // ── Devis : le cycle de vie ──
  'POST /api/devis/:id/valider-manuel': ['devis', 'valider'],
  'POST /api/devis/:id/facturer': ['devis', 'facturer'],
  'POST /api/devis/:id/echeances/:echeanceId/payer': ['devis', 'encaisser'],
  'POST /api/devis/:id/envoyer': ['devis', 'modifier'],
  'POST /api/devis/:id/annuler': ['devis', 'modifier'],
  'POST /api/devis/:id/remettre-brouillon': ['devis', 'modifier'],
  'POST /api/devis/:id/lien-whatsapp': ['devis', 'lire'],
  'PATCH /api/devis/:id/lignes-quantites': ['devis', 'modifier'],
  'GET /api/devis/:id/pdf': ['devis', 'lire'],
  'GET /api/devis/:id/journal': ['devis', 'lire'],
  'GET /api/devis/ledger': ['devis', 'lire'],

  // ── Achats : l'axe réception est distinct de l'axe commercial ──
  'POST /api/achats/:id/recevoir': ['achats', 'receptionner'],
  'POST /api/achats/:id/reception-partielle': ['achats', 'receptionner'],
  'POST /api/achats/:id/annuler-reception': ['achats', 'receptionner'],
  'POST /api/achats/:id/commander': ['achats', 'modifier'],
  'POST /api/achats/:id/envoyer': ['achats', 'modifier'],
  'POST /api/achats/:id/annuler': ['achats', 'modifier'],
  'POST /api/achats/:id/remettre-brouillon': ['achats', 'modifier'],
  'GET /api/achats/ledger': ['achats', 'lire'],

  // ── Factures : les pièces, puis les états comptables, qui sont une autre ressource ──
  'POST /api/factures/:id/post': ['factures', 'valider'],
  'POST /api/factures/:id/register-payment': ['factures', 'encaisser'],
  'POST /api/factures/:id/allocate-credit': ['factures', 'encaisser'],
  'POST /api/factures/:id/button-draft': ['factures', 'modifier'],
  'POST /api/factures/:id/cancel': ['factures', 'modifier'],
  'POST /api/factures/:id/reverse': ['factures', 'modifier'],
  'POST /api/factures/:id/mark-reminded': ['factures', 'modifier'],
  'GET /api/factures/grand-livre': ['etats_comptables', 'lire'],
  'GET /api/factures/balance': ['etats_comptables', 'lire'],
  'GET /api/factures/bilan': ['etats_comptables', 'lire'],
  'GET /api/factures/compte-resultat': ['etats_comptables', 'lire'],
  'GET /api/factures/declaration-tva': ['etats_comptables', 'lire'],
  'GET /api/factures/aged-receivable': ['etats_comptables', 'lire'],
  'GET /api/factures/overdue': ['etats_comptables', 'lire'],
  'GET /api/factures/credit-notes-unallocated': ['etats_comptables', 'lire'],
  'GET /api/factures/verify-hash': ['etats_comptables', 'lire'],
  'POST /api/paiements/:id/allocate': ['paiements', 'encaisser'],

  // ── Cultures : parcelles et mouvements sont deux sujets ──
  'GET /api/cultures/parcelles': ['parcelles', 'lire'],
  'POST /api/cultures/parcelles': ['parcelles', 'creer'],
  'PUT /api/cultures/parcelles/:id': ['parcelles', 'modifier'],
  'DELETE /api/cultures/parcelles/:id': ['parcelles', 'supprimer'],
  'GET /api/cultures/historique': ['parcelles', 'lire'],
  'POST /api/cultures/historique': ['parcelles', 'modifier'],
  'GET /api/cultures/mouvements': ['cultures_mouvements', 'lire'],
  'POST /api/cultures/mouvements': ['cultures_mouvements', 'creer'],
  'PUT /api/cultures/mouvements/:id': ['cultures_mouvements', 'modifier'],
  'DELETE /api/cultures/mouvements/:id': ['cultures_mouvements', 'supprimer'],
  'GET /api/cultures/mouvements/:id/historique': ['cultures_mouvements', 'lire'],
  'GET /api/cultures/historique-mouvements': ['cultures_mouvements', 'lire'],

  // ── Produits : le catalogue, les lots, et les opérations d'inventaire ──
  'GET /api/produits/:id/lots': ['lots', 'lire'],
  'POST /api/produits/:id/lots': ['lots', 'creer'],
  'PUT /api/produits/lots/:lotId': ['lots', 'modifier'],
  'DELETE /api/produits/lots/:lotId': ['lots', 'supprimer'],
  'GET /api/produits/lots-perimes': ['lots', 'lire'],
  'POST /api/produits/inventaire': ['inventaire', 'creer'],
  'POST /api/produits/rebuts': ['inventaire', 'creer'],
  'POST /api/produits/transferts': ['inventaire', 'creer'],
  'GET /api/produits/stock-emplacements': ['inventaire', 'lire'],
  'GET /api/produits/mouvements': ['inventaire', 'lire'],
  'GET /api/produits/:id/mouvements': ['inventaire', 'lire'],
  'GET /api/produits/evolution-stock': ['produits', 'lire'],
  'GET /api/produits/previsionnel': ['produits', 'lire'],

  // ── Salariés : six sujets sous un même préfixe ──
  'GET /api/salaries/:id/contrats': ['contrats', 'lire'],
  'POST /api/salaries/:id/contrats': ['contrats', 'creer'],
  'PUT /api/salaries/contrats/:contratId': ['contrats', 'modifier'],
  'DELETE /api/salaries/contrats/:contratId': ['contrats', 'supprimer'],
  'GET /api/salaries/:id/conges': ['conges', 'lire'],
  'POST /api/salaries/:id/conges': ['conges', 'creer'],
  'PUT /api/salaries/conges/:congeId': ['conges', 'valider'],
  'DELETE /api/salaries/conges/:congeId': ['conges', 'supprimer'],
  'GET /api/salaries/:id/conges-solde': ['conges', 'lire'],
  'GET /api/salaries/:id/conges-droits': ['conges', 'lire'],
  'POST /api/salaries/:id/conges-droits': ['conges', 'modifier'],
  'DELETE /api/salaries/conges-droits/:droitId': ['conges', 'modifier'],
  'GET /api/salaries/:id/presences': ['presences', 'lire'],
  'POST /api/salaries/:id/presences': ['presences', 'creer'],
  'GET /api/salaries/:id/temps': ['presences', 'lire'],
  'POST /api/salaries/:id/temps': ['presences', 'creer'],
  'DELETE /api/salaries/temps/:tempsId': ['presences', 'supprimer'],
  'GET /api/salaries/:id/avances': ['avances', 'lire'],
  'POST /api/salaries/:id/avances': ['avances', 'creer'],
  'DELETE /api/salaries/avances/:avanceId': ['avances', 'supprimer'],
  'GET /api/salaries/:id/bulletin': ['bulletins', 'lire'],
  'GET /api/salaries/:id/journal': ['salaries', 'lire'],

  // ── Entreprise et configuration ──
  'GET /api/entreprise': ['entreprise', 'lire'],
  'PUT /api/entreprise': ['entreprise', 'modifier'],
  'GET /api/entreprise/banque-principale': ['banques', 'lire'],
  'PUT /api/entreprise/banque-principale': ['banques', 'modifier'],
  'GET /api/entreprise/modules': ['modules_actifs', 'lire'],
  'PUT /api/entreprise/modules': ['modules_actifs', 'modifier'],
  'GET /api/auth/audit-log': ['journal_audit', 'lire'],
  'GET /api/roles/catalogue': ['roles', 'lire'],
  'GET /api/roles/utilisateurs': ['roles', 'lire'],
  'PUT /api/roles/:id/restrictions': ['roles', 'modifier'],
  'PUT /api/roles/utilisateurs/:userId': ['roles', 'modifier'],

  // ── Trésorerie ──
  'GET /api/business/finances': ['finances', 'lire'],
  'POST /api/business/finances': ['finances', 'creer'],
  'DELETE /api/business/finances/:id': ['finances', 'supprimer'],

  // ── Divers ──
  'POST /api/produit-templates/:id/regenerer-variantes': ['referentiels_produits', 'modifier'],
  'POST /api/attributs-produit/:id/valeurs': ['referentiels_produits', 'modifier'],
  'DELETE /api/attributs-produit/valeurs/:valeurId': ['referentiels_produits', 'modifier'],
  'POST /api/listes-prix/:id/lignes': ['listes_prix', 'modifier'],
  'DELETE /api/listes-prix/lignes/:ligneId': ['listes_prix', 'modifier'],
  'GET /api/listes-prix/:id/lignes': ['listes_prix', 'lire'],
  'GET /api/listes-prix/prix-effectif': ['listes_prix', 'lire'],
  'GET /api/contacts/:id/prix-effectifs': ['listes_prix', 'lire'],
  'POST /api/produit-recettes/:id/lignes': ['recettes', 'modifier'],
  'DELETE /api/produit-recettes/lignes/:ligneId': ['recettes', 'modifier'],
  'GET /api/produit-recettes/:id/lignes': ['recettes', 'lire'],
  'POST /api/equipements/:id/maintenance': ['equipements', 'modifier'],
  'DELETE /api/equipements/maintenance/:maintenanceId': ['equipements', 'modifier'],
  'GET /api/equipements/:id/maintenance': ['equipements', 'lire'],
  'POST /api/cameras/:id/regenerer-token': ['cameras', 'modifier'],
  'GET /api/cameras/alertes': ['cameras', 'lire'],
  'POST /api/cameras/alertes/:id/vue': ['cameras', 'modifier'],
  'GET /api/meteo/villes': ['meteo', 'lire'],
  'GET /api/meteo/parcelles-localisees': ['meteo', 'lire'],
};

// Routes délibérément hors du système de permissions d'entreprise, avec la raison — sans elle,
// cette liste deviendrait le tapis sous lequel on glisse ce qu'on n'a pas su classer.
const HORS_PERIMETRE = {
  'GET /': 'sonde de santé, aucune donnée',

  'POST /api/auth/login': 'authentification, antérieure à tout rôle',
  'POST /api/auth/register': 'création de compte, antérieure à tout rôle',
  'POST /api/auth/confirmer-inscription': 'confirmation par code, antérieure à tout rôle',
  'POST /api/auth/renvoyer-code-inscription': 'confirmation par code, antérieure à tout rôle',
  'GET /api/auth/me': 'lecture de son propre compte',

  'POST /api/mfa/setup': 'sécurité de son propre compte',
  'POST /api/mfa/verify': 'sécurité de son propre compte',
  'POST /api/mfa/resend': 'sécurité de son propre compte',
  'POST /api/mfa/disable': 'sécurité de son propre compte',

  'GET /api/salaries/moi': 'son propre dossier RH (self-service)',
  'GET /api/roles/mes-restrictions': 'lecture de ses propres restrictions (affichage)',
  'GET /api/entreprise/onboarding-status': "état d'accueil, propre à l'utilisateur",
  'PUT /api/entreprise/onboarding-status': "état d'accueil, propre à l'utilisateur",

  'GET /api/devis/public/:token': 'accès client par jeton, sans compte',
  'GET /api/devis/public/:token/pdf': 'accès client par jeton, sans compte',
  'POST /api/devis/public/:token/signer': 'accès client par jeton, sans compte',
  'GET /api/cameras/alertes/:token': 'accès par jeton, sans compte',
  'POST /api/cameras/alertes/:token': 'accès par jeton, sans compte',

  'GET /api/feedback': 'administration de la plateforme, hors rôles d\'entreprise',
  'POST /api/feedback': 'ouvert à tous délibérément, y compris compte bloqué',
  'PATCH /api/feedback/:id': 'administration de la plateforme, hors rôles d\'entreprise',
  'GET /api/billing/entreprises': 'administration de la plateforme',
  'GET /api/billing/entreprises/:id': 'administration de la plateforme',
  'POST /api/billing/entreprises/:id/activer': 'administration de la plateforme',
  'POST /api/billing/entreprises/:id/exempter': 'administration de la plateforme',
  'POST /api/billing/entreprises/:id/prolonger': 'administration de la plateforme',
  'POST /api/billing/entreprises/:id/reactiver': 'administration de la plateforme',
  'POST /api/billing/entreprises/:id/suspendre': 'administration de la plateforme',
  'GET /api/billing/status': 'état de son propre abonnement',
  'GET /api/billing/tarifs': 'grille tarifaire publique',

  'GET /api/devises/taux': 'taux de change, donnée de référence sans contenu client',

  // La recherche globale interroge plusieurs ressources d'un coup : pas de ressource unique à
  // lui attribuer. Ses résultats sont filtrés groupe par groupe selon le droit « lire » de
  // chaque ressource, dans routes/recherche.js (fait à la bascule en refus, 2026-11-11).
  'GET /api/recherche': 'multi-ressources, résultats filtrés par « lire » dans routes/recherche.js',
};

// Résout la permission exigée par une route. `null` = hors périmètre (jamais soumise aux rôles).
// Lève si la route n'est couverte par rien : c'est ce qui fait échouer le test.
export function resoudrePermission(methode, chemin) {
  const cle = `${methode} ${chemin}`;
  if (cle in HORS_PERIMETRE) return null;
  if (cle in EXCEPTIONS) {
    const [ressource, action] = EXCEPTIONS[cle];
    return { ressource, action };
  }
  const montage = Object.keys(MONTAGES)
    .filter((p) => chemin === p || chemin.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (!montage) throw new Error(`route non couverte : ${cle}`);
  const action = PAR_METHODE[methode];
  if (!action) throw new Error(`méthode non gérée : ${cle}`);
  return { ressource: MONTAGES[montage], action };
}

export const _interne = { MONTAGES, EXCEPTIONS, HORS_PERIMETRE, PAR_METHODE };
