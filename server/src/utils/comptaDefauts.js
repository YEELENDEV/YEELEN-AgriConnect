// Référentiels comptables par défaut créés pour chaque entreprise (à l'inscription via
// routes/auth.js, et rétroactivement par db/socle.js). Étape 2 de l'alignement Comptabilité.
//
// Le plan de comptes suit le chart générique d'un ERP de référence (codes 1xxxxx/2xxxxx/
// 4xxxxx/5xxxxx, pas un PCG national) — l'appli vise toutes zones, on ne code pas un plan
// pays en dur. Une entreprise peut ensuite l'adapter via /api/accounts.

export const COMPTES_DEFAUT = [
  { code: '121000', name: 'Clients',              account_type: 'asset_receivable',  reconcile: true },
  { code: '211000', name: 'Fournisseurs',         account_type: 'liability_payable',  reconcile: true },
  { code: '101401', name: 'Banque',               account_type: 'asset_cash',         reconcile: false },
  { code: '101402', name: 'Caisse',               account_type: 'asset_cash',         reconcile: false },
  { code: '400000', name: 'Ventes de produits',   account_type: 'income',             reconcile: false },
  { code: '500000', name: 'Coût des ventes',      account_type: 'expense',            reconcile: false },
  { code: '251000', name: 'TVA collectée',        account_type: 'liability_current',  reconcile: false },
  { code: '131000', name: 'TVA déductible',       account_type: 'asset_current',      reconcile: false },
  // Multi-devise réel, étape 4 : écart de change au paiement (voir utils/accountMove.js:
  // enregistrerEcartChange). Codes 6xx/7xx pour rester distincts du bloc 4xx/5xx existant.
  { code: '768000', name: 'Gains de change',      account_type: 'income_other',       reconcile: false },
  { code: '668000', name: 'Pertes de change',     account_type: 'expense_other',       reconcile: false },
];

// Journaux par défaut (account.journal-like). `defaultAccountCode` référence un COMPTES_DEFAUT
// ci-dessus, résolu en default_account_id au moment du seed.
export const JOURNAUX_DEFAUT = [
  // FAC et non INV depuis le 2026-09-11 : le code du journal devient le préfixe du numéro de
  // pièce (FAC/2026/0001, RFAC/2026/0001 pour un avoir), et l'application est francophone.
  // Les entreprises déjà créées sont renommées par socle.js, compteur reporté — voir
  // renommerJournalVenteVersFac.
  { name: 'Factures clients',    code: 'FAC',  type: 'sale',     sequence: 5,  refund_sequence: true,  defaultAccountCode: '400000' },
  { name: 'Factures fournisseurs', code: 'BILL', type: 'purchase', sequence: 6, refund_sequence: true, defaultAccountCode: '500000' },
  { name: 'Banque',              code: 'BNK',  type: 'bank',     sequence: 10, refund_sequence: false, defaultAccountCode: '101401' },
  { name: 'Caisse',              code: 'CSH',  type: 'cash',     sequence: 11, refund_sequence: false, defaultAccountCode: '101402' },
  { name: 'Opérations diverses', code: 'MISC', type: 'general',  sequence: 20, refund_sequence: false, defaultAccountCode: null },
];
