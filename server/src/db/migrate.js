/**
 * Migration — YEELEN AgriConnect
 * Étend la table `parcelles` existante avec les données de capteurs
 * (humidité, température, vanne...) et ajoute l'historique des vannes
 * ainsi que les ventes/achats du module Cultures.
 *
 * Le tout premier bloc (entreprises/users/entreprise_utilisateurs/banques/clients/
 * fournisseurs/parcelles/cultures/recoltes/poulaillers/lots_volailles/production_oeufs/
 * devis/devis_lignes/echeances_paiement/finances/mouvements_historique) recrée le socle
 * qui n'avait jamais été capturé nulle part (amorcé à la main tout au début du projet) —
 * corrigé 2026-08-17 après avoir constaté qu'une base neuve n'aurait jamais pu démarrer.
 * `recoltes` était en plus une table orpheline (jamais requêtée avant le module Récoltes) ;
 * elle porte maintenant aussi ce module, avec calendar_events (nouvelle) pour le Calendrier.
 *
 * Lancer avec : node src/db/migrate.js (depuis le dossier server/)
 */

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { COMPTES_DEFAUT, JOURNAUX_DEFAUT } from '../utils/comptaDefauts.js';
import { UNITES_MESURE_DEFAUT } from '../utils/unitesMesureDefaut.js';
import { EMPLACEMENTS_STOCK_DEFAUT } from '../utils/emplacementsStockDefaut.js';
import { CATEGORIES_PRODUITS_DEFAUT, CONGES_TYPES_DEFAUT, PAYMENT_TERMS_DEFAUT } from '../utils/referentielsDefaut.js';

// Ce script tourne en dehors du serveur Express (invoqué directement via `node
// src/db/migrate.js`), donc db.js (qui charge son propre .env via un chemin relatif
// différent) n'est pas utilisé ici — chemin explicite vers le .env à la racine de server/,
// résolu depuis l'emplacement réel de ce fichier (pas depuis le répertoire d'exécution).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { Client } = pg;

// Un `Client` simple (une seule connexion), pas un `Pool` comme dans db.js — ce script
// s'exécute une fois puis se termine, inutile de gérer un pool de connexions.
const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const SQL = `
-- ═══════════════ Socle jamais créé par ce script (amorcé à la main très tôt dans le projet,
-- jamais capturé nulle part) — sur une base neuve (nouveau volume Postgres, ex. premier
-- déploiement réel), aucune des tables ci-dessous n'existait et ce script plantait dès la
-- première ALTER TABLE le supposant (parcelles/finances/clients/recoltes/entreprises/users
-- plus bas, ainsi que cultures_mouvements juste après ce bloc). Reproduites ici à l'identique
-- du schéma de production (vérifié via \\d sur la base réelle). Placées en tout premier pour
-- que toute ALTER TABLE plus bas les trouve déjà créées. Sans effet sur une base déjà migrée
-- (CREATE TABLE IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS entreprises (
  id                    SERIAL PRIMARY KEY,
  nom                   VARCHAR(255) NOT NULL,
  siret                 VARCHAR(20),
  adresse               TEXT,
  secteur               VARCHAR(100),
  created_at            TIMESTAMP DEFAULT now(),
  type_compte           VARCHAR(20) NOT NULL DEFAULT 'entreprise' CHECK (type_compte IN ('entreprise', 'particulier')),
  banque_principale_id  INTEGER,
  banque_non_requise    BOOLEAN NOT NULL DEFAULT FALSE,
  salarie_non_requis    BOOLEAN NOT NULL DEFAULT FALSE
);

-- ═══════════════ Abonnement Phase 1 (2026-09-04) : essai 45 j + activation manuelle ═══════════════
-- Voir docs/spec-abonnement-phase1.md pour la spec complète. Enforcement basé sur les dates
-- (subscriptionGuard.js), pas de cron : subscription_status est un indicateur d'affichage
-- admin, la vérité ce sont trial_ends_at/activated_until. Colonnes ajoutées en ALTER (pas dans
-- le CREATE TABLE ci-dessus, qui reproduit le schéma socle déjà en production) pour que le
-- backfill grand-père plus bas (voir seedAbonnementBackfill) puisse distinguer une ligne
-- antérieure au modèle (trial_ends_at IS NULL) d'une nouvelle inscription.
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'trial';
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS trial_ends_at   TIMESTAMP;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS activated_at    TIMESTAMP;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS activated_until TIMESTAMP;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS grace_until     TIMESTAMP;
ALTER TABLE entreprises DROP CONSTRAINT IF EXISTS entreprises_subscription_status_check;
ALTER TABLE entreprises ADD  CONSTRAINT entreprises_subscription_status_check
  CHECK (subscription_status IN ('trial','active','expired','suspended','exempt'));
CREATE INDEX IF NOT EXISTS idx_entreprises_subscription_status ON entreprises(subscription_status);

CREATE TABLE IF NOT EXISTS users (
  id                 SERIAL PRIMARY KEY,
  email              VARCHAR(255) NOT NULL UNIQUE,
  password           VARCHAR(255) NOT NULL,
  role               VARCHAR(50) NOT NULL,
  created_at         TIMESTAMP DEFAULT now(),
  mfa_secret         VARCHAR(64),
  mfa_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  is_platform_admin  BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));

-- Historique des paiements/activations d'abonnement (saisie manuelle par un platform-admin en
-- Phase 1 — moyen ∈ 'manuel_virement'|'manuel_especes'|'manuel_mobile_money'|'offert',
-- 'paddle'/'stripe' réservés à une Phase 2 en ligne, pas encore construite). Les transitions de
-- statut elles-mêmes sont journalisées dans audit_log (trial_started, subscription_activated,
-- etc.), pas ici — cette table ne porte que les paiements/activations. Placée après "users"
-- (pas juste après les colonnes entreprises ci-dessus) : sa FK cree_par_user_id l'exige, un
-- CREATE TABLE ne peut pas référencer une table pas encore créée (contrairement à une ALTER
-- TABLE ADD CONSTRAINT, qui peut être différée).
CREATE TABLE IF NOT EXISTS abonnement_paiements (
  id                SERIAL PRIMARY KEY,
  entreprise_id     INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  montant           NUMERIC(12,2),
  devise            TEXT,
  periode_debut     DATE,
  periode_fin       DATE,
  moyen             TEXT,
  reference         TEXT,
  note              TEXT,
  cree_par_user_id  INTEGER REFERENCES users(id),
  created_at        TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_abonnement_paiements_entreprise_id ON abonnement_paiements(entreprise_id);

CREATE TABLE IF NOT EXISTS entreprise_utilisateurs (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role           VARCHAR(30) NOT NULL DEFAULT 'Salarié',
  statut         VARCHAR(20) NOT NULL DEFAULT 'Actif',
  created_at     TIMESTAMP DEFAULT now(),
  UNIQUE (entreprise_id, user_id)
);

CREATE TABLE IF NOT EXISTS banques (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  nom_banque     VARCHAR(100) NOT NULL,
  iban           VARCHAR(34),
  type_compte    VARCHAR(50),
  solde          NUMERIC(12, 2) DEFAULT 0,
  created_at     TIMESTAMP DEFAULT now()
);

-- Dépendance circulaire entreprises <-> banques (banque_principale_id) : la FK ne peut être
-- posée qu'une fois les deux tables créées. Pas de "ADD CONSTRAINT IF NOT EXISTS" natif en
-- Postgres, d'où le bloc DO qui avale l'erreur "existe déjà" sur une base déjà migrée.
DO $$
BEGIN
  ALTER TABLE entreprises ADD CONSTRAINT entreprises_banque_principale_id_fkey
    FOREIGN KEY (banque_principale_id) REFERENCES banques(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS clients (
  id             SERIAL PRIMARY KEY,
  nom            VARCHAR(255) NOT NULL,
  telephone      VARCHAR(50),
  adresse        TEXT,
  created_at     TIMESTAMP DEFAULT now(),
  user_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id),
  prenom         VARCHAR(150),
  email          VARCHAR(150),
  siret          VARCHAR(30)
);
CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id);

CREATE TABLE IF NOT EXISTS fournisseurs (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id        INTEGER REFERENCES users(id),
  nom            VARCHAR(150) NOT NULL,
  prenom         VARCHAR(150),
  telephone      VARCHAR(30),
  email          VARCHAR(150),
  siret          VARCHAR(30),
  adresse        TEXT,
  created_at     TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parcelles (
  id             SERIAL PRIMARY KEY,
  nom            VARCHAR(100) NOT NULL,
  superficie     NUMERIC(10, 2),
  localisation   TEXT,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  culture        TEXT,
  humidite       NUMERIC(5, 2) NOT NULL DEFAULT 50,
  temperature    NUMERIC(5, 2) NOT NULL DEFAULT 25,
  mode           TEXT NOT NULL DEFAULT 'auto',
  vanne_ouverte  BOOLEAN NOT NULL DEFAULT FALSE,
  seuil          NUMERIC(5, 2) NOT NULL DEFAULT 35,
  pos_x          NUMERIC(5, 2) NOT NULL DEFAULT 50,
  pos_y          NUMERIC(5, 2) NOT NULL DEFAULT 50,
  user_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id)
);
CREATE INDEX IF NOT EXISTS idx_parcelles_user_id ON parcelles(user_id);

CREATE TABLE IF NOT EXISTS cultures (
  id                   SERIAL PRIMARY KEY,
  parcelle_id          INTEGER REFERENCES parcelles(id) ON DELETE CASCADE,
  nom                  VARCHAR(100) NOT NULL,
  date_semis           DATE,
  date_recolte_prevue  DATE,
  surface              NUMERIC(10, 2),
  statut               VARCHAR(50) DEFAULT 'En cours',
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  entreprise_id        INTEGER NOT NULL REFERENCES entreprises(id)
);

CREATE TABLE IF NOT EXISTS recoltes (
  id             SERIAL PRIMARY KEY,
  culture_id     INTEGER REFERENCES cultures(id) ON DELETE CASCADE,
  date_recolte   DATE,
  quantite       NUMERIC(10, 2),
  unite          VARCHAR(20),
  observations   TEXT,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id),
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  parcelle       TEXT,
  culture        TEXT,
  qualite        TEXT,
  destination    TEXT,
  parcelle_id    INTEGER REFERENCES parcelles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_recoltes_entreprise_id ON recoltes(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_recoltes_parcelle_id ON recoltes(parcelle_id);

CREATE TABLE IF NOT EXISTS poulaillers (
  id             SERIAL PRIMARY KEY,
  nom            VARCHAR(100),
  capacite       INTEGER,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id)
);

CREATE TABLE IF NOT EXISTS lots_volailles (
  id             SERIAL PRIMARY KEY,
  poulailler_id  INTEGER REFERENCES poulaillers(id) ON DELETE CASCADE,
  type_volaille  VARCHAR(50),
  quantite       INTEGER,
  date_entree    DATE,
  statut         VARCHAR(50) DEFAULT 'Actif',
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id)
);

CREATE TABLE IF NOT EXISTS production_oeufs (
  id               SERIAL PRIMARY KEY,
  lot_id           INTEGER REFERENCES lots_volailles(id) ON DELETE CASCADE,
  date_production  DATE,
  quantite         INTEGER,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  entreprise_id    INTEGER NOT NULL REFERENCES entreprises(id)
);

CREATE TABLE IF NOT EXISTS devis (
  id                 SERIAL PRIMARY KEY,
  entreprise_id      INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id            INTEGER REFERENCES users(id),
  client_id          INTEGER REFERENCES clients(id),
  numero             VARCHAR(30) NOT NULL,
  statut             VARCHAR(20) NOT NULL DEFAULT 'Brouillon',
  date               DATE DEFAULT CURRENT_DATE,
  date_signature     TIMESTAMP,
  signature_data     TEXT,
  signataire_nom     VARCHAR(150),
  total              NUMERIC(14, 2) DEFAULT 0,
  notes              TEXT,
  token_public       VARCHAR(64) UNIQUE,
  created_at         TIMESTAMP DEFAULT now(),
  mode_paiement      VARCHAR(20),
  modalite_paiement  VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS devis_lignes (
  id             SERIAL PRIMARY KEY,
  devis_id       INTEGER NOT NULL REFERENCES devis(id) ON DELETE CASCADE,
  produit        VARCHAR(150) NOT NULL,
  quantite       NUMERIC(12, 2) NOT NULL,
  prix_unitaire  NUMERIC(14, 2) NOT NULL,
  ordre          INTEGER DEFAULT 0,
  recolte_id     INTEGER REFERENCES recoltes(id) ON DELETE SET NULL,
  stock_id       INTEGER,
  stock_module   TEXT
);

-- Alignement visuel ERP (2026-08-27) : remise globale unique par devis, conditions de
-- paiement en texte libre (ex: "30 jours") et date de livraison promise. Contrairement à une
-- v1 envisagée où ces infos n'auraient été qu'un affichage recalculé côté frontend,
-- remise_globale est appliquée au total stocké en base (voir routes/devis.js:calculerTotal)
-- pour que la synchronisation finances/stock (qui lit devis.total) reste cohérente avec ce
-- qui s'affiche. Un taux de taxe UNIQUE par devis a été tenté ici dans un premier temps
-- (colonne devis.taux_taxe) puis abandonné le jour même au profit d'un vrai taux par ligne
-- (devis_lignes.taux_taxe, plus bas) après retour explicite de l'utilisateur — voir
-- migrateTaxeDevisVersLignes() pour la bascule (sans perte, confirmé 0 ligne réelle affectée
-- en production au moment du changement).
ALTER TABLE devis ADD COLUMN IF NOT EXISTS remise_globale NUMERIC(5, 2) NOT NULL DEFAULT 0;
ALTER TABLE devis ADD COLUMN IF NOT EXISTS conditions_paiement TEXT;
ALTER TABLE devis ADD COLUMN IF NOT EXISTS livraison_promise DATE;
-- Étape 0 Comptabilité (2026-08-30) : date de validité du devis (= validity_date d'un
-- ERP de référence). Le statut "Expiré" n'est PAS stocké — il est calculé à la volée
-- (voir DEVIS_COLUMNS.expired dans routes/devis.js), comme is_expired côté ERP.
ALTER TABLE devis ADD COLUMN IF NOT EXISTS validity_date DATE;
UPDATE devis SET validity_date = date + INTERVAL '30 days' WHERE validity_date IS NULL;
-- Terme de paiement rattaché à un devis facturé (nullable : les factures d'avant l'étape 0
-- et le repli "échéances saisies à la main" n'en ont pas).
ALTER TABLE devis ADD COLUMN IF NOT EXISTS payment_term_id INTEGER;
-- Unité de mesure par ligne (ex: "kg", "sacs", "Heures") — préremplie depuis le produit du
-- catalogue au même titre que le prix, mais reste un simple champ texte libre modifiable.
ALTER TABLE devis_lignes ADD COLUMN IF NOT EXISTS unite TEXT;
-- Étape 1 Comptabilité (2026-08-30) : devis_lignes.taux_taxe (un simple % par ligne) est
-- RETIRÉE au profit de vraies taxes réutilisables (account_tax, plus bas) reliées par la
-- table de jointure devis_lignes_taxes — cf. sale.order.line.tax_id (Many2many) d'un ERP de
-- référence. L ancien ADD COLUMN IF NOT EXISTS taux_taxe a été supprimé d ici (le laisser
-- l aurait recréée à chaque relance après le DROP — même piège que remise/client_prix/
-- cultures_stocks aux étapes précédentes). La conversion + le DROP se font dans
-- migrateTaxeDevisLignesVersAccountTax() plus bas.

-- Étape 4 (2026-08-18) : alignement structurel ERP — remise en pourcentage, lignes de
-- section/note, suivi manuel livré/facturé. Voir migrateRemiseToPourcentage() plus bas pour
-- la conversion de l'ancienne colonne remise (montant fixe) vers remise_pourcentage.
ALTER TABLE devis_lignes ADD COLUMN IF NOT EXISTS remise_pourcentage NUMERIC(5, 2) NOT NULL DEFAULT 0;
-- type est une énumération structurelle fermée (même choix que cultures_mouvements.type,
-- CHECK (type IN ('vente','achat')) déjà en place) — contrairement à remise_pourcentage,
-- une règle métier volontairement non contrainte en DB comme le reste du projet.
ALTER TABLE devis_lignes ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'produit';
ALTER TABLE devis_lignes ADD COLUMN IF NOT EXISTS quantite_livree NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE devis_lignes ADD COLUMN IF NOT EXISTS quantite_facturee NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE devis_lignes DROP CONSTRAINT IF EXISTS devis_lignes_type_check;
ALTER TABLE devis_lignes ADD CONSTRAINT devis_lignes_type_check CHECK (type IN ('produit', 'section'));

-- Backfill de cohérence : un devis déjà Facturé/Non payé/Payé partiellement avant cette étape
-- doit refléter que ses lignes ont bien été facturées (sinon incohérent avec la règle que
-- POST /:id/facturer applique désormais pour toute future facturation). Idempotent par nature
-- (réapplique la même valeur à chaque relance, sans effet une fois déjà appliqué).
UPDATE devis_lignes dl SET quantite_facturee = dl.quantite
FROM devis d
WHERE d.id = dl.devis_id AND d.statut IN ('Facturé', 'Non payé', 'Payé partiellement') AND dl.type = 'produit';

CREATE TABLE IF NOT EXISTS echeances_paiement (
  id             SERIAL PRIMARY KEY,
  devis_id       INTEGER NOT NULL REFERENCES devis(id) ON DELETE CASCADE,
  montant        NUMERIC(14, 2) NOT NULL,
  date_echeance  DATE NOT NULL,
  statut         VARCHAR(20) NOT NULL DEFAULT 'En attente',
  date_paiement  TIMESTAMP,
  ordre          INTEGER DEFAULT 0
);

-- ═══════════════ Étape 0 Comptabilité — conditions de paiement réutilisables ═══════════════
-- Calqué sur account.payment.term / account.payment.term.line d'un ERP de référence :
-- un terme nommé + des lignes qui répartissent le montant (percent/fixed/balance) et
-- calculent une date d'échéance (delay_type + nb_days). Utilisé par POST /devis/:id/facturer
-- pour générer les echeances_paiement, à la place de la saisie manuelle.
CREATE TABLE IF NOT EXISTS payment_terms (
  id                  SERIAL PRIMARY KEY,
  entreprise_id       INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  sequence            INTEGER NOT NULL DEFAULT 10,
  display_on_invoice  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entreprise_id, name)
);
CREATE INDEX IF NOT EXISTS idx_payment_terms_entreprise_id ON payment_terms(entreprise_id);

CREATE TABLE IF NOT EXISTS payment_term_lines (
  id               SERIAL PRIMARY KEY,
  payment_term_id  INTEGER NOT NULL REFERENCES payment_terms(id) ON DELETE CASCADE,
  value            TEXT NOT NULL DEFAULT 'balance' CHECK (value IN ('percent', 'fixed', 'balance')),
  value_amount     NUMERIC(12, 2) NOT NULL DEFAULT 0,
  delay_type       TEXT NOT NULL DEFAULT 'days_after' CHECK (delay_type IN ('days_after', 'days_after_end_of_month')),
  nb_days          INTEGER NOT NULL DEFAULT 0,
  ordre            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_payment_term_lines_term_id ON payment_term_lines(payment_term_id);

-- FK de devis.payment_term_id posée ici (après la création de payment_terms) — SET NULL
-- si le terme est supprimé, la facture garde ses échéances déjà générées.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'devis_payment_term_id_fkey') THEN
    ALTER TABLE devis ADD CONSTRAINT devis_payment_term_id_fkey
      FOREIGN KEY (payment_term_id) REFERENCES payment_terms(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ═══════════════ Étape 1 Comptabilité — taxes réutilisables (account.tax) ═══════════════
-- Calqué sur account.tax d'un ERP de référence. Étape 1 calcule amount_type 'percent' et
-- 'fixed' (par unité) ; 'group'/'division' sont autorisés par le CHECK mais pas encore
-- implémentés ni proposés à l'UI (les repartition lines arrivent avec account.move, étape 3).
CREATE TABLE IF NOT EXISTS account_tax (
  id                   SERIAL PRIMARY KEY,
  entreprise_id        INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  type_tax_use         TEXT NOT NULL DEFAULT 'sale' CHECK (type_tax_use IN ('sale', 'purchase', 'none')),
  amount_type          TEXT NOT NULL DEFAULT 'percent' CHECK (amount_type IN ('percent', 'fixed', 'group', 'division')),
  amount               NUMERIC(16, 4) NOT NULL DEFAULT 0,
  price_include        BOOLEAN NOT NULL DEFAULT FALSE,
  include_base_amount  BOOLEAN NOT NULL DEFAULT FALSE,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  sequence             INTEGER NOT NULL DEFAULT 1,
  description          TEXT,
  invoice_label        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entreprise_id, name)
);
CREATE INDEX IF NOT EXISTS idx_account_tax_entreprise_id ON account_tax(entreprise_id);

-- sale.order.line.tax_id est un Many2many → table de jointure. Les lignes de devis sont
-- supprimées/réinsérées à chaque PUT (voir routes/devis.js), donc ces liens cascadent et
-- sont reconstruits à chaque enregistrement.
CREATE TABLE IF NOT EXISTS devis_lignes_taxes (
  id              SERIAL PRIMARY KEY,
  devis_ligne_id  INTEGER NOT NULL REFERENCES devis_lignes(id) ON DELETE CASCADE,
  tax_id          INTEGER NOT NULL REFERENCES account_tax(id) ON DELETE CASCADE,
  UNIQUE (devis_ligne_id, tax_id)
);
CREATE INDEX IF NOT EXISTS idx_devis_lignes_taxes_ligne ON devis_lignes_taxes(devis_ligne_id);

-- ═══════════════ Étape 2 Comptabilité — journaux + plan de comptes + séquences ═══════════════
-- Objets de configuration calqués sur account.journal / account.account d'un ERP de référence.
-- Aucune écriture comptable ne s'y rattache encore (account.move arrive à l'étape 3) : ce sont
-- les référentiels + le numérotateur que l'étape 3 consommera. Le plan de comptes seedé suit
-- le chart générique (codes 1xxxxx/2xxxxx/4xxxxx/5xxxxx), pas un PCG national — portée mondiale.
CREATE TABLE IF NOT EXISTS account_account (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  code           VARCHAR(64) NOT NULL,
  name           TEXT NOT NULL,
  account_type   TEXT NOT NULL CHECK (account_type IN (
                   'asset_receivable', 'asset_cash', 'asset_current', 'asset_non_current',
                   'asset_prepayments', 'asset_fixed', 'liability_payable', 'liability_credit_card',
                   'liability_current', 'liability_non_current', 'equity', 'equity_unaffected',
                   'income', 'income_other', 'expense', 'expense_other', 'expense_depreciation',
                   'expense_direct_cost', 'off_balance')),
  reconcile      BOOLEAN NOT NULL DEFAULT FALSE,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entreprise_id, code)
);
CREATE INDEX IF NOT EXISTS idx_account_account_entreprise_id ON account_account(entreprise_id);

CREATE TABLE IF NOT EXISTS account_journal (
  id                  SERIAL PRIMARY KEY,
  entreprise_id       INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  code                VARCHAR(5) NOT NULL,
  type                TEXT NOT NULL CHECK (type IN ('sale', 'purchase', 'cash', 'bank', 'general')),
  sequence            INTEGER NOT NULL DEFAULT 10,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  refund_sequence     BOOLEAN NOT NULL DEFAULT FALSE,
  default_account_id  INTEGER REFERENCES account_account(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entreprise_id, code)
);
CREATE INDEX IF NOT EXISTS idx_account_journal_entreprise_id ON account_journal(entreprise_id);

-- Compteur par (journal, préfixe). Le préfixe porte l'année → remise à zéro annuelle
-- automatique (un nouveau préfixe = un nouveau compteur), comme le sequence.mixin d'un ERP
-- de référence. Alimenté par utils/journalSequence.js (verrou de ligne pour l'incrément).
CREATE TABLE IF NOT EXISTS account_journal_sequence (
  id           SERIAL PRIMARY KEY,
  journal_id   INTEGER NOT NULL REFERENCES account_journal(id) ON DELETE CASCADE,
  prefix       TEXT NOT NULL,
  last_number  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (journal_id, prefix)
);

-- ═══════════════ Étape 3 Comptabilité — account.move + account.move.line (double-partie) ═══════════════
-- La facture devient une pièce comptable à part entière, distincte du devis : un en-tête
-- account_move (draft → posted → cancel) + des lignes account_move_line dont l'ensemble est
-- équilibré (Σdébit = Σcrédit) au moment du post. Calqué sur account.move / account.move.line
-- d'un ERP de référence. POST /api/devis/:id/facturer n'est PAS encore rebranché dessus (étape 3b).
CREATE TABLE IF NOT EXISTS account_move (
  id                 SERIAL PRIMARY KEY,
  entreprise_id      INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  journal_id         INTEGER NOT NULL REFERENCES account_journal(id) ON DELETE RESTRICT,
  move_type          TEXT NOT NULL DEFAULT 'entry' CHECK (move_type IN (
                       'entry', 'out_invoice', 'out_refund', 'in_invoice', 'in_refund')),
  state              TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'posted', 'cancel')),
  name               TEXT,
  ref                TEXT,
  -- FK vers contacts ajoutée plus bas (contacts est créée après ce bloc dans le script).
  partner_id         INTEGER,
  invoice_date       DATE,
  invoice_date_due   DATE,
  date               DATE NOT NULL DEFAULT CURRENT_DATE,
  invoice_origin     TEXT,
  payment_term_id    INTEGER REFERENCES payment_terms(id) ON DELETE SET NULL,
  amount_untaxed     NUMERIC(16, 2) NOT NULL DEFAULT 0,
  amount_tax         NUMERIC(16, 2) NOT NULL DEFAULT 0,
  amount_total       NUMERIC(16, 2) NOT NULL DEFAULT 0,
  amount_residual    NUMERIC(16, 2) NOT NULL DEFAULT 0,
  payment_state      TEXT NOT NULL DEFAULT 'not_paid' CHECK (payment_state IN (
                       'not_paid', 'in_payment', 'paid', 'partial', 'reversed')),
  reversed_entry_id  INTEGER REFERENCES account_move(id) ON DELETE SET NULL,
  user_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_account_move_entreprise_id ON account_move(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_account_move_journal_id ON account_move(journal_id);
CREATE INDEX IF NOT EXISTS idx_account_move_partner_id ON account_move(partner_id);
CREATE INDEX IF NOT EXISTS idx_account_move_type_state ON account_move(entreprise_id, move_type, state);
-- Un numéro (name) est unique par journal une fois attribué (au post). Index partiel : les
-- brouillons ont name = NULL et ne sont donc pas contraints.
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_move_name_journal
  ON account_move(journal_id, name) WHERE name IS NOT NULL;

CREATE TABLE IF NOT EXISTS account_move_line (
  id                  SERIAL PRIMARY KEY,
  move_id             INTEGER NOT NULL REFERENCES account_move(id) ON DELETE CASCADE,
  entreprise_id       INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  account_id          INTEGER REFERENCES account_account(id) ON DELETE RESTRICT,
  partner_id          INTEGER, -- FK vers contacts ajoutée plus bas
  name                TEXT,
  display_type        TEXT NOT NULL DEFAULT 'product' CHECK (display_type IN (
                        'product', 'line_section', 'line_note', 'tax', 'payment_term', 'rounding')),
  sequence            INTEGER NOT NULL DEFAULT 10,
  quantity            NUMERIC(16, 4) NOT NULL DEFAULT 0,
  price_unit          NUMERIC(16, 4) NOT NULL DEFAULT 0,
  discount            NUMERIC(5, 2) NOT NULL DEFAULT 0,
  price_subtotal      NUMERIC(16, 2) NOT NULL DEFAULT 0,
  price_total         NUMERIC(16, 2) NOT NULL DEFAULT 0,
  debit               NUMERIC(16, 2) NOT NULL DEFAULT 0,
  credit              NUMERIC(16, 2) NOT NULL DEFAULT 0,
  balance             NUMERIC(16, 2) NOT NULL DEFAULT 0,
  tax_line_id         INTEGER REFERENCES account_tax(id) ON DELETE SET NULL,
  amount_residual     NUMERIC(16, 2) NOT NULL DEFAULT 0,
  reconciled          BOOLEAN NOT NULL DEFAULT FALSE,
  full_reconcile_id   INTEGER,
  matching_number     TEXT,
  date_maturity       DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_account_move_line_move_id ON account_move_line(move_id);
CREATE INDEX IF NOT EXISTS idx_account_move_line_account ON account_move_line(entreprise_id, account_id, reconciled);

-- tax_ids d'une ligne produit (Many2many) — patron devis_lignes_taxes.
CREATE TABLE IF NOT EXISTS account_move_line_taxes (
  id             SERIAL PRIMARY KEY,
  move_line_id   INTEGER NOT NULL REFERENCES account_move_line(id) ON DELETE CASCADE,
  tax_id         INTEGER NOT NULL REFERENCES account_tax(id) ON DELETE CASCADE,
  UNIQUE (move_line_id, tax_id)
);
CREATE INDEX IF NOT EXISTS idx_account_move_line_taxes_line ON account_move_line_taxes(move_line_id);

-- Lettrage : une écriture de lettrage total (account.full.reconcile) regroupe des
-- rapprochements partiels (account.partial.reconcile) entre une ligne au débit et une au
-- crédit, jusqu'à solder les deux.
CREATE TABLE IF NOT EXISTS account_full_reconcile (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS account_partial_reconcile (
  id                    SERIAL PRIMARY KEY,
  entreprise_id         INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  debit_move_line_id    INTEGER NOT NULL REFERENCES account_move_line(id) ON DELETE CASCADE,
  credit_move_line_id   INTEGER NOT NULL REFERENCES account_move_line(id) ON DELETE CASCADE,
  amount                NUMERIC(16, 2) NOT NULL,
  full_reconcile_id     INTEGER REFERENCES account_full_reconcile(id) ON DELETE SET NULL,
  max_date              DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_apr_debit ON account_partial_reconcile(debit_move_line_id);
CREATE INDEX IF NOT EXISTS idx_apr_credit ON account_partial_reconcile(credit_move_line_id);

-- account.payment délègue à une account_move (son écriture : banque + créance/dette).
CREATE TABLE IF NOT EXISTS account_payment (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  move_id        INTEGER REFERENCES account_move(id) ON DELETE SET NULL,
  journal_id     INTEGER NOT NULL REFERENCES account_journal(id) ON DELETE RESTRICT,
  payment_type   TEXT NOT NULL CHECK (payment_type IN ('inbound', 'outbound')),
  partner_type   TEXT NOT NULL DEFAULT 'customer' CHECK (partner_type IN ('customer', 'supplier')),
  partner_id     INTEGER, -- FK vers contacts ajoutée plus bas

  amount         NUMERIC(16, 2) NOT NULL,
  payment_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  ref            TEXT,
  state          TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'posted', 'cancel')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_account_payment_entreprise_id ON account_payment(entreprise_id);

-- Une échéance peut appartenir à une facture (account_move) en plus / à la place d'un
-- devis — devis_id devient donc nullable. Depuis l'étape 3b, POST /devis/:id/facturer crée
-- une vraie facture account_move et rattache les échéances aux DEUX (devis_id + move_id).
ALTER TABLE echeances_paiement ADD COLUMN IF NOT EXISTS move_id INTEGER REFERENCES account_move(id) ON DELETE CASCADE;
ALTER TABLE echeances_paiement ALTER COLUMN devis_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_echeances_paiement_move_id ON echeances_paiement(move_id);

-- Étape 3b : un devis facturé pointe vers la facture comptable (account_move) qu'il a
-- produite. NULL pour les devis encore en brouillon/signé et pour les devis facturés avant
-- l'étape 3b (ceux-là gardent l'ancien flux d'échéances côté devis).
ALTER TABLE devis ADD COLUMN IF NOT EXISTS move_id INTEGER REFERENCES account_move(id) ON DELETE SET NULL;

-- Étape 4 : inaltérabilité des factures postées (opt-in via account_journal.
-- restrict_mode_hash_table). inalterable_hash = sha256 chaîné par journal ;
-- secure_sequence_number = compteur sans trou (distinct du numéro d affichage name qui,
-- lui, peut sauter). secure_sequence_last vit sur le journal, incrémenté sous verrou au post.
ALTER TABLE account_move ADD COLUMN IF NOT EXISTS inalterable_hash TEXT;
ALTER TABLE account_move ADD COLUMN IF NOT EXISTS secure_sequence_number INTEGER;
ALTER TABLE account_journal ADD COLUMN IF NOT EXISTS restrict_mode_hash_table BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE account_journal ADD COLUMN IF NOT EXISTS secure_sequence_last INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_account_move_secure_seq ON account_move(journal_id, secure_sequence_number);

-- Étape 6 : base de relances. Combien de fois une facture a été relancée + date de la
-- dernière relance (l'envoi d'email est différé — SMTP non configuré ; ces champs sont
-- juste le suivi). La balance âgée et la liste des retards se calculent à la volée.
ALTER TABLE account_move ADD COLUMN IF NOT EXISTS relance_niveau INTEGER NOT NULL DEFAULT 0;
ALTER TABLE account_move ADD COLUMN IF NOT EXISTS derniere_relance DATE;

CREATE TABLE IF NOT EXISTS finances (
  id                   SERIAL PRIMARY KEY,
  type                 VARCHAR(50) NOT NULL,
  montant              NUMERIC(12, 2) NOT NULL,
  description          TEXT,
  created_at           TIMESTAMP DEFAULT now(),
  user_id              INTEGER REFERENCES users(id) ON DELETE CASCADE,
  source_module        VARCHAR(20),
  source_mouvement_id  INTEGER,
  entreprise_id        INTEGER NOT NULL REFERENCES entreprises(id),
  banque_id            INTEGER REFERENCES banques(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_finances_user_id ON finances(user_id);

CREATE TABLE IF NOT EXISTS mouvements_historique (
  id                 SERIAL PRIMARY KEY,
  entreprise_id      INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id            INTEGER REFERENCES users(id),
  module             VARCHAR(20) NOT NULL,
  mouvement_id       INTEGER NOT NULL,
  action             VARCHAR(20) NOT NULL,
  raison             TEXT NOT NULL,
  anciennes_valeurs  JSONB,
  nouvelles_valeurs  JSONB,
  created_at         TIMESTAMP DEFAULT now()
);

-- Étend la table parcelles existante (nom, superficie, localisation)
-- avec les colonnes nécessaires au suivi capteurs / irrigation.
-- Contour réel du champ (GeoJSON Polygon), tracé sur imagerie satellite. En jsonb et non en
-- géométrie PostGIS : l'image postgres:18-alpine n'a pas l'extension, et aucune requête
-- spatiale n'est faite — seulement du stockage, une surface et un centroïde (utils/geoParcelle.js).
-- ═══════════════ Rôles définis par l'entreprise ═══════════════
-- L'application ne définit AUCUNE politique. Elle fournit le vocabulaire (ressources × actions,
-- voir src/permissions/catalogue.js) et le mécanisme ; l'entreprise part d'une page blanche.
--
-- Trois règles, et rien d'autre :
--   1. Le compte qui a ouvert l'entreprise en est le MAÎTRE. Il garde tout, définitivement :
--      aucune restriction ne peut lui être opposée, sinon une entreprise se verrouille dehors.
--   2. Un utilisateur sans rôle n'a AUCUNE restriction — tout est ouvert par défaut.
--   3. Un rôle est ouvert lui aussi ; il ne restreint que ce que l'entreprise lui retire.
--      D'où « role_restrictions » (ce qui est interdit) et non « role_permissions ».
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS proprietaire_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS roles (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  nom            TEXT NOT NULL,
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_entreprise_nom ON roles(entreprise_id, lower(nom));
CREATE INDEX IF NOT EXISTS idx_roles_entreprise_id ON roles(entreprise_id);

-- Colonnes d'une première version qui amorçait six rôles imposés : retirées, l'application ne
-- doit fournir aucune politique. Voir le journal du 2026-09-13.
ALTER TABLE roles DROP COLUMN IF EXISTS code;
ALTER TABLE roles DROP COLUMN IF EXISTS administration;

CREATE TABLE IF NOT EXISTS role_restrictions (
  role_id    INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  ressource  TEXT NOT NULL,
  action     TEXT NOT NULL,
  PRIMARY KEY (role_id, ressource, action)
);
DROP TABLE IF EXISTS role_permissions;

ALTER TABLE entreprise_utilisateurs ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL;

ALTER TABLE parcelles ADD COLUMN IF NOT EXISTS contour       JSONB;
ALTER TABLE parcelles ADD COLUMN IF NOT EXISTS culture       TEXT;
ALTER TABLE parcelles ADD COLUMN IF NOT EXISTS humidite      NUMERIC(5, 2) NOT NULL DEFAULT 50;
ALTER TABLE parcelles ADD COLUMN IF NOT EXISTS temperature   NUMERIC(5, 2) NOT NULL DEFAULT 25;
ALTER TABLE parcelles ADD COLUMN IF NOT EXISTS mode          TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE parcelles ADD COLUMN IF NOT EXISTS vanne_ouverte BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE parcelles ADD COLUMN IF NOT EXISTS seuil         NUMERIC(5, 2) NOT NULL DEFAULT 35;
ALTER TABLE parcelles ADD COLUMN IF NOT EXISTS pos_x         NUMERIC(5, 2) NOT NULL DEFAULT 50;
ALTER TABLE parcelles ADD COLUMN IF NOT EXISTS pos_y         NUMERIC(5, 2) NOT NULL DEFAULT 50;
-- Date de semis (optionnelle) : point de départ réel pour le calendrier d'intervention
-- généré par POST /api/planning (server/src/services/cultureService.js) — sans elle, le
-- calendrier se calcule depuis la date du jour (comportement de repli, pas une erreur).
ALTER TABLE parcelles ADD COLUMN IF NOT EXISTS date_semis    DATE;

-- Localisation propre à la parcelle (optionnelle) — prime sur celle de l'entreprise pour la
-- météo (voir routes/meteo.js) quand elle est renseignée ; sinon repli automatique sur
-- entreprises.ville/latitude/longitude. Utile pour des parcelles géographiquement dispersées.
ALTER TABLE parcelles ADD COLUMN IF NOT EXISTS ville         TEXT;
ALTER TABLE parcelles ADD COLUMN IF NOT EXISTS latitude      NUMERIC(9, 6);
ALTER TABLE parcelles ADD COLUMN IF NOT EXISTS longitude     NUMERIC(9, 6);

-- Agriculture de précision (voir routes/precisionAgricole.js) — id du polygone créé côté
-- Agromonitoring pour l'historique NDVI (carré approximatif dérivé de latitude/longitude/
-- superficie, voir utils/agroPolygon.js). Remis à NULL dès que l'un de ces trois champs
-- change (PUT /cultures/parcelles/:id), pour forcer une recréation au prochain appel NDVI.
ALTER TABLE parcelles ADD COLUMN IF NOT EXISTS agro_polygon_id TEXT;

-- Historique des vannes, lié aux parcelles existantes par id entier
CREATE TABLE IF NOT EXISTS parcelles_historique (
  id           SERIAL PRIMARY KEY,
  parcelle_id  INTEGER REFERENCES parcelles(id) ON DELETE CASCADE,
  action       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ventes et achats du module Cultures (mutualisés dans une seule table)
CREATE TABLE IF NOT EXISTS cultures_mouvements (
  id            SERIAL PRIMARY KEY,
  type          TEXT NOT NULL CHECK (type IN ('vente', 'achat')),
  date          DATE NOT NULL DEFAULT CURRENT_DATE,
  partenaire    TEXT NOT NULL,
  produit       TEXT NOT NULL,
  quantite      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  prix_unitaire NUMERIC(12, 2) NOT NULL DEFAULT 0,
  remise        NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parcelles_historique_parcelle_id ON parcelles_historique(parcelle_id);
CREATE INDEX IF NOT EXISTS idx_cultures_mouvements_type ON cultures_mouvements(type);
-- L'ancien ADD COLUMN IF NOT EXISTS remise (retirée à l'étape 4, voir migrateRemiseToPourcentage
-- plus bas) a été supprimé d'ici : la laisser aurait recréé la colonne à chaque relance de
-- migrate.js une fois supprimée — même bug de fond que les tables client_prix/clients/
-- fournisseurs/cultures_stocks déjà rencontré et corrigé aux étapes précédentes.

-- Stocks du module Cultures (semences, engrais, produits phytosanitaires...)
-- Même forme que poulailler_stocks, mais entreprise_id dès la création (voir
-- le correctif appliqué à poulailler_stocks plus bas pour le même besoin).
CREATE TABLE IF NOT EXISTS cultures_stocks (
  id            SERIAL PRIMARY KEY,
  entreprise_id INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  nom           TEXT NOT NULL,
  categorie     TEXT NOT NULL DEFAULT 'Semences',
  quantite      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  unite         TEXT,
  seuil         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cultures_stocks_entreprise_id ON cultures_stocks(entreprise_id);

-- ═══════════════ Module Poulailler ═══════════════
-- Stocks (aliments, œufs, volailles vivantes...)
CREATE TABLE IF NOT EXISTS poulailler_stocks (
  id            SERIAL PRIMARY KEY,
  entreprise_id INTEGER REFERENCES entreprises(id) ON DELETE CASCADE,
  nom           TEXT NOT NULL,
  categorie     TEXT NOT NULL DEFAULT 'Aliment',
  quantite      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  unite         TEXT,
  seuil         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- entreprise_id existait déjà en base (ajoutée hors versionnement à un moment) mais
-- n'était créée nulle part dans ce script — un environnement neuf plantait dessus
-- (routes/poulailler.js l'utilise partout). Filet de sécurité pour les instances déjà
-- migrées avant ce correctif, sans la forcer NOT NULL pour ne pas casser des lignes existantes.
ALTER TABLE poulailler_stocks ADD COLUMN IF NOT EXISTS entreprise_id INTEGER REFERENCES entreprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_poulailler_stocks_entreprise_id ON poulailler_stocks(entreprise_id);

-- Ventes et achats du module Poulailler (mutualisés dans une seule table)
CREATE TABLE IF NOT EXISTS poulailler_mouvements (
  id            SERIAL PRIMARY KEY,
  type          TEXT NOT NULL CHECK (type IN ('vente', 'achat')),
  date          DATE NOT NULL DEFAULT CURRENT_DATE,
  partenaire    TEXT NOT NULL,
  produit       TEXT NOT NULL,
  quantite      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  prix_unitaire NUMERIC(12, 2) NOT NULL DEFAULT 0,
  remise        NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Documents achats multi-lignes pour Cultures et Poulailler
CREATE TABLE IF NOT EXISTS achats_documents (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
  module         TEXT NOT NULL CHECK (module IN ('Cultures', 'Poulailler')),
  date           DATE NOT NULL DEFAULT CURRENT_DATE,
  fournisseur_id INTEGER REFERENCES fournisseurs(id) ON DELETE SET NULL,
  fournisseur_nom TEXT,
  notes          TEXT,
  total          NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS achats_lignes (
  id          SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES achats_documents(id) ON DELETE CASCADE,
  produit     TEXT NOT NULL,
  quantite    NUMERIC(12, 2) NOT NULL DEFAULT 0,
  prix_unitaire NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ordre       INTEGER NOT NULL DEFAULT 0
);

-- Livraisons
CREATE TABLE IF NOT EXISTS poulailler_livraisons (
  id         SERIAL PRIMARY KEY,
  date       DATE NOT NULL DEFAULT CURRENT_DATE,
  client     TEXT NOT NULL,
  produit    TEXT NOT NULL,
  quantite   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  statut     TEXT NOT NULL DEFAULT 'En attente',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Suivi quotidien (mortalité, naissance, vaccination, alimentation, œufs)
CREATE TABLE IF NOT EXISTS poulailler_suivi (
  id         SERIAL PRIMARY KEY,
  date       DATE NOT NULL DEFAULT CURRENT_DATE,
  type       TEXT NOT NULL,
  quantite   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_poulailler_mouvements_type ON poulailler_mouvements(type);
CREATE INDEX IF NOT EXISTS idx_poulailler_suivi_type ON poulailler_suivi(type);

-- ═══════════════ Cloisonnement par utilisateur ═══════════════
-- Ajoute une colonne user_id sur toutes les tables applicatives,
-- et rattache les données déjà existantes (créées avant ce cloisonnement)
-- au tout premier compte utilisateur, pour ne rien perdre.

ALTER TABLE parcelles            ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE parcelles_historique ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE cultures_mouvements  ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE poulailler_stocks    ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE poulailler_mouvements ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE poulailler_livraisons ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE poulailler_suivi     ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE finances             ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE clients              ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

UPDATE parcelles            SET user_id = (SELECT id FROM users ORDER BY id ASC LIMIT 1) WHERE user_id IS NULL;
UPDATE parcelles_historique SET user_id = (SELECT id FROM users ORDER BY id ASC LIMIT 1) WHERE user_id IS NULL;
UPDATE cultures_mouvements  SET user_id = (SELECT id FROM users ORDER BY id ASC LIMIT 1) WHERE user_id IS NULL;
UPDATE poulailler_stocks    SET user_id = (SELECT id FROM users ORDER BY id ASC LIMIT 1) WHERE user_id IS NULL;
UPDATE poulailler_mouvements SET user_id = (SELECT id FROM users ORDER BY id ASC LIMIT 1) WHERE user_id IS NULL;
UPDATE poulailler_livraisons SET user_id = (SELECT id FROM users ORDER BY id ASC LIMIT 1) WHERE user_id IS NULL;
UPDATE poulailler_suivi     SET user_id = (SELECT id FROM users ORDER BY id ASC LIMIT 1) WHERE user_id IS NULL;
UPDATE finances             SET user_id = (SELECT id FROM users ORDER BY id ASC LIMIT 1) WHERE user_id IS NULL;
UPDATE clients              SET user_id = (SELECT id FROM users ORDER BY id ASC LIMIT 1) WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_parcelles_user_id ON parcelles(user_id);
CREATE INDEX IF NOT EXISTS idx_parcelles_historique_user_id ON parcelles_historique(user_id);
CREATE INDEX IF NOT EXISTS idx_cultures_mouvements_user_id ON cultures_mouvements(user_id);
CREATE INDEX IF NOT EXISTS idx_poulailler_stocks_user_id ON poulailler_stocks(user_id);
CREATE INDEX IF NOT EXISTS idx_poulailler_mouvements_user_id ON poulailler_mouvements(user_id);
CREATE INDEX IF NOT EXISTS idx_poulailler_livraisons_user_id ON poulailler_livraisons(user_id);
CREATE INDEX IF NOT EXISTS idx_poulailler_suivi_user_id ON poulailler_suivi(user_id);
CREATE INDEX IF NOT EXISTS idx_finances_user_id ON finances(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id);

-- ═══════════════ Cloisonnement par entreprise — tables Cultures/Poulailler ═══════════════
-- Les CREATE TABLE de parcelles_historique / cultures_mouvements / poulailler_mouvements /
-- poulailler_livraisons / poulailler_suivi ci-dessus n'incluent pas entreprise_id, alors
-- que toutes leurs routes filtrent et insèrent dessus (WHERE entreprise_id = $1). La base
-- de dev l'avait acquise par dérive hors migrate.js ; un déploiement neuf partait cassé
-- sur ces 5 tables — trou révélé par la suite de tests d'intégration (2026-08-30).
ALTER TABLE parcelles_historique  ADD COLUMN IF NOT EXISTS entreprise_id INTEGER REFERENCES entreprises(id) ON DELETE CASCADE;
ALTER TABLE cultures_mouvements   ADD COLUMN IF NOT EXISTS entreprise_id INTEGER REFERENCES entreprises(id) ON DELETE CASCADE;
ALTER TABLE poulailler_mouvements ADD COLUMN IF NOT EXISTS entreprise_id INTEGER REFERENCES entreprises(id) ON DELETE CASCADE;
ALTER TABLE poulailler_livraisons ADD COLUMN IF NOT EXISTS entreprise_id INTEGER REFERENCES entreprises(id) ON DELETE CASCADE;
ALTER TABLE poulailler_suivi      ADD COLUMN IF NOT EXISTS entreprise_id INTEGER REFERENCES entreprises(id) ON DELETE CASCADE;

-- Rattachement des lignes pré-existantes (base déjà en service) : par la parcelle pour
-- l'historique des vannes, sinon au premier compte entreprise, comme le backfill user_id.
UPDATE parcelles_historique ph SET entreprise_id = p.entreprise_id
  FROM parcelles p WHERE p.id = ph.parcelle_id AND ph.entreprise_id IS NULL;
UPDATE cultures_mouvements   SET entreprise_id = (SELECT id FROM entreprises ORDER BY id ASC LIMIT 1) WHERE entreprise_id IS NULL;
UPDATE poulailler_mouvements SET entreprise_id = (SELECT id FROM entreprises ORDER BY id ASC LIMIT 1) WHERE entreprise_id IS NULL;
UPDATE poulailler_livraisons SET entreprise_id = (SELECT id FROM entreprises ORDER BY id ASC LIMIT 1) WHERE entreprise_id IS NULL;
UPDATE poulailler_suivi      SET entreprise_id = (SELECT id FROM entreprises ORDER BY id ASC LIMIT 1) WHERE entreprise_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_parcelles_historique_entreprise_id  ON parcelles_historique(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_cultures_mouvements_entreprise_id   ON cultures_mouvements(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_poulailler_mouvements_entreprise_id ON poulailler_mouvements(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_poulailler_livraisons_entreprise_id ON poulailler_livraisons(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_poulailler_suivi_entreprise_id      ON poulailler_suivi(entreprise_id);

-- ═══════════════ Journal d'audit (connexions, puis actions sensibles) ═══════════════
-- Généraliste (contrairement à mouvements_historique, lié aux ventes/achats) :
-- entreprise_id/user_id nullables car une tentative de connexion échouée peut
-- ne correspondre à aucun compte connu.
CREATE TABLE IF NOT EXISTS audit_log (
  id            SERIAL PRIMARY KEY,
  entreprise_id INTEGER REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email         TEXT,
  action        TEXT NOT NULL,
  ip_address    TEXT,
  user_agent    TEXT,
  details       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entreprise_id ON audit_log(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

-- ═══════════════ Calendrier agricole partagé ═══════════════
CREATE TABLE IF NOT EXISTS calendar_events (
  id            SERIAL PRIMARY KEY,
  entreprise_id INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  date          DATE NOT NULL,
  type          TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_entreprise_id ON calendar_events(entreprise_id);

-- ═══════════════ Récoltes ═══════════════
-- Étend la table recoltes existante (orpheline, jamais requêtée jusqu'ici)
-- pour coller au formulaire actuel du module Récoltes, au lieu de créer une
-- table concurrente. culture_id / unite / observations restent inutilisés.
ALTER TABLE recoltes ADD COLUMN IF NOT EXISTS user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE recoltes ADD COLUMN IF NOT EXISTS parcelle    TEXT;
ALTER TABLE recoltes ADD COLUMN IF NOT EXISTS culture     TEXT;
ALTER TABLE recoltes ADD COLUMN IF NOT EXISTS qualite     TEXT;
ALTER TABLE recoltes ADD COLUMN IF NOT EXISTS destination TEXT;
CREATE INDEX IF NOT EXISTS idx_recoltes_entreprise_id ON recoltes(entreprise_id);

-- ═══════════════ Traçabilité parcelle → récolte → vente (étiquettes, sans gestion de stock) ═══════════════
ALTER TABLE recoltes ADD COLUMN IF NOT EXISTS parcelle_id INTEGER REFERENCES parcelles(id) ON DELETE SET NULL;
ALTER TABLE devis_lignes ADD COLUMN IF NOT EXISTS recolte_id INTEGER REFERENCES recoltes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_recoltes_parcelle_id ON recoltes(parcelle_id);
CREATE INDEX IF NOT EXISTS idx_devis_lignes_recolte_id ON devis_lignes(recolte_id);

-- ═══════════════ Observations (notes de terrain) ═══════════════
-- Reprend migrations/001_create_observations_table.sql (FK déjà corrigée vers users,
-- pas utilisateurs) — repliée ici pour que cette table soit créée automatiquement
-- partout où ce script tourne, au lieu de devoir être appliquée à la main.
CREATE TABLE IF NOT EXISTS observations (
  id                SERIAL PRIMARY KEY,
  entreprise_id     INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  date_observation  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  notes             TEXT NOT NULL,
  localisation      VARCHAR(255),
  created_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_observations_entreprise_id ON observations(entreprise_id);

-- ═══════════════ Assistant de configuration (banque/salarié) — confirmation explicite ═══════════════
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS banque_non_requise BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS salarie_non_requis BOOLEAN NOT NULL DEFAULT FALSE;

-- ═══════════════ Forum de feedback (retours des clients sur l'app elle-même) ═══════════════
-- is_platform_admin distingue "propriétaire de la plateforme" (voit le feedback de
-- toutes les entreprises) des rôles admin/directeur existants (cloisonnés à leur
-- propre entreprise) — un utilisateur normal parmi d'autres, pas un rôle à part.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- ═══════════════ 2FA : méthode choisie par l'utilisateur (TOTP ou code par email) ═══════════════
-- La 2FA par email n'a besoin d'aucune colonne de code : le code est *dérivé* à la
-- demande (HOTP sur un pas de 10 min, clé HMAC(JWT_SECRET, userId+email)) puis vérifié
-- côté serveur — cf. server/src/utils/mfaCode.js. Seule la méthode retenue est stockée.
-- 'totp' par défaut : les comptes ayant déjà activé la 2FA (via mfa_secret) sont en TOTP.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_method VARCHAR(10) NOT NULL DEFAULT 'totp';

CREATE TABLE IF NOT EXISTS feedback (
  id            SERIAL PRIMARY KEY,
  entreprise_id INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type          TEXT NOT NULL DEFAULT 'Suggestion',
  message       TEXT NOT NULL,
  statut        TEXT NOT NULL DEFAULT 'Nouveau',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_entreprise_id ON feedback(entreprise_id);

-- ═══════════════ Inventaire matériel (équipements) ═══════════════
CREATE TABLE IF NOT EXISTS equipements (
  id                SERIAL PRIMARY KEY,
  entreprise_id     INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  nom               TEXT NOT NULL,
  categorie         TEXT NOT NULL DEFAULT 'Autre',
  etat              TEXT NOT NULL DEFAULT 'Fonctionnel',
  date_acquisition  DATE,
  valeur            NUMERIC(12, 2),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_equipements_entreprise_id ON equipements(entreprise_id);

CREATE TABLE IF NOT EXISTS equipements_maintenance (
  id             SERIAL PRIMARY KEY,
  equipement_id  INTEGER NOT NULL REFERENCES equipements(id) ON DELETE CASCADE,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  date           DATE NOT NULL DEFAULT CURRENT_DATE,
  description    TEXT NOT NULL,
  cout           NUMERIC(12, 2),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_equipements_maintenance_equipement_id ON equipements_maintenance(equipement_id);

-- ═══════════════ Salariés (table pré-existante, jamais créée par migrate.js — même
-- trou que poulailler_stocks.entreprise_id documenté plus haut : une base fraîche
-- plantait dessus dès le premier appel à /api/salaries). Reproduit le schéma déjà
-- en place en prod à l'identique (IF NOT EXISTS, donc sans effet sur une base existante).
CREATE TABLE IF NOT EXISTS salaries (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  nom            VARCHAR(100) NOT NULL,
  prenom         VARCHAR(100) NOT NULL,
  poste          VARCHAR(100),
  date_embauche  DATE,
  salaire        NUMERIC(10, 2),
  statut         VARCHAR(20) DEFAULT 'Actif',
  created_at     TIMESTAMP DEFAULT NOW(),
  presence       VARCHAR(20) DEFAULT 'Présent',
  avances        NUMERIC(10, 2) DEFAULT 0,
  conges         NUMERIC(10, 2) DEFAULT 0,
  -- Coordonnées personnelles du salarié, distinctes de l'email du compte de connexion (users.email).
  email          TEXT,
  telephone      TEXT,
  adresse        TEXT
);

-- ═══════════════ RH enrichie — historiques réels (présences/congés/avances),
-- en complément des champs plats ci-dessus (presence/avances/conges), volontairement
-- conservés tels quels pour ne rien casser côté formulaire employé existant.
CREATE TABLE IF NOT EXISTS salaries_presences (
  id          SERIAL PRIMARY KEY,
  salarie_id  INTEGER NOT NULL REFERENCES salaries(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  statut      TEXT NOT NULL DEFAULT 'Présent',
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (salarie_id, date)
);
CREATE INDEX IF NOT EXISTS idx_salaries_presences_salarie_id ON salaries_presences(salarie_id);

CREATE TABLE IF NOT EXISTS salaries_conges (
  id           SERIAL PRIMARY KEY,
  salarie_id   INTEGER NOT NULL REFERENCES salaries(id) ON DELETE CASCADE,
  date_debut   DATE NOT NULL,
  date_fin     DATE NOT NULL,
  motif        TEXT,
  statut       TEXT NOT NULL DEFAULT 'Demandé',
  decided_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salaries_conges_salarie_id ON salaries_conges(salarie_id);

CREATE TABLE IF NOT EXISTS salaries_avances (
  id          SERIAL PRIMARY KEY,
  salarie_id  INTEGER NOT NULL REFERENCES salaries(id) ON DELETE CASCADE,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  montant     NUMERIC(12, 2) NOT NULL,
  motif       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salaries_avances_salarie_id ON salaries_avances(salarie_id);

-- ═══════════════ RH complète — alignement sur le module RH open source de l'ERP ═══════════════
-- Ajout en 6 volets (voir CLAUDE.md section "RH complète") : structure organisationnelle
-- (départements/postes/manager), congés réellement décomptés (types + droits + solde +
-- jours fériés + congé approuvé => absence), fiche employé enrichie (photo, état civil,
-- départ), contrats (historise le salaire), coût main-d'œuvre + feuilles de temps.
-- Tout est additif : les tables/colonnes RH pré-existantes ne sont pas retirées.

-- ── Structure organisationnelle ──────────────────────────────
CREATE TABLE IF NOT EXISTS departements (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  nom            TEXT NOT NULL,
  responsable_id INTEGER REFERENCES salaries(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entreprise_id, nom)
);
CREATE INDEX IF NOT EXISTS idx_departements_entreprise_id ON departements(entreprise_id);

CREATE TABLE IF NOT EXISTS postes (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  intitule       TEXT NOT NULL,
  departement_id INTEGER REFERENCES departements(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entreprise_id, intitule)
);
CREATE INDEX IF NOT EXISTS idx_postes_entreprise_id ON postes(entreprise_id);

-- salaries.poste (texte libre) reste en place ; poste_id est la version référentielle,
-- remplie par migratePostesFromSalaries() plus bas à partir des intitulés distincts existants.
ALTER TABLE salaries ADD COLUMN IF NOT EXISTS poste_id       INTEGER REFERENCES postes(id) ON DELETE SET NULL;
ALTER TABLE salaries ADD COLUMN IF NOT EXISTS departement_id INTEGER REFERENCES departements(id) ON DELETE SET NULL;
-- manager_id : responsable hiérarchique direct. Hiérarchie à un seul niveau exploité côté
-- appli (validation des congés), garde-fou anti-auto-référence dans la route.
ALTER TABLE salaries ADD COLUMN IF NOT EXISTS manager_id     INTEGER REFERENCES salaries(id) ON DELETE SET NULL;

-- ── Fiche employé enrichie (état civil, contact d'urgence, départ, photo) ──
ALTER TABLE salaries ADD COLUMN IF NOT EXISTS photo                TEXT;   -- base64, comme contacts.photo (pas d'infra de fichiers)
ALTER TABLE salaries ADD COLUMN IF NOT EXISTS date_naissance       DATE;
ALTER TABLE salaries ADD COLUMN IF NOT EXISTS contact_urgence_nom  TEXT;
ALTER TABLE salaries ADD COLUMN IF NOT EXISTS contact_urgence_tel  TEXT;
ALTER TABLE salaries ADD COLUMN IF NOT EXISTS num_piece_identite   TEXT;
ALTER TABLE salaries ADD COLUMN IF NOT EXISTS date_depart          DATE;
ALTER TABLE salaries ADD COLUMN IF NOT EXISTS motif_depart         TEXT;

-- ── Coût main-d'œuvre + calendrier de travail simplifié ──────
ALTER TABLE salaries ADD COLUMN IF NOT EXISTS cout_horaire     NUMERIC(10, 2);
ALTER TABLE salaries ADD COLUMN IF NOT EXISTS heures_hebdo     NUMERIC(5, 2);
-- jours_travailles : liste CSV de jours ('Lun,Mar,Mer,Jeu,Ven,Sam'), sert au calcul du
-- nombre de jours ouvrés d'un congé quand renseigné (sinon repli : tous les jours sauf dimanche).
ALTER TABLE salaries ADD COLUMN IF NOT EXISTS jours_travailles TEXT;

-- ── Matériel affecté à un employé (le module Équipements existe déjà) ──
ALTER TABLE equipements ADD COLUMN IF NOT EXISTS salarie_id INTEGER REFERENCES salaries(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_equipements_salarie_id ON equipements(salarie_id);

-- ── Jours fériés par entreprise (aucune liste pré-remplie : appli multi-continents) ──
CREATE TABLE IF NOT EXISTS jours_feries (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  date           DATE NOT NULL,
  nom            TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entreprise_id, date)
);
CREATE INDEX IF NOT EXISTS idx_jours_feries_entreprise_id ON jours_feries(entreprise_id);

-- ── Congés : types + droits annuels + enrichissement des demandes ──
CREATE TABLE IF NOT EXISTS conges_types (
  id                 SERIAL PRIMARY KEY,
  entreprise_id      INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  nom                TEXT NOT NULL,
  paye               BOOLEAN NOT NULL DEFAULT TRUE,
  justificatif_requis BOOLEAN NOT NULL DEFAULT FALSE,
  couleur            TEXT,
  ordre              INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entreprise_id, nom)
);
CREATE INDEX IF NOT EXISTS idx_conges_types_entreprise_id ON conges_types(entreprise_id);

CREATE TABLE IF NOT EXISTS conges_droits (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  salarie_id     INTEGER NOT NULL REFERENCES salaries(id) ON DELETE CASCADE,
  type_id        INTEGER NOT NULL REFERENCES conges_types(id) ON DELETE CASCADE,
  annee          INTEGER NOT NULL,
  jours_alloues  NUMERIC(6, 2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (salarie_id, type_id, annee)
);
CREATE INDEX IF NOT EXISTS idx_conges_droits_salarie_id ON conges_droits(salarie_id);

ALTER TABLE salaries_conges ADD COLUMN IF NOT EXISTS type_id         INTEGER REFERENCES conges_types(id) ON DELETE SET NULL;
ALTER TABLE salaries_conges ADD COLUMN IF NOT EXISTS nb_jours        NUMERIC(6, 2);
ALTER TABLE salaries_conges ADD COLUMN IF NOT EXISTS demi_jour_debut BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE salaries_conges ADD COLUMN IF NOT EXISTS demi_jour_fin   BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Contrats : historise les termes (type, dates, période d'essai, salaire) ──
-- salaries.salaire reste la colonne lue partout ; elle est resynchronisée depuis le
-- contrat actif (routes/salaries.js). migrateContratsFromSalaries() amorce un contrat
-- 'CDI' par salarié existant ayant un salaire, pour ne pas partir d'un historique vide.
CREATE TABLE IF NOT EXISTS salaries_contrats (
  id                SERIAL PRIMARY KEY,
  entreprise_id     INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  salarie_id        INTEGER NOT NULL REFERENCES salaries(id) ON DELETE CASCADE,
  type              TEXT NOT NULL DEFAULT 'CDI',
  date_debut        DATE,
  date_fin          DATE,
  fin_periode_essai DATE,
  salaire           NUMERIC(12, 2),
  actif             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salaries_contrats_salarie_id ON salaries_contrats(salarie_id);

-- ── Feuilles de temps : heures imputables sur une parcelle / un poulailler ──
CREATE TABLE IF NOT EXISTS salaries_temps (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  salarie_id     INTEGER NOT NULL REFERENCES salaries(id) ON DELETE CASCADE,
  date           DATE NOT NULL,
  heures         NUMERIC(5, 2) NOT NULL,
  parcelle_id    INTEGER REFERENCES parcelles(id) ON DELETE SET NULL,
  poulailler_id  INTEGER REFERENCES poulaillers(id) ON DELETE SET NULL,
  tache          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salaries_temps_salarie_id ON salaries_temps(salarie_id);
CREATE INDEX IF NOT EXISTS idx_salaries_temps_date ON salaries_temps(entreprise_id, date);

-- ═══════════════ Localisation — devise + locale par entreprise (i18n / formats) ═══════════════
-- Première brique de l'internationalisation (appli visée sur tous les continents) : chaque
-- entreprise tient ses comptes dans UNE devise, et les montants/dates s'affichent selon SA
-- locale. Les colonnes de montants ne changent pas (pas de multi-devise comptable ici) —
-- devise/locale ne pilotent que l'affichage (Intl.NumberFormat/DateTimeFormat côté client).
-- La langue de l'UI est un choix par utilisateur (localStorage), distinct de ces deux-là.
-- Défauts XOF / fr-FR : valeurs de départ du projet, modifiables dans les réglages entreprise.
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS devise TEXT NOT NULL DEFAULT 'XOF';
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'fr-FR';

-- ═══════════════ Inscription : confirmation par email + profil entreprise étendu ═══════
-- email_confirme : DEFAULT TRUE pour ne jamais bloquer une entreprise déjà inscrite —
-- seule une inscription passée par le nouveau flux (voir routes/auth.js:register) démarre
-- à FALSE, le temps que le code reçu par email soit saisi (routes/auth.js:confirmer-
-- inscription). telephone/pays/numero_tva complètent adresse (déjà existante) pour
-- rapprocher le profil entreprise du modèle res.company d'un ERP de référence (pays pilote
-- entre autres le futur plan comptable localisé, pas encore branché).
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS email_confirme BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS telephone   TEXT;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS pays        TEXT;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS numero_tva  TEXT;

-- ═══════════════ Tarification par module (2026-09-06) ═══════════════════════════════
-- modules_actifs : jusqu'ici, quel module est « activé » n'existait QUE côté client
-- (localStorage, clé 'agriconnect-modules', voir App.jsx:toggleModule) — jamais persisté
-- côté serveur, jamais scopé par entreprise_id. Sans ça, impossible de calculer un prix
-- suggéré côté platform-admin (routes/billing.js) ou de l'afficher de façon fiable dans
-- ModulesScreen sur un autre appareil. DEFAULT '{}' : une entreprise déjà existante démarre
-- sans aucun module marqué actif côté serveur — la première ouverture de ModulesScreen après
-- cette migration doit re-synchroniser depuis le localStorage existant (fait côté frontend,
-- pas ici : migrate.js n'a pas accès au localStorage du navigateur).
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS modules_actifs JSONB NOT NULL DEFAULT '{}';

-- Blocage d'accès par module (2026-09-07, middleware/moduleGuard.js) : modules_actifs
-- devient exécutoire, plus seulement indicatif pour le prix — sans grand-père, TOUTE
-- entreprise déjà existante (modules_actifs = '{}' par défaut) perdrait d'un coup l'accès en
-- écriture à Cultures/Poulailler/Pisciculture/Contacts/Finances/etc. alors que rien n'était
-- bloqué avant ce chantier. modules_actifs_initialises distingue « jamais configuré, à
-- grand-périser » de « explicitement vidé par un vrai choix utilisateur » (ex. une entreprise
-- qui désactive ses 3 modules en pleine connaissance de cause doit RESTER vide au prochain
-- passage de migrate.js, pas se faire réinitialiser) — même besoin que trial_ends_at IS NULL
-- pour l'abonnement Phase 1, mais modules_actifs ne peut pas servir de proxy à lui seul
-- puisque {} est une valeur légitime après grand-père comme avant. Posée à TRUE par
-- routes/auth.js:register pour toute nouvelle inscription (qui démarre volontairement vide),
-- afin qu'un futur passage de migrate.js ne la re-grand-périse jamais par erreur.
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS modules_actifs_initialises BOOLEAN NOT NULL DEFAULT FALSE;

-- ═══════════════ Multi-devise réel, étape 1 : taux de change ═══════════════
-- Table de référence PLATEFORME (pas de entreprise_id : un taux de change n'appartient à
-- aucun locataire, il est le même pour tout le monde) — voir utils/currencyRates.js et
-- routes/devises.js. Taux stockés vs USD (pivot) plutôt qu'en N² paires : convertir(A, B)
-- calcule le cross-rate à la volée via taux_vs_usd(A)/taux_vs_usd(B). Alimentée
-- paresseusement (pas de cron dans ce projet) depuis l'API gratuite sans clé
-- open.er-api.com, une fois par jour.
CREATE TABLE IF NOT EXISTS currency_rates (
  id            SERIAL PRIMARY KEY,
  devise        TEXT NOT NULL,
  taux_vs_usd   NUMERIC(18, 8) NOT NULL,
  date          DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (devise, date)
);
CREATE INDEX IF NOT EXISTS idx_currency_rates_devise_date ON currency_rates(devise, date DESC);

-- Multi-devise réel, étape 2 : devis en devise étrangère (voir routes/devis.js pour la
-- résolution devise contact > devise entreprise). contacts.devise_facturation est ajoutée
-- plus bas, juste après la création de la table contacts qui n'existe pas encore à ce point
-- du script (même contrainte déjà rencontrée pour d'autres FK vers contacts).
--
-- devise/taux_change nullables : un devis existant (créé avant cette étape) est traité comme
-- étant dans la devise de l'entreprise avec un taux de 1 — pas de backfill nécessaire, la
-- résolution se fait à la lecture (COALESCE(devise, entreprise.devise)). taux_change =
-- combien vaut 1 unité de la devise du devis en devise de l'entreprise (multiplier le total
-- par ce taux donne l'équivalent en devise entreprise) — figé à la création puis à
-- l'envoi, jamais recalculé rétroactivement (même principe que le taux Odoo, voir journal).
ALTER TABLE devis ADD COLUMN IF NOT EXISTS devise TEXT;
ALTER TABLE devis ADD COLUMN IF NOT EXISTS taux_change NUMERIC(18, 8);

-- Multi-devise réel, étape 3 : la facture comptable (account_move) hérite désormais de la
-- devise/du taux du devis d'origine (voir routes/devis.js:facturer, utils/accountMove.js:
-- posterMove). Même conventions que Odoo, reprises telles quelles (voir journal) :
-- amount_untaxed/amount_tax/amount_total/amount_residual sur account_move restent dans la
-- devise DU DOCUMENT (comme devis.total) — aucun changement de sens pour une facture déjà
-- existante, toujours en devise entreprise. Seules les lignes comptables (account_move_line)
-- ont une double expression : debit/credit/balance/amount_residual restent la vérité
-- comptable, TOUJOURS en devise entreprise (intégrité du grand livre) ; amount_currency est
-- leur miroir en devise du document, purement informatif.
ALTER TABLE account_move ADD COLUMN IF NOT EXISTS devise TEXT;
ALTER TABLE account_move ADD COLUMN IF NOT EXISTS invoice_currency_rate NUMERIC(18, 8);
ALTER TABLE account_move_line ADD COLUMN IF NOT EXISTS amount_currency NUMERIC(16, 2);

-- Intégration météo (Open-Meteo, voir routes/meteo.js) — localisation par défaut de
-- l'entreprise. Nullable : fonctionnalité entièrement opt-in, aucun impact sur une entreprise
-- qui ne la configure jamais. Les parcelles peuvent avoir leur propre localisation (voir plus
-- bas, ALTER TABLE parcelles) qui prime sur celle-ci quand elle est renseignée.
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ville      TEXT;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS latitude   NUMERIC(9, 6);
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS longitude  NUMERIC(9, 6);

-- ═══════════════ Catalogue produit minimal — prix par défaut sur les articles de stock
-- déjà existants (pas de nouvelle table produits séparée : un article de stock EST déjà
-- un produit réutilisable, il ne lui manquait qu'un prix par défaut à préremplir dans
-- les formulaires Achats/Devis). Voir la section "Catalogue produit" de CLAUDE.md.
ALTER TABLE cultures_stocks ADD COLUMN IF NOT EXISTS prix_defaut NUMERIC(12, 2);
ALTER TABLE poulailler_stocks ADD COLUMN IF NOT EXISTS prix_defaut NUMERIC(12, 2);

-- ═══════════════ Rapprochement stock par identifiant + historique des mouvements ═══════════════
-- Le rapprochement stock↔achats/ventes se faisait uniquement par nom (insensible à la
-- casse) : une faute de frappe ou un renommage cassait silencieusement le lien. stock_id
-- (rempli automatiquement côté formulaire quand le produit tapé correspond exactement à
-- un article du catalogue) fiabilise le rapprochement ; le nom reste utilisé en repli pour
-- les lignes plus anciennes ou les produits non catalogués. Pas de contrainte FK stricte :
-- stock_id peut pointer vers cultures_stocks OU poulailler_stocks selon le module, deux
-- tables distinctes qu'une seule colonne ne peut pas référencer conditionnellement en SQL.
ALTER TABLE achats_lignes ADD COLUMN IF NOT EXISTS stock_id INTEGER;
ALTER TABLE devis_lignes ADD COLUMN IF NOT EXISTS stock_id INTEGER;
ALTER TABLE devis_lignes ADD COLUMN IF NOT EXISTS stock_module TEXT;

CREATE TABLE IF NOT EXISTS stock_mouvements (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  stock_module   TEXT NOT NULL,
  stock_id       INTEGER,
  stock_nom      TEXT NOT NULL,
  delta          NUMERIC(12, 2) NOT NULL,
  raison         TEXT NOT NULL,
  document_type  TEXT NOT NULL,
  document_id    INTEGER NOT NULL,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_mouvements_entreprise_id ON stock_mouvements(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_stock_mouvements_stock ON stock_mouvements(stock_module, stock_id);

-- ═══════════════ Cycle de vie des achats (Brouillon → Commandé → Reçu) ═══════════════
-- Jusqu'ici un achat était toujours "déjà arrivé" (créé = stock/finance synchronisés
-- immédiatement), contrairement aux devis qui ont un vrai cycle de vie. Le stock et la
-- finance ne se synchronisent désormais qu'au passage à "Reçu" (voir routes/achats.js).
-- DEFAULT 'Reçu' pour que les lignes déjà existantes (déjà synchronisées avant ce
-- changement) reflètent leur état réel — les nouvelles créations démarrent explicitement
-- en 'Brouillon' côté route, ce DEFAULT ne s'applique qu'aux lignes historiques.
ALTER TABLE achats_documents ADD COLUMN IF NOT EXISTS statut TEXT NOT NULL DEFAULT 'Reçu';
ALTER TABLE achats_documents ADD COLUMN IF NOT EXISTS date_reception TIMESTAMPTZ;

-- Référence lisible d'un achat (ACH-2026-0007), sur le modèle de devis.numero. Un achat
-- n'en avait aucune : la liste commençait par la date, et rien ne permettait de désigner
-- un achat précis — ni dans une conversation avec un fournisseur, ni dans un litige.
-- Nullable pour les lignes historiques, que le backfill juste en dessous renseigne.
ALTER TABLE achats_documents ADD COLUMN IF NOT EXISTS numero TEXT;

-- Numérote les achats déjà en base, par entreprise et par année de création, dans l'ordre
-- chronologique — sans quoi ils resteraient sans référence alors que les nouveaux en ont une.
UPDATE achats_documents ad
   SET numero = num.attendu
  FROM (
    SELECT id,
           'ACH-' || EXTRACT(YEAR FROM created_at)::INT || '-' ||
           LPAD(ROW_NUMBER() OVER (
             PARTITION BY entreprise_id, EXTRACT(YEAR FROM created_at)
             ORDER BY created_at, id
           )::TEXT, 4, '0') AS attendu
      FROM achats_documents
     WHERE numero IS NULL
  ) num
 WHERE ad.id = num.id AND ad.numero IS NULL;

-- Index partiel plutôt qu'une contrainte : les lignes sans numéro (aucune après le backfill,
-- mais la colonne reste nullable) ne doivent pas entrer en collision entre elles.
-- Cycle de vie d'un achat, séparé en deux axes comme dans l'ERP de référence (purchase.order :
-- "state" draft/sent/purchase/cancel d'un côté, "receipt_status" pending/partial/full de
-- l'autre). Jusqu'ici un seul champ mélangeait les deux : « Reçu » était à la fois un état de
-- commande et un constat de livraison, si bien que rien ne distinguait une commande confirmée
-- en attente de marchandise d'une commande jamais confirmée.
--
-- Les valeurs de statut restent en français capitalisé, comme devis.statut : « Brouillon » et
-- « Commandé » existent déjà en base et ne bougent pas, seul « Reçu » migre vers l'autre axe.
ALTER TABLE achats_documents ADD COLUMN IF NOT EXISTS etat_reception TEXT NOT NULL DEFAULT 'en_attente';

-- Reprise des lignes existantes AVANT de poser les contraintes, sans quoi « Reçu » les violerait.
UPDATE achats_documents SET etat_reception = 'recu', statut = 'Commandé'
 WHERE statut = 'Reçu';

ALTER TABLE achats_documents DROP CONSTRAINT IF EXISTS achats_documents_statut_check;
ALTER TABLE achats_documents ADD CONSTRAINT achats_documents_statut_check
  CHECK (statut IN ('Brouillon', 'Envoyée', 'Commandé', 'Annulée'));
ALTER TABLE achats_documents DROP CONSTRAINT IF EXISTS achats_documents_etat_reception_check;
ALTER TABLE achats_documents ADD CONSTRAINT achats_documents_etat_reception_check
  CHECK (etat_reception IN ('en_attente', 'partiel', 'recu'));

-- Le DEFAULT de statut valait « Reçu » (voir plus haut : les achats étaient réputés déjà
-- arrivés). Il n'a plus de sens sur l'axe commande.
ALTER TABLE achats_documents ALTER COLUMN statut SET DEFAULT 'Brouillon';

CREATE UNIQUE INDEX IF NOT EXISTS achats_documents_numero_unique
  ON achats_documents (entreprise_id, numero) WHERE numero IS NOT NULL;

-- Compteur dédié, par entreprise et par année. Déduire le numéro suivant des lignes existantes
-- — que ce soit par COUNT (ce que fait routes/devis.js) ou par MAX — réattribue la référence
-- d'un achat supprimé au suivant : deux pièces différentes finissent par porter le même numéro
-- dans l'historique d'un fournisseur. Un compteur qui n'est jamais décrémenté laisse un trou à
-- la place, ce qui est le comportement attendu d'une numérotation de pièces.
CREATE TABLE IF NOT EXISTS achats_numero_sequence (
  entreprise_id INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  annee INTEGER NOT NULL,
  dernier INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entreprise_id, annee)
);

-- Amorce le compteur au plus haut numéro déjà attribué par le backfill ci-dessus — sans quoi
-- la première création après migration repartirait de 0001 et heurterait l'index unique.
INSERT INTO achats_numero_sequence (entreprise_id, annee, dernier)
SELECT entreprise_id,
       EXTRACT(YEAR FROM created_at)::INT AS annee,
       MAX(NULLIF(regexp_replace(numero, '^.*-', ''), '')::INT) AS dernier
  FROM achats_documents
 WHERE numero IS NOT NULL
 GROUP BY entreprise_id, EXTRACT(YEAR FROM created_at)
ON CONFLICT (entreprise_id, annee)
DO UPDATE SET dernier = GREATEST(achats_numero_sequence.dernier, EXCLUDED.dernier);

-- ═══════════════ Produits unifiés (fusion cultures_stocks / poulailler_stocks) ═══════════════
-- Remplace les deux tables stocks séparées par une seule table produits + une vraie ressource
-- de catégories par entreprise (au lieu du texte libre non validé qu'était categorie). Voir
-- mergeStocksIntoProduits() plus bas pour la fusion effective des données existantes et le
-- repointage des tables qui référençaient cultures_stocks/poulailler_stocks par stock_id.
CREATE TABLE IF NOT EXISTS produit_categories (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  module         TEXT NOT NULL CHECK (module IN ('Cultures', 'Poulailler')),
  nom            TEXT NOT NULL,
  ordre          INTEGER NOT NULL DEFAULT 0,
  UNIQUE (entreprise_id, module, nom)
);
CREATE INDEX IF NOT EXISTS idx_produit_categories_entreprise_id ON produit_categories(entreprise_id);
-- Hiérarchie de catégories (étape 0 de l'alignement Odoo produit/stock, 2026-09-03) —
-- équivalent de product.category.parent_id. ON DELETE CASCADE (pas SET NULL comme
-- contacts.parent_id juste au-dessus) : supprimer une catégorie parente doit supprimer
-- ses enfants, cohérent avec le comportement réel de product.category. Le cloisonnement
-- par module est conservé (validé côté route, pas en CHECK — Postgres ne peut pas comparer
-- deux lignes dans un CHECK) : un parent doit être du même module que son enfant.
ALTER TABLE produit_categories ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES produit_categories(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_produit_categories_parent_id ON produit_categories(parent_id);

CREATE TABLE IF NOT EXISTS produits (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  module         TEXT NOT NULL CHECK (module IN ('Cultures', 'Poulailler')),
  nom            TEXT NOT NULL,
  categorie_id   INTEGER NOT NULL REFERENCES produit_categories(id),
  quantite       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  unite          TEXT,
  seuil          NUMERIC(12, 2) NOT NULL DEFAULT 0,
  prix_defaut    NUMERIC(12, 2),
  cout           NUMERIC(12, 2),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Provenance de la fusion (cultures_stocks/poulailler_stocks + ancien id) : sert à la fois
  -- de trace d'audit et de clé de correspondance pour repointer achats_lignes/devis_lignes/
  -- stock_mouvements/client_prix vers les nouveaux ids en une seule passe. NULL pour tout
  -- produit créé après la fusion.
  legacy_table   TEXT,
  legacy_id      INTEGER,
  UNIQUE (legacy_table, legacy_id)
);
CREATE INDEX IF NOT EXISTS idx_produits_entreprise_id ON produits(entreprise_id);
-- cout : coût de revient de l'article, optionnel — sert uniquement au calcul de marge
-- affiché sur un devis (total − Σ quantité×coût des lignes liées à un article). Ajouté après
-- coup (colonne absente de la table produits déjà en production), d'où l'ALTER séparé plutôt
-- que de compter sur le CREATE TABLE ci-dessus, qui ne s'applique qu'à une base neuve.
ALTER TABLE produits ADD COLUMN IF NOT EXISTS cout NUMERIC(12, 2);

-- ═══════════════ Étape 1 alignement Odoo produit/stock (2026-09-03) : référentiel d'unités de mesure ═══════════════
-- Équivalent uom.category / uom.uom, mais scopé par entreprise (comme tout le reste de ce
-- projet — pas de référentiel global partagé entre entreprises, contrairement à Odoo).
-- « facteur » : combien d'unités de référence de sa catégorie pour 1 unité de cette ligne
-- (ex. catégorie Poids, référence kg : g → facteur 0.001, tonne → facteur 1000). Convention
-- volontairement plus simple que le facteur/facteur_inv à double sens d'Odoo (bigger/smaller) —
-- un seul nombre, une seule direction, moins d'ambiguïté pour le même résultat de conversion.
CREATE TABLE IF NOT EXISTS unites_mesure_categories (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  nom            TEXT NOT NULL,
  UNIQUE (entreprise_id, nom)
);
CREATE INDEX IF NOT EXISTS idx_unites_mesure_categories_entreprise_id ON unites_mesure_categories(entreprise_id);

CREATE TABLE IF NOT EXISTS unites_mesure (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  categorie_id   INTEGER NOT NULL REFERENCES unites_mesure_categories(id) ON DELETE CASCADE,
  nom            TEXT NOT NULL,
  symbole        TEXT,
  facteur        NUMERIC(14, 6) NOT NULL DEFAULT 1,
  est_reference  BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (entreprise_id, categorie_id, nom)
);
CREATE INDEX IF NOT EXISTS idx_unites_mesure_entreprise_id ON unites_mesure(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_unites_mesure_categorie_id ON unites_mesure(categorie_id);

-- produits.unite (TEXT libre) reste en place comme cache d'affichage dénormalisé — synchronisé
-- depuis unites_mesure.symbole/nom à chaque fois que unite_id est renseigné côté route, plutôt
-- que retiré d'un coup (même logique de « colonne pont » que produits.quantite prévue à
-- l'étape 3 du plan : ça évite de réécrire d'un coup tous les lecteurs existants de .unite).
ALTER TABLE produits ADD COLUMN IF NOT EXISTS unite_id INTEGER REFERENCES unites_mesure(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_produits_unite_id ON produits(unite_id);

-- uom_id par ligne (achat/devis) : optionnel, sert uniquement à la conversion dans stockSync.js
-- quand l'unité de la ligne diffère de celle du produit — pas un champ visible/éditable dans le
-- formulaire de ligne, auto-rempli comme stockId l'est déjà à la sélection d'un article.
ALTER TABLE achats_lignes ADD COLUMN IF NOT EXISTS uom_id INTEGER REFERENCES unites_mesure(id) ON DELETE SET NULL;
ALTER TABLE devis_lignes ADD COLUMN IF NOT EXISTS uom_id INTEGER REFERENCES unites_mesure(id) ON DELETE SET NULL;

-- ═══════════════ Étape 2 alignement Odoo produit/stock (2026-09-04) : gabarit/variante + attributs ═══════════════
-- Équivalent product.template / product.product / product.attribute / product.attribute.value.
-- produits devient la variante (product.product) : gagne template_id, un gabarit (product.
-- template) portant le nom/catégorie/description communs. Un article créé via le formulaire
-- "Ajout rapide" de StocksTab (inchangé) se voit créer un gabarit à variante unique en silence
-- côté route (voir routes/produits.js) — comme dans un ERP de référence, un product.product
-- n'existe jamais sans product.template, même quand personne ne gère de variantes.
CREATE TABLE IF NOT EXISTS produit_templates (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  module         TEXT NOT NULL CHECK (module IN ('Cultures', 'Poulailler')),
  nom            TEXT NOT NULL,
  categorie_id   INTEGER REFERENCES produit_categories(id) ON DELETE SET NULL,
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_produit_templates_entreprise_id ON produit_templates(entreprise_id);

ALTER TABLE produits ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES produit_templates(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_produits_template_id ON produits(template_id);

-- Attributs réutilisables (product.attribute), scopés par entreprise seulement — contrairement
-- à produit_categories/unites_mesure_categories, pas de cloisonnement par module : un attribut
-- comme « Calibre » peut aussi bien s'appliquer à un article Cultures qu'à un article Poulailler.
CREATE TABLE IF NOT EXISTS attributs_produit (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  nom            TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entreprise_id, nom)
);
CREATE INDEX IF NOT EXISTS idx_attributs_produit_entreprise_id ON attributs_produit(entreprise_id);

CREATE TABLE IF NOT EXISTS attributs_produit_valeurs (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  attribut_id    INTEGER NOT NULL REFERENCES attributs_produit(id) ON DELETE CASCADE,
  valeur         TEXT NOT NULL,
  ordre          INTEGER NOT NULL DEFAULT 0,
  UNIQUE (attribut_id, valeur)
);
CREATE INDEX IF NOT EXISTS idx_attributs_produit_valeurs_entreprise_id ON attributs_produit_valeurs(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_attributs_produit_valeurs_attribut_id ON attributs_produit_valeurs(attribut_id);

-- Quelles valeurs d'attribut un gabarit propose pour générer ses variantes (product.template.
-- attribute.line simplifié : pas de product.template.attribute.value séparé, attribut_id
-- dénormalisé pour éviter un join supplémentaire à la lecture — dérivable de valeur_id via
-- attributs_produit_valeurs.attribut_id sinon).
CREATE TABLE IF NOT EXISTS gabarit_attributs_lignes (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  template_id    INTEGER NOT NULL REFERENCES produit_templates(id) ON DELETE CASCADE,
  attribut_id    INTEGER NOT NULL REFERENCES attributs_produit(id) ON DELETE CASCADE,
  valeur_id      INTEGER NOT NULL REFERENCES attributs_produit_valeurs(id) ON DELETE CASCADE,
  UNIQUE (template_id, valeur_id)
);
CREATE INDEX IF NOT EXISTS idx_gabarit_attributs_lignes_entreprise_id ON gabarit_attributs_lignes(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_gabarit_attributs_lignes_template_id ON gabarit_attributs_lignes(template_id);

-- Quelle combinaison de valeurs identifie chaque variante (product.product ↔ ses attribute
-- values, simplifié en pointant directement les valeurs plutôt qu'un ptav intermédiaire).
CREATE TABLE IF NOT EXISTS variante_attributs_valeurs (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  produit_id     INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  valeur_id      INTEGER NOT NULL REFERENCES attributs_produit_valeurs(id) ON DELETE CASCADE,
  UNIQUE (produit_id, valeur_id)
);
CREATE INDEX IF NOT EXISTS idx_variante_attributs_valeurs_entreprise_id ON variante_attributs_valeurs(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_variante_attributs_valeurs_produit_id ON variante_attributs_valeurs(produit_id);

-- ═══════════════ Étape 3 alignement Odoo produit/stock (2026-09-04) : moteur multi-emplacements ═══════════════
-- Équivalent stock.location / stock.quant / stock.move. Un seul emplacement interne réel par
-- entreprise (pas de multi-entrepôt dans cette version) + trois emplacements virtuels
-- (Clients/Fournisseurs/Pertes) servant uniquement de source/destination dans stock_moves —
-- AUCUN quant n'est jamais suivi à leur niveau, voir utils/stockSync.js. Hiérarchique (parent_id,
-- ON DELETE CASCADE) comme produit_categories/unites_mesure_categories, bien qu'aucune UI
-- n'exploite encore de sous-emplacement — cohérence de modèle, pas gadget.
CREATE TABLE IF NOT EXISTS emplacements_stock (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  nom            TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('interne', 'client', 'fournisseur', 'perte')),
  parent_id      INTEGER REFERENCES emplacements_stock(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entreprise_id, nom)
);
CREATE INDEX IF NOT EXISTS idx_emplacements_stock_entreprise_id ON emplacements_stock(entreprise_id);

-- Transferts entre emplacements (2026-09-10) : dès qu'une entreprise peut créer un second
-- emplacement interne, « l'emplacement interne » ne veut plus rien dire. Sans ce drapeau,
-- stockSync.js:resoudreEmplacements prendrait celui que la requête renvoie en premier — une
-- réception d'achat atterrirait dans un emplacement au hasard, sans erreur ni trace. Un seul
-- défaut par entreprise, garanti par l'index unique partiel plutôt que par du code applicatif.
ALTER TABLE emplacements_stock ADD COLUMN IF NOT EXISTS par_defaut BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_emplacements_stock_defaut_unique
  ON emplacements_stock(entreprise_id) WHERE par_defaut;

-- « Combien il y a où » — un seul quant par (produit, emplacement) : pas de dimension lot_id
-- ici (contrairement à stock.quant réel), stockSync.js ne consomme jamais un lot précis — le
-- suivi de lot (stock_lots, étape B élargissement stock) reste un registre parallèle
-- indépendant. quantite_reservee : part de quantite déjà engagée par un devis signé mais pas
-- encore remis en brouillon (voir stockSync.js) — quantite - quantite_reservee = disponible,
-- c'est cette valeur que produits.quantite (colonne pont dénormalisée) reflète désormais.
CREATE TABLE IF NOT EXISTS stock_quants (
  id                 SERIAL PRIMARY KEY,
  entreprise_id      INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  produit_id         INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  emplacement_id     INTEGER NOT NULL REFERENCES emplacements_stock(id) ON DELETE CASCADE,
  quantite           NUMERIC(14, 3) NOT NULL DEFAULT 0,
  quantite_reservee  NUMERIC(14, 3) NOT NULL DEFAULT 0,
  UNIQUE (produit_id, emplacement_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_quants_entreprise_id ON stock_quants(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_stock_quants_produit_id ON stock_quants(produit_id);

-- Journal structuré des mouvements (remplace conceptuellement stock_mouvements comme source de
-- vérité sous-jacente, mais NE LE remplace PAS dans le code : stock_mouvements reste le ledger
-- d'audit simple existant, alimenté en parallèle, voir stockSync.js). state reflète le cycle de
-- vie réel d'un mouvement — 'confirme' = réservation active (devis signé), 'fait' = mouvement
-- physique définitif (achat reçu, consommation d'intrant), 'annule' = réservation libérée ou
-- réception annulée. Référence polymorphe (document_type/document_id) vers le document
-- d'origine, comme stock_mouvements.
CREATE TABLE IF NOT EXISTS stock_moves (
  id                     SERIAL PRIMARY KEY,
  entreprise_id          INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id                INTEGER REFERENCES users(id) ON DELETE SET NULL,
  produit_id             INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  quantite               NUMERIC(14, 3) NOT NULL,
  emplacement_source_id  INTEGER NOT NULL REFERENCES emplacements_stock(id),
  emplacement_dest_id    INTEGER NOT NULL REFERENCES emplacements_stock(id),
  state                  TEXT NOT NULL DEFAULT 'brouillon' CHECK (state IN ('brouillon', 'confirme', 'fait', 'annule')),
  document_type          TEXT,
  document_id            INTEGER,
  raison                 TEXT,
  date_fait              TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_moves_entreprise_id ON stock_moves(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_stock_moves_produit_id ON stock_moves(produit_id);
CREATE INDEX IF NOT EXISTS idx_stock_moves_document ON stock_moves(document_type, document_id);

-- ═══════════════ Étape A « élargissement stock » (2026-09-01) : typologie des intrants + fiches enrichies ═══════════════
-- Modèle de champs adapté de LiteFarm (tables product / soil_amendment_product : enum de
-- type produit, NPK n/p/k + unité, dose, liste des substances autorisées) + champs propres
-- au registre des traitements phytosanitaires français (n° AMM, DAR = délai avant récolte,
-- ZNT), qu'aucun projet open-source ne modélise. Tout en colonnes plates sur produits — un
-- article de stock EST déjà l'intrant, pas de table séparée (même choix que la fusion 2026-08-18).
ALTER TABLE produits ADD COLUMN IF NOT EXISTS type_intrant TEXT;
ALTER TABLE produits DROP CONSTRAINT IF EXISTS produits_type_intrant_check;
ALTER TABLE produits ADD CONSTRAINT produits_type_intrant_check
  CHECK (type_intrant IS NULL OR type_intrant IN ('semence', 'engrais', 'phytosanitaire', 'aliment', 'materiel', 'autre'));
-- semence
ALTER TABLE produits ADD COLUMN IF NOT EXISTS variete TEXT;
ALTER TABLE produits ADD COLUMN IF NOT EXISTS taux_germination NUMERIC(5, 2);
-- engrais (NPK, modèle LiteFarm)
ALTER TABLE produits ADD COLUMN IF NOT EXISTS npk_n NUMERIC(6, 3);
ALTER TABLE produits ADD COLUMN IF NOT EXISTS npk_p NUMERIC(6, 3);
ALTER TABLE produits ADD COLUMN IF NOT EXISTS npk_k NUMERIC(6, 3);
ALTER TABLE produits ADD COLUMN IF NOT EXISTS npk_unit TEXT;
ALTER TABLE produits ADD COLUMN IF NOT EXISTS dose_ha NUMERIC(10, 2);
ALTER TABLE produits ADD COLUMN IF NOT EXISTS dose_ha_unite TEXT;
ALTER TABLE produits DROP CONSTRAINT IF EXISTS produits_npk_unit_check;
ALTER TABLE produits ADD CONSTRAINT produits_npk_unit_check
  CHECK (npk_unit IS NULL OR npk_unit IN ('percent', 'ratio'));
ALTER TABLE produits DROP CONSTRAINT IF EXISTS produits_npk_coherence_check;
ALTER TABLE produits ADD CONSTRAINT produits_npk_coherence_check
  CHECK (
    (COALESCE(npk_n, npk_p, npk_k) IS NULL AND npk_unit IS NULL)
    OR (COALESCE(npk_n, npk_p, npk_k) IS NOT NULL AND npk_unit IS NOT NULL)
  );
ALTER TABLE produits DROP CONSTRAINT IF EXISTS produits_npk_percent_check;
ALTER TABLE produits ADD CONSTRAINT produits_npk_percent_check
  CHECK (npk_unit <> 'percent' OR (COALESCE(npk_n, 0) + COALESCE(npk_p, 0) + COALESCE(npk_k, 0)) <= 100);
-- phytosanitaire (registre des traitements — obligations FR/UE)
ALTER TABLE produits ADD COLUMN IF NOT EXISTS matiere_active TEXT;
ALTER TABLE produits ADD COLUMN IF NOT EXISTS numero_amm TEXT;
ALTER TABLE produits ADD COLUMN IF NOT EXISTS dar_jours INTEGER;
ALTER TABLE produits ADD COLUMN IF NOT EXISTS znt_metres NUMERIC(6, 1);
-- tout intrant : utilisable en agriculture biologique (liste des substances autorisées)
ALTER TABLE produits ADD COLUMN IF NOT EXISTS bio_autorise BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill du type depuis le nom de la catégorie — idempotent (ne touche que les NULL).
UPDATE produits p SET type_intrant = CASE pc.nom
    WHEN 'Semences' THEN 'semence'
    WHEN 'Engrais' THEN 'engrais'
    WHEN 'Produits phytosanitaires' THEN 'phytosanitaire'
    WHEN 'Aliment' THEN 'aliment'
    ELSE NULL END
  FROM produit_categories pc
  WHERE pc.id = p.categorie_id AND p.type_intrant IS NULL
    AND pc.nom IN ('Semences', 'Engrais', 'Produits phytosanitaires', 'Aliment');

-- Étape B « élargissement stock » : suivi de lot + péremption. Registre parallèle,
-- INDÉPENDANT de produits.quantite (qui reste la source de vérité du stock global) — un lot
-- trace un batch entrant (n° de lot, date de péremption, coût unitaire, provenance achat).
-- La consommation FIFO/lot-à-lot est volontairement hors périmètre ici (voir la note
-- "Traçabilité" de CLAUDE.md sur le choix de ne pas construire un vrai suivi de lots complet).
-- achat_id n'a pas de FK stricte, comme stock_id ailleurs (traçabilité indicative).
CREATE TABLE IF NOT EXISTS stock_lots (
  id                SERIAL PRIMARY KEY,
  entreprise_id     INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  produit_id        INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  numero_lot        TEXT NOT NULL,
  date_entree       DATE NOT NULL DEFAULT CURRENT_DATE,
  date_peremption   DATE,
  quantite_initiale NUMERIC(12, 2) NOT NULL DEFAULT 0,
  quantite_restante NUMERIC(12, 2) NOT NULL DEFAULT 0,
  cout_unitaire     NUMERIC(12, 2),
  achat_id          INTEGER,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_lots_entreprise_id ON stock_lots(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_stock_lots_produit_id ON stock_lots(produit_id);
CREATE INDEX IF NOT EXISTS idx_stock_lots_peremption ON stock_lots(entreprise_id, date_peremption);

-- Étape C « élargissement stock » : registre des traitements phytosanitaires / apports
-- d'intrants (obligation FR/UE). Journal append-only : quelle parcelle a reçu quel produit,
-- à quelle dose, quand, par qui, avec le DAR calculé (date_application + produit.dar_jours
-- figé à la saisie) et le respect de la ZNT. Champ cible ≈ pest_control_task.pest_target de
-- LiteFarm. FK ON DELETE SET NULL : l'entrée du registre survit à la suppression d'une
-- parcelle / d'un produit (une pièce réglementaire doit persister).
CREATE TABLE IF NOT EXISTS applications_intrants (
  id                 SERIAL PRIMARY KEY,
  entreprise_id      INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  parcelle_id        INTEGER REFERENCES parcelles(id) ON DELETE SET NULL,
  produit_id         INTEGER REFERENCES produits(id) ON DELETE SET NULL,
  lot_id             INTEGER REFERENCES stock_lots(id) ON DELETE SET NULL,
  produit_nom        TEXT,
  parcelle_nom       TEXT,
  date_application   DATE NOT NULL DEFAULT CURRENT_DATE,
  dose               NUMERIC(12, 3),
  dose_unite         TEXT,
  surface_traitee_ha NUMERIC(10, 2),
  quantite_utilisee  NUMERIC(12, 2),
  operateur          TEXT,
  cible              TEXT,
  dar_calcule        DATE,
  znt_respectee      BOOLEAN,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_applications_intrants_entreprise_id ON applications_intrants(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_applications_intrants_parcelle_id ON applications_intrants(parcelle_id);

-- ═══════════════ Transformation agroalimentaire, étape 1 : recettes (mrp.bom-like) ═══════════════
-- Backlog long terme, jamais commencé jusqu'ici. Un produit transformé (fromage, confiture,
-- filets fumés...) est un produit catalogué comme un autre (module Cultures/Poulailler/
-- Pisciculture existant, aucun 4e module nécessaire) ; une recette décrit juste, pour ce
-- produit de sortie, quels ingrédients (autres produits) et en quelle quantité. quantite_produite
-- = le lot de référence de la recette (« pour produire quantite_produite unités, il faut
-- ligne.quantite de ligne.produit_id ») — l'étape 2 (ordres de transformation, différée)
-- multipliera par le facteur réellement demandé, comme mrp.bom.product_qty côté ERP de référence.
CREATE TABLE IF NOT EXISTS produit_recettes (
  id                 SERIAL PRIMARY KEY,
  entreprise_id      INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  produit_sortie_id  INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  nom                TEXT NOT NULL,
  quantite_produite  NUMERIC(12, 2) NOT NULL DEFAULT 1,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_produit_recettes_entreprise_id ON produit_recettes(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_produit_recettes_produit_sortie_id ON produit_recettes(produit_sortie_id);

-- ON DELETE RESTRICT (pas CASCADE comme produit_sortie_id ci-dessus) : un ingrédient encore
-- référencé par une recette ne doit pas disparaître silencieusement à la suppression du
-- produit — cohérent avec la 23503 déjà en place sur produit_categories.
CREATE TABLE IF NOT EXISTS produit_recettes_lignes (
  id           SERIAL PRIMARY KEY,
  recette_id   INTEGER NOT NULL REFERENCES produit_recettes(id) ON DELETE CASCADE,
  produit_id   INTEGER NOT NULL REFERENCES produits(id) ON DELETE RESTRICT,
  quantite     NUMERIC(12, 3) NOT NULL,
  notes        TEXT
);
CREATE INDEX IF NOT EXISTS idx_produit_recettes_lignes_recette_id ON produit_recettes_lignes(recette_id);

-- ═══════════════ Transformation agroalimentaire, étape 2 : ordres de transformation ═══════════════
-- Exécute réellement une recette (produit_recettes ci-dessus) : consomme les ingrédients et
-- produit l'article fini via un nouvel emplacement virtuel « production » (voir plus bas,
-- extension du CHECK emplacements_stock.type, et stockSync.js pour les mouvements). Snapshot
-- textuel (recette_nom/produit_sortie_nom/numero_lot_sortie) à côté des FK nullable ON DELETE
-- SET NULL — même patron que applications_intrants (produit_nom/parcelle_nom) : une pièce
-- réglementaire de traçabilité doit survivre à la suppression de la recette/du produit en amont.
ALTER TABLE emplacements_stock DROP CONSTRAINT IF EXISTS emplacements_stock_type_check;
ALTER TABLE emplacements_stock ADD CONSTRAINT emplacements_stock_type_check
  CHECK (type IN ('interne', 'client', 'fournisseur', 'perte', 'production', 'inventaire'));

CREATE TABLE IF NOT EXISTS ordres_transformation (
  id                  SERIAL PRIMARY KEY,
  entreprise_id       INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recette_id          INTEGER REFERENCES produit_recettes(id) ON DELETE SET NULL,
  recette_nom         TEXT,
  produit_sortie_id   INTEGER REFERENCES produits(id) ON DELETE SET NULL,
  produit_sortie_nom  TEXT,
  quantite_produite   NUMERIC(12, 2) NOT NULL,
  lot_sortie_id       INTEGER REFERENCES stock_lots(id) ON DELETE SET NULL,
  numero_lot_sortie   TEXT,
  date_transformation DATE NOT NULL DEFAULT CURRENT_DATE,
  operateur           TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ordres_transformation_entreprise_id ON ordres_transformation(entreprise_id);

-- Snapshot de ce qui a réellement été consommé (peut différer de la recette si elle a changé
-- depuis) — nécessaire pour un DELETE (annulation) fidèle, jamais recalculé depuis la recette.
CREATE TABLE IF NOT EXISTS ordres_transformation_lignes (
  id                  SERIAL PRIMARY KEY,
  ordre_id            INTEGER NOT NULL REFERENCES ordres_transformation(id) ON DELETE CASCADE,
  produit_id          INTEGER REFERENCES produits(id) ON DELETE SET NULL,
  produit_nom         TEXT,
  quantite_consommee  NUMERIC(12, 3) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ordres_transformation_lignes_ordre_id ON ordres_transformation_lignes(ordre_id);

-- Tags légers (Option 1, pas de vraie déplétion FIFO — même choix que la traçabilité
-- parcelle→vente) : quels lots de matière première ont été utilisés, à titre indicatif.
CREATE TABLE IF NOT EXISTS ordres_transformation_lots_entrants (
  id          SERIAL PRIMARY KEY,
  ordre_id    INTEGER NOT NULL REFERENCES ordres_transformation(id) ON DELETE CASCADE,
  lot_id      INTEGER REFERENCES stock_lots(id) ON DELETE SET NULL,
  numero_lot  TEXT
);
CREATE INDEX IF NOT EXISTS idx_ordres_transformation_lots_entrants_ordre_id ON ordres_transformation_lots_entrants(ordre_id);

-- ═══════════════ Transformation agroalimentaire, étape 3 : registre HACCP ═══════════════
-- Points de contrôle sanitaires liés à un ordre de transformation (étape 2 ci-dessus) — conçu
-- sur mesure, aucun module Quality/HACCP dans la source ERP de référence (Enterprise-only côté
-- Odoo). Journal append-only, même patron que applications_intrants (registre phytosanitaire,
-- étape C élargissement stock) : FK nullable ON DELETE SET NULL + snapshot texte
-- (ordre_transformation_nom) pour qu'une pièce réglementaire survive à la suppression de
-- l'ordre en amont. type_controle en CHECK fixe (pas de référentiel séparé, périmètre minimal
-- volontaire) ; conforme est saisi explicitement (pas recalculé serveur depuis les seuils —
-- un contrôle « hygiène » n'a souvent pas de valeur numérique à comparer).
CREATE TABLE IF NOT EXISTS haccp_controles (
  id                       SERIAL PRIMARY KEY,
  entreprise_id            INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ordre_transformation_id  INTEGER REFERENCES ordres_transformation(id) ON DELETE SET NULL,
  ordre_transformation_nom TEXT,
  type_controle            TEXT NOT NULL CHECK (type_controle IN ('temperature', 'hygiene', 'tracabilite', 'autre')),
  valeur_mesuree           NUMERIC(10, 2),
  unite                    TEXT,
  seuil_min                NUMERIC(10, 2),
  seuil_max                NUMERIC(10, 2),
  conforme                 BOOLEAN NOT NULL DEFAULT TRUE,
  action_corrective        TEXT,
  date_controle            DATE NOT NULL DEFAULT CURRENT_DATE,
  operateur                TEXT,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_haccp_controles_entreprise_id ON haccp_controles(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_haccp_controles_ordre_id ON haccp_controles(ordre_transformation_id);

-- ═══════════════ Listes de prix nommées et réutilisables (remplace client_prix) ═══════════════
-- Troisième étape de l'alignement structurel ERP : remplace le prix négocié client+article
-- (client_prix, une ligne = un override non réutilisable) par un objet nommé, réutilisable,
-- assignable à plusieurs contacts à la fois — comme le champ "Liste de prix" d'une commande dans un ERP de référence. Toujours en complément du prix par défaut de l'article, jamais à la place : un contact
-- sans liste assignée (contacts.liste_prix_id NULL, colonne ajoutée plus bas) continue
-- d'utiliser prix_defaut. Pas de stock_module ici (contrairement à l'ancienne client_prix,
-- conçue avant la fusion produits) — stock_id seul est non-ambigu depuis cette fusion.
CREATE TABLE IF NOT EXISTS listes_prix (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  nom            TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entreprise_id, nom)
);
CREATE INDEX IF NOT EXISTS idx_listes_prix_entreprise_id ON listes_prix(entreprise_id);

CREATE TABLE IF NOT EXISTS listes_prix_lignes (
  id             SERIAL PRIMARY KEY,
  liste_prix_id  INTEGER NOT NULL REFERENCES listes_prix(id) ON DELETE CASCADE,
  stock_id       INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  prix           NUMERIC(12, 2) NOT NULL,
  UNIQUE (liste_prix_id, stock_id)
);
CREATE INDEX IF NOT EXISTS idx_listes_prix_lignes_liste_prix_id ON listes_prix_lignes(liste_prix_id);

-- ═══════════════ Étape 4 alignement Odoo produit/stock (2026-09-04) : moteur de règles de tarification ═══════════════
-- listes_prix_lignes devient un vrai moteur de règles (product.pricelist.item-like) au lieu
-- d'un prix fixe par (liste, variante). stock_id redevient optionnel : une règle 'categorie'/
-- 'gabarit'/'global' ne cible pas une variante précise — la contrainte de cohérence plus bas
-- impose qu'exactement la bonne colonne cible soit renseignée selon applied_on. L'ancienne
-- contrainte UNIQUE(liste_prix_id, stock_id) est retirée : plusieurs règles peuvent désormais
-- cibler la même variante avec des paliers de quantité différents (ex. -10% dès 10, -20% dès
-- 50). Toute ligne déjà existante reste implicitement applied_on='variante'/compute_price=
-- 'fixe'/quantite_min=0/sans fenêtre de date via les DEFAULT ci-dessous — comportement
-- rigoureusement identique à avant cette étape, aucune migration de données nécessaire.
ALTER TABLE listes_prix_lignes DROP CONSTRAINT IF EXISTS listes_prix_lignes_liste_prix_id_stock_id_key;
ALTER TABLE listes_prix_lignes ALTER COLUMN stock_id DROP NOT NULL;
ALTER TABLE listes_prix_lignes ALTER COLUMN prix DROP NOT NULL;
ALTER TABLE listes_prix_lignes ADD COLUMN IF NOT EXISTS applied_on TEXT NOT NULL DEFAULT 'variante';
ALTER TABLE listes_prix_lignes ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES produit_templates(id) ON DELETE CASCADE;
ALTER TABLE listes_prix_lignes ADD COLUMN IF NOT EXISTS categorie_id INTEGER REFERENCES produit_categories(id) ON DELETE CASCADE;
-- compute_price='formule' calcule identiquement à 'pourcentage' dans cette version (formule
-- simplifiée : base + ajustement %, voir utils/pricelistResolver.js) — conservé comme valeur
-- distincte uniquement pour coller au nom du champ Odoo, pas de logique de marge/arrondi.
ALTER TABLE listes_prix_lignes ADD COLUMN IF NOT EXISTS compute_price TEXT NOT NULL DEFAULT 'fixe';
ALTER TABLE listes_prix_lignes ADD COLUMN IF NOT EXISTS pourcentage NUMERIC(7, 3);
ALTER TABLE listes_prix_lignes ADD COLUMN IF NOT EXISTS quantite_min NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE listes_prix_lignes ADD COLUMN IF NOT EXISTS date_debut DATE;
ALTER TABLE listes_prix_lignes ADD COLUMN IF NOT EXISTS date_fin DATE;
ALTER TABLE listes_prix_lignes DROP CONSTRAINT IF EXISTS listes_prix_lignes_applied_on_check;
ALTER TABLE listes_prix_lignes ADD CONSTRAINT listes_prix_lignes_applied_on_check
  CHECK (applied_on IN ('global', 'categorie', 'gabarit', 'variante'));
ALTER TABLE listes_prix_lignes DROP CONSTRAINT IF EXISTS listes_prix_lignes_compute_price_check;
ALTER TABLE listes_prix_lignes ADD CONSTRAINT listes_prix_lignes_compute_price_check
  CHECK (compute_price IN ('fixe', 'pourcentage', 'formule'));
ALTER TABLE listes_prix_lignes DROP CONSTRAINT IF EXISTS listes_prix_lignes_cible_coherente_check;
ALTER TABLE listes_prix_lignes ADD CONSTRAINT listes_prix_lignes_cible_coherente_check
  CHECK (
    (applied_on = 'global' AND stock_id IS NULL AND template_id IS NULL AND categorie_id IS NULL) OR
    (applied_on = 'categorie' AND categorie_id IS NOT NULL AND stock_id IS NULL AND template_id IS NULL) OR
    (applied_on = 'gabarit' AND template_id IS NOT NULL AND stock_id IS NULL AND categorie_id IS NULL) OR
    (applied_on = 'variante' AND stock_id IS NOT NULL AND template_id IS NULL AND categorie_id IS NULL)
  );
CREATE INDEX IF NOT EXISTS idx_listes_prix_lignes_template_id ON listes_prix_lignes(template_id);
CREATE INDEX IF NOT EXISTS idx_listes_prix_lignes_categorie_id ON listes_prix_lignes(categorie_id);

-- ═══════════════ Contacts unifiés (fusion clients / fournisseurs) ═══════════════
-- Deuxième étape de l'alignement structurel ERP (après produits) : remplace deux tables
-- séparées par une seule, inspirée d'un modèle de contact standard — contrairement à produits.module (un
-- article de stock ne peut être que Cultures OU Poulailler), un contact réel peut être à
-- la fois client ET fournisseur, d'où deux booléens indépendants plutôt qu'un enum.
-- Voir mergeClientsFournisseursIntoContacts() plus bas pour la fusion effective, y compris
-- le rapprochement automatique des fiches qui représentent déjà la même entité des deux
-- côtés (même SIRET, ou même nom sans ambiguïté).
CREATE TABLE IF NOT EXISTS contacts (
  id                    SERIAL PRIMARY KEY,
  entreprise_id         INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id               INTEGER REFERENCES users(id) ON DELETE SET NULL,
  nom                   VARCHAR(255) NOT NULL,
  prenom                VARCHAR(150),
  telephone             VARCHAR(50),
  email                 VARCHAR(150),
  siret                 VARCHAR(30),
  adresse               TEXT,
  est_client            BOOLEAN NOT NULL DEFAULT false,
  est_fournisseur       BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Provenance de la fusion : contrairement à produits.legacy_table/legacy_id (une seule
  -- origine possible par ligne), un contact issu d'un rapprochement provient des DEUX
  -- tables source à la fois — d'où deux colonnes nullables séparées plutôt qu'un couple
  -- table/id générique.
  legacy_client_id      INTEGER,
  legacy_fournisseur_id INTEGER,
  CHECK (est_client OR est_fournisseur),
  UNIQUE (legacy_client_id),
  UNIQUE (legacy_fournisseur_id)
);
CREATE INDEX IF NOT EXISTS idx_contacts_entreprise_id ON contacts(entreprise_id);

-- Assignation d'une liste de prix à un contact. Nullable : NULL = pas de liste, chaque
-- article utilise son prix par défaut tel quel. ON DELETE SET NULL (pas CASCADE) :
-- supprimer une liste détache les contacts qui l'utilisaient, ne les supprime pas.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS liste_prix_id INTEGER REFERENCES listes_prix(id) ON DELETE SET NULL;

-- Multi-devise réel, étape 2 (voir plus haut, section currency_rates, pour le contexte
-- complet) : nullable = le contact facture dans la devise de l'entreprise (comportement
-- historique inchangé) ; sinon un nouveau devis pour ce contact propose cette devise par
-- défaut (voir routes/devis.js:resoudreDeviseEtTaux).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS devise_facturation TEXT;

-- Alignement visuel ERP (2026-08-27) : adresse décomposée (rue/ville/code postal/pays)
-- pour l'affichage façon fiche Sales Order, additive à côté de l'ancien champ adresse
-- (texte libre, conservé pour compatibilité avec tout ce qui l'affiche déjà ailleurs) plutôt
-- que de le remplacer. Pas de distinction facturation/livraison : un contact n'a qu'une
-- seule adresse dans ce modèle, contrairement à un ERP de référence (adresses enfants) — hors scope ici.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS adresse_rue TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS adresse_ville TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS adresse_code_postal TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS adresse_pays TEXT;

-- Architecture façon fiche contact d'un ERP de référence (2026-08-27, suite explicite de la demande
-- utilisateur d'aligner aussi les données, pas seulement l'affichage — voir
-- project_erp_contact_architecture) : bascule Particulier/Société, photo, poste,
-- notes internes, deuxième ligne d'adresse + région (complète le rue/ville/CP/pays
-- déjà là), rattachement à une société mère + sous-contacts, et tags colorés.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_company BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS photo TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS fonction TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS adresse_rue2 TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS adresse_region TEXT;
-- Auto-référence (société mère d'un sous-contact) : ON DELETE SET NULL, pas CASCADE —
-- supprimer la société ne doit pas supprimer les personnes qui y travaillent, juste les
-- détacher (même philosophie que liste_prix_id juste au-dessus).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_parent_id ON contacts(parent_id);

-- Tags colorés (un widget de tags standard côté ERP de référence) : vraie ressource CRUD par entreprise (même
-- posture que produit_categories/listes_prix, pas une liste figée globale).
CREATE TABLE IF NOT EXISTS contact_tags (
  id            SERIAL PRIMARY KEY,
  entreprise_id INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  nom           TEXT NOT NULL,
  couleur       TEXT NOT NULL DEFAULT '#C1861F',
  UNIQUE (entreprise_id, nom)
);
CREATE INDEX IF NOT EXISTS idx_contact_tags_entreprise_id ON contact_tags(entreprise_id);

CREATE TABLE IF NOT EXISTS contacts_tags_rel (
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES contact_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, tag_id)
);

-- Étape 3 Comptabilité : FK partner_id → contacts pour account_move / account_move_line /
-- account_payment. Ajoutées ici (et non inline) parce que ces trois tables sont créées plus
-- haut dans le script, avant que contacts n'existe (même contrainte que devis.client_id,
-- posée par ALTER plus bas).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'account_move_partner_id_fkey') THEN
    ALTER TABLE account_move ADD CONSTRAINT account_move_partner_id_fkey
      FOREIGN KEY (partner_id) REFERENCES contacts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'account_move_line_partner_id_fkey') THEN
    ALTER TABLE account_move_line ADD CONSTRAINT account_move_line_partner_id_fkey
      FOREIGN KEY (partner_id) REFERENCES contacts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'account_payment_partner_id_fkey') THEN
    ALTER TABLE account_payment ADD CONSTRAINT account_payment_partner_id_fkey
      FOREIGN KEY (partner_id) REFERENCES contacts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ═══════════════ Journal des modifications (chatter) + activités planifiées ═══════════════
-- Round 2 de l'inspiration ERP (après recherche globale/boutons intelligents/routage/nav
-- adaptative/Kanban devis) : deux mécanismes génériques attachables à n'importe quelle
-- ressource via (ressource_type, ressource_id), plutôt que deux tables dédiées aux devis
-- (qui redeviendraient à refaire pour le prochain type de ressource). Pas de FK sur
-- ressource_id (comme stock_id ailleurs dans ce fichier) : la ressource cible change selon
-- ressource_type, une FK réelle nécessiterait une table polymorphe que Postgres ne sait pas
-- exprimer nativement.
--
-- journal_modifications : version simplifiée d'un suivi de champ standard (une ligne par
-- champ changé, liée à un message) — ici une seule ligne par mise à jour, la colonne
-- changements listant tous les champs modifiés en JSON, suffisant pour l'usage (affichage
-- en lecture seule) sans le mécanisme de messagerie complet d'un ERP de référence.
CREATE TABLE IF NOT EXISTS journal_modifications (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  ressource_type TEXT NOT NULL,
  ressource_id   INTEGER NOT NULL,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changements    JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journal_modifications_ressource ON journal_modifications(ressource_type, ressource_id);

-- activites : équivalent simplifié d'un modèle d'activité standard — un rappel/tâche avec échéance,
-- attaché à une ressource. Contrairement à un ERP de référence, ne se supprime pas automatiquement une
-- fois terminée (terminee = TRUE, terminee_at renseignée) : reste visible comme historique
-- plutôt que de se transformer en message de chatter, pour ne pas dépendre du même
-- mécanisme de messagerie.
CREATE TABLE IF NOT EXISTS activites (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  ressource_type TEXT NOT NULL,
  ressource_id   INTEGER NOT NULL,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  titre          TEXT NOT NULL,
  date_echeance  DATE,
  termine        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  terminee_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_activites_ressource ON activites(ressource_type, ressource_id);

-- messages : fil de discussion en texte libre attaché à une ressource (équivalent minimal
-- du "Envoyer un message"/"Log note" du chatter d'un ERP de référence) — distinct de journal_modifications
-- (log automatique de changements de champs) et d'activites (tâches planifiées). Volontairement
-- pas de pièces jointes ni de followers/notifications (2026-08-27) : juste un historique de
-- texte, le plus petit sous-ensemble utile d'un vrai chatter.
CREATE TABLE IF NOT EXISTS messages (
  id             SERIAL PRIMARY KEY,
  entreprise_id  INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  ressource_type TEXT NOT NULL,
  ressource_id   INTEGER NOT NULL,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  contenu        TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_ressource ON messages(ressource_type, ressource_id);

-- ═══════════════ Module Pisciculture ═══════════════
-- Mirroir de poulailler_livraisons/poulailler_suivi (routes/poulailler.js) — le stock
-- (articles/quantités) vit dans le catalogue unifié produits/produit_categories (voir plus
-- bas, extension du CHECK module), pas ici. entreprise_id/user_id sont inclus dès la création
-- (contrairement à poulailler_livraisons/suivi historiquement retrofités par ALTER TABLE).
CREATE TABLE IF NOT EXISTS pisciculture_livraisons (
  id            SERIAL PRIMARY KEY,
  entreprise_id INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  date          DATE NOT NULL DEFAULT CURRENT_DATE,
  client        TEXT NOT NULL,
  produit       TEXT NOT NULL,
  quantite      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  statut        TEXT NOT NULL DEFAULT 'En attente',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pisciculture_livraisons_entreprise_id ON pisciculture_livraisons(entreprise_id);

-- Suivi quotidien (mortalité, croissance/pesée, alimentation, traitement)
CREATE TABLE IF NOT EXISTS pisciculture_suivi (
  id            SERIAL PRIMARY KEY,
  entreprise_id INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  date          DATE NOT NULL DEFAULT CURRENT_DATE,
  type          TEXT NOT NULL,
  quantite      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  detail        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pisciculture_suivi_entreprise_id ON pisciculture_suivi(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_pisciculture_suivi_type ON pisciculture_suivi(type);

-- Le catalogue unifié produits/produit_categories/produit_templates + achats_documents
-- restreignent "module" par un CHECK codé en dur à sa création (voir plus haut) — DROP+ADD
-- inconditionnel à chaque run (idempotent : élargit la liste sans jamais échouer si elle
-- contient déjà 'Pisciculture').
ALTER TABLE achats_documents    DROP CONSTRAINT IF EXISTS achats_documents_module_check;
ALTER TABLE achats_documents    ADD CONSTRAINT achats_documents_module_check CHECK (module IN ('Cultures', 'Poulailler', 'Pisciculture'));
ALTER TABLE produit_categories  DROP CONSTRAINT IF EXISTS produit_categories_module_check;
ALTER TABLE produit_categories  ADD CONSTRAINT produit_categories_module_check CHECK (module IN ('Cultures', 'Poulailler', 'Pisciculture'));
ALTER TABLE produits            DROP CONSTRAINT IF EXISTS produits_module_check;
ALTER TABLE produits            ADD CONSTRAINT produits_module_check CHECK (module IN ('Cultures', 'Poulailler', 'Pisciculture'));
ALTER TABLE produit_templates   DROP CONSTRAINT IF EXISTS produit_templates_module_check;
ALTER TABLE produit_templates   ADD CONSTRAINT produit_templates_module_check CHECK (module IN ('Cultures', 'Poulailler', 'Pisciculture'));

-- ═══════════════ Surveillance : registre de caméras (2026-09-09) ═══════════════
-- L'application ne stocke AUCUNE vidéo et n'en relaie aucune : elle référence les caméras de
-- l'exploitation et affiche, quand le format le permet, ce que la caméra expose déjà. Le
-- stockage et l'enregistrement restent du ressort du matériel ou du NVR de l'entreprise.
--
-- "type_flux" dit comment afficher : "snapshot" (image HTTP rafraîchie — le plus léger, et le
-- seul qui tienne sur une connexion lente), "mjpeg" (flux d’images dans une balise img),
-- "hls" (.m3u8), "lien" (on ouvre simplement l'interface de la caméra). Le RTSP n'est pas
-- proposé : aucun navigateur ne le lit sans passerelle de transcodage, que ce module ne fait
-- volontairement pas.
--
-- "emplacement_type"/"emplacement_id" rattachent librement une caméra à un module ou à une
-- parcelle, sans FK : une caméra doit survivre à la suppression de la parcelle qu'elle
-- observait, comme les snapshots texte de applications_intrants.
CREATE TABLE IF NOT EXISTS cameras (
  id                SERIAL PRIMARY KEY,
  entreprise_id     INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  nom               TEXT NOT NULL,
  emplacement       TEXT,
  emplacement_type  TEXT CHECK (emplacement_type IN ('cultures', 'poulailler', 'pisciculture', 'parcelle', 'autre')),
  emplacement_id    INTEGER,
  type_flux         TEXT NOT NULL DEFAULT 'snapshot' CHECK (type_flux IN ('snapshot', 'mjpeg', 'hls', 'lien')),
  url               TEXT NOT NULL,
  rafraichissement  INTEGER NOT NULL DEFAULT 10,
  actif             BOOLEAN NOT NULL DEFAULT TRUE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cameras_entreprise_id ON cameras(entreprise_id);

-- Alertes de mouvement. Une caméra ne peut pas porter de JWT : elle appelle un webhook dont
-- le secret EST le token. Un token par caméra, régénérable, pour pouvoir en révoquer une
-- seule sans toucher aux autres.
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS token_alerte TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cameras_token_alerte ON cameras(token_alerte) WHERE token_alerte IS NOT NULL;

-- Journal des alertes. Aucune image n est stockée — le module ne conserve que l événement,
-- conformément au principe posé pour la surveillance.
--
-- "occurrences" sert au regroupement : une caméra en détection continue peut émettre des
-- dizaines d alertes par minute. Plutôt que de créer une ligne par appel, on incrémente la
-- dernière alerte de la même caméra tant qu elle est récente, et "derniere_occurrence" suit
-- la fin de l épisode. Une nuit de vent ne noie donc pas le journal.
CREATE TABLE IF NOT EXISTS camera_alertes (
  id                  SERIAL PRIMARY KEY,
  entreprise_id       INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  camera_id           INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  type                TEXT NOT NULL DEFAULT 'mouvement',
  message             TEXT,
  occurrences         INTEGER NOT NULL DEFAULT 1,
  derniere_occurrence TIMESTAMPTZ NOT NULL DEFAULT now(),
  vue                 BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_camera_alertes_entreprise ON camera_alertes(entreprise_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_camera_alertes_camera ON camera_alertes(camera_id, derniere_occurrence DESC);

-- ═══════════════ Fuseau horaire par entreprise (2026-09-09) ═══════════════
-- Le serveur tourne en UTC : CURRENT_DATE y renvoie donc la date civile UTC, pas celle
-- vécue par l'utilisateur. Une vente saisie à 00h30 à Paris (22h30 UTC la veille) était
-- datée du jour précédent, et n'apparaissait pas dans son rapport journalier.
--
-- Le fuseau est porté par l ENTREPRISE, pas par l utilisateur : une pièce est datée dans le
-- fuseau de la société (convention comptable), pas dans celui de l employé en déplacement.
-- Valeur par défaut 'UTC' — c'est le comportement actuel, donc aucune entreprise existante
-- ne voit ses dates bouger tant qu elle n a rien choisi.
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS fuseau TEXT NOT NULL DEFAULT 'UTC';

-- Remplace CURRENT_DATE dans toutes les requêtes qui datent une pièce ou comparent une
-- échéance. Centralisée ici plutôt que dupliquée dans ~24 requêtes : un seul endroit à
-- corriger, et un fuseau invalide retombe sur UTC au lieu de faire échouer la requête.
--
-- En plpgsql avec un handler plutôt qu une validation contre pg_timezone_names : cette vue
-- compte ~1200 lignes et la fonction est appelée depuis des WHERE, donc la valider à chaque
-- ligne coûterait cher. Le fuseau est validé à l écriture (PUT /api/entreprise) ; le handler
-- ne sert que de filet si une valeur invalide arrive malgré tout en base.
-- STABLE (pas IMMUTABLE) : le résultat dépend de now().
CREATE OR REPLACE FUNCTION date_entreprise(p_entreprise_id INTEGER) RETURNS DATE AS $fn$
DECLARE
  v_fuseau TEXT;
BEGIN
  SELECT fuseau INTO v_fuseau FROM entreprises WHERE id = p_entreprise_id;
  IF v_fuseau IS NULL OR btrim(v_fuseau) = '' THEN
    RETURN (now() AT TIME ZONE 'UTC')::date;
  END IF;
  RETURN (now() AT TIME ZONE v_fuseau)::date;
EXCEPTION WHEN OTHERS THEN
  RETURN (now() AT TIME ZONE 'UTC')::date;
END;
$fn$ LANGUAGE plpgsql STABLE;
`;

// Catégories par défaut créées pour chaque entreprise qui n'en a pas encore, au même titre
// que les valeurs DEFAULT historiques de cultures_stocks.categorie/poulailler_stocks.categorie
// ('Semences' / 'Aliment') — préserve les 7 libellés déjà utilisés dans toute l'app (StocksTab
// notamment) pour qu'aucune donnée existante ne se retrouve sans catégorie après la fusion.
// Liste importée de utils/referentielsDefaut.js (source partagée avec routes/auth.js).
const CATEGORIES_PAR_DEFAUT = CATEGORIES_PRODUITS_DEFAUT;

// Fusionne cultures_stocks/poulailler_stocks dans produits, repointe les 4 tables qui
// référençaient l'une ou l'autre par (stock_module, stock_id), puis renomme (ne supprime pas)
// les anciennes tables comme filet de sécurité. Idempotent par construction : si
// cultures_stocks n'existe plus (déjà fusionnée), sort immédiatement sans rien faire. Toute
// la fusion tourne dans sa propre transaction explicite (contrairement au bloc SQL principal
// ci-dessus, qui n'en a pas) car une fusion de données réelles doit pouvoir s'annuler
// intégralement en cas de problème — voir le plan d'implémentation pour le détail des
// vérifications effectuées avant COMMIT.
async function mergeStocksIntoProduits() {
  // Idempotence basée sur l'existence d'une table *_legacy_<date> plutôt que sur
  // l'existence de cultures_stocks elle-même : le bloc SQL principal ci-dessus (CREATE
  // TABLE IF NOT EXISTS) ne sait pas qu'une fusion a déjà eu lieu et recrée sans le
  // vouloir une coquille cultures_stocks/poulailler_stocks vide à chaque relance de
  // migrate.js une fois la vraie fusion faite — bug réel trouvé en répétant la migration
  // sur une copie de sauvegarde avant de l'appliquer en production (2026-08-18).
  const { rows: [{ already }] } = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'cultures_stocks_legacy_%'
    ) AS already
  `);
  if (already) {
    // Coquilles vides recréées par le bloc SQL principal (garanties vides puisque la
    // vraie fusion a déjà eu lieu et déplacé toutes les données réelles) — supprimées
    // immédiatement plutôt que laissées traîner sans rien y référencer.
    await client.query('DROP TABLE IF EXISTS cultures_stocks');
    await client.query('DROP TABLE IF EXISTS poulailler_stocks');
    console.log('ℹ️  produits : fusion déjà effectuée — coquilles vides nettoyées, étape ignorée.');
    return;
  }

  try {
    await client.query('BEGIN');

    const { rows: [{ cs, ps, ps_orphan }] } = await client.query(`
      SELECT (SELECT COUNT(*) FROM cultures_stocks) AS cs,
             (SELECT COUNT(*) FROM poulailler_stocks WHERE entreprise_id IS NOT NULL) AS ps,
             (SELECT COUNT(*) FROM poulailler_stocks WHERE entreprise_id IS NULL) AS ps_orphan
    `);
    if (Number(ps_orphan) > 0) {
      console.warn(`⚠️  produits : ${ps_orphan} ligne(s) poulailler_stocks sans entreprise_id — exclues de la fusion.`);
    }

    // Une entreprise par ligne, pas de doublon (matérialise la liste des entreprises ayant
    // au moins un article dans l'une ou l'autre table, avant de créer leurs catégories).
    const { rows: entreprises } = await client.query(`
      SELECT DISTINCT entreprise_id FROM (
        SELECT entreprise_id FROM cultures_stocks
        UNION
        SELECT entreprise_id FROM poulailler_stocks WHERE entreprise_id IS NOT NULL
      ) e
    `);
    for (const { entreprise_id } of entreprises) {
      for (const cat of CATEGORIES_PAR_DEFAUT) {
        await client.query(
          `INSERT INTO produit_categories (entreprise_id, module, nom, ordre) VALUES ($1, $2, $3, $4)
           ON CONFLICT (entreprise_id, module, nom) DO NOTHING`,
          [entreprise_id, cat.module, cat.nom, cat.ordre]
        );
      }
    }

    await client.query(`
      INSERT INTO produits (entreprise_id, user_id, module, nom, categorie_id, quantite, unite, seuil, prix_defaut, created_at, legacy_table, legacy_id)
      SELECT cs.entreprise_id, cs.user_id, 'Cultures', cs.nom,
             COALESCE(
               (SELECT id FROM produit_categories WHERE entreprise_id = cs.entreprise_id AND module = 'Cultures' AND nom = cs.categorie),
               (SELECT id FROM produit_categories WHERE entreprise_id = cs.entreprise_id AND module = 'Cultures' AND nom = 'Autre')
             ),
             cs.quantite, cs.unite, cs.seuil, cs.prix_defaut, cs.created_at, 'cultures_stocks', cs.id
      FROM cultures_stocks cs
      ON CONFLICT (legacy_table, legacy_id) DO NOTHING
    `);

    await client.query(`
      INSERT INTO produits (entreprise_id, user_id, module, nom, categorie_id, quantite, unite, seuil, prix_defaut, created_at, legacy_table, legacy_id)
      SELECT ps.entreprise_id, ps.user_id, 'Poulailler', ps.nom,
             COALESCE(
               (SELECT id FROM produit_categories WHERE entreprise_id = ps.entreprise_id AND module = 'Poulailler' AND nom = ps.categorie),
               (SELECT id FROM produit_categories WHERE entreprise_id = ps.entreprise_id AND module = 'Poulailler' AND nom = 'Autre')
             ),
             ps.quantite, ps.unite, ps.seuil, ps.prix_defaut, ps.created_at, 'poulailler_stocks', ps.id
      FROM poulailler_stocks ps
      WHERE ps.entreprise_id IS NOT NULL
      ON CONFLICT (legacy_table, legacy_id) DO NOTHING
    `);

    // Repointage : pour chaque table référente, on retrouve le produit correspondant via
    // (legacy_table, legacy_id) — le module d'origine de la ligne indique quelle ancienne
    // table cibler (achats_documents.module pour achats_lignes, stock_module pour les autres).
    await client.query(`
      UPDATE achats_lignes al SET stock_id = p.id
      FROM achats_documents ad, produits p
      WHERE al.document_id = ad.id AND al.stock_id IS NOT NULL
        AND p.legacy_table = CASE ad.module WHEN 'Cultures' THEN 'cultures_stocks' ELSE 'poulailler_stocks' END
        AND p.legacy_id = al.stock_id
    `);

    await client.query(`
      UPDATE devis_lignes dl SET stock_id = p.id
      FROM produits p
      WHERE dl.stock_id IS NOT NULL AND dl.stock_module IS NOT NULL
        AND p.legacy_table = CASE dl.stock_module WHEN 'Cultures' THEN 'cultures_stocks' ELSE 'poulailler_stocks' END
        AND p.legacy_id = dl.stock_id
    `);

    await client.query(`
      UPDATE stock_mouvements sm SET stock_id = p.id
      FROM produits p
      WHERE sm.stock_id IS NOT NULL
        AND p.legacy_table = CASE sm.stock_module WHEN 'Cultures' THEN 'cultures_stocks' ELSE 'poulailler_stocks' END
        AND p.legacy_id = sm.stock_id
    `);

    // client_prix a disparu depuis la fusion listes_prix (étape 3) sur une base déjà à jour
    // — sur une base neuve, elle n'a même jamais existé (son CREATE TABLE a été retiré du
    // bloc SQL principal). Repointage seulement si elle existe encore (ex: restauration d'un
    // dump antérieur à l'étape 3, rejouée contre le migrate.js actuel).
    const { rows: [{ exists: clientPrixExiste }] } = await client.query(
      `SELECT to_regclass('public.client_prix') IS NOT NULL AS exists`
    );
    if (clientPrixExiste) {
      await client.query(`
        UPDATE client_prix cp SET stock_id = p.id
        FROM produits p
        WHERE p.legacy_table = CASE cp.stock_module WHEN 'Cultures' THEN 'cultures_stocks' ELSE 'poulailler_stocks' END
          AND p.legacy_id = cp.stock_id
      `);
    }

    // Vérification en transaction — throw ici annule tout (ROLLBACK dans le catch ci-dessous),
    // les tables cultures_stocks/poulailler_stocks restent intactes en cas de problème.
    const { rows: [r] } = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM produits WHERE legacy_table = 'cultures_stocks') AS p_cs,
        (SELECT COUNT(*) FROM produits WHERE legacy_table = 'poulailler_stocks') AS p_ps,
        (SELECT COUNT(*) FROM achats_lignes WHERE stock_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM produits p WHERE p.id = achats_lignes.stock_id)) AS orphan_al,
        (SELECT COUNT(*) FROM devis_lignes WHERE stock_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM produits p WHERE p.id = devis_lignes.stock_id)) AS orphan_dl,
        (SELECT COUNT(*) FROM stock_mouvements WHERE stock_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM produits p WHERE p.id = stock_mouvements.stock_id)) AS orphan_sm
    `);
    const orphanCp = clientPrixExiste
      ? Number((await client.query(`SELECT COUNT(*) FROM client_prix WHERE NOT EXISTS (SELECT 1 FROM produits p WHERE p.id = client_prix.stock_id)`)).rows[0].count)
      : 0;
    const problemes = [];
    if (Number(r.p_cs) !== Number(cs)) problemes.push(`cultures_stocks ${cs} ≠ produits(legacy=cultures_stocks) ${r.p_cs}`);
    if (Number(r.p_ps) !== Number(ps)) problemes.push(`poulailler_stocks ${ps} ≠ produits(legacy=poulailler_stocks) ${r.p_ps}`);
    for (const k of ['orphan_al', 'orphan_dl', 'orphan_sm']) {
      if (Number(r[k]) > 0) problemes.push(`${k} = ${r[k]}`);
    }
    if (orphanCp > 0) problemes.push(`orphan_cp = ${orphanCp}`);
    if (problemes.length) {
      throw new Error(`Vérification post-fusion échouée : ${problemes.join(' | ')}`);
    }

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    await client.query(`ALTER TABLE cultures_stocks RENAME TO cultures_stocks_legacy_${stamp}`);
    await client.query(`ALTER TABLE poulailler_stocks RENAME TO poulailler_stocks_legacy_${stamp}`);

    await client.query('COMMIT');
    console.log(`✅ produits : fusion réussie (${r.p_cs} Cultures + ${r.p_ps} Poulailler). Anciennes tables renommées *_legacy_${stamp}.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// Retrouve dynamiquement le nom d'une contrainte FK plutôt que de le supposer — aucune
// des contraintes clients/fournisseurs du schéma actuel n'a de nom explicite, donc
// Postgres a choisi le nom par défaut (`<table>_<colonne>_fkey`), mais on interroge
// pg_constraint au lieu de le coder en dur, plus robuste si ça change un jour.
async function findForeignKeyName(table, column) {
  const { rows } = await client.query(
    `SELECT con.conname
     FROM pg_constraint con
     JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
     WHERE con.conrelid = $1::regclass AND con.contype = 'f' AND att.attname = $2`,
    [table, column]
  );
  if (rows.length === 0) throw new Error(`Contrainte FK introuvable sur ${table}.${column}`);
  return rows[0].conname;
}

// Fusionne clients/fournisseurs dans contacts, avec un rapprochement automatique des
// paires qui représentent déjà la même entité des deux côtés (décision explicite de
// l'utilisateur, malgré le risque plus élevé que la fusion produits — voir le plan
// d'implémentation pour la discussion complète) :
//   - Tier 1 (confiance haute) : SIRET identique non vide des deux côtés.
//   - Tier 2 (confiance moyenne) : nom+prénom identiques (insensible à la casse/espaces),
//     au moins un SIRET vide, ET correspondance non ambiguë (un seul candidat de chaque
//     côté) — sinon on ne devine pas, les fiches restent séparées.
// Contrairement à mergeStocksIntoProduits (stock_id sans FK stricte), devis.client_id/
// client_prix.client_id/achats_documents.fournisseur_id sont de vraies contraintes FK :
// il faut les supprimer avant de repointer les colonnes (sinon l'UPDATE viole la
// contrainte existante), puis en recréer de nouvelles vers contacts(id).
async function mergeClientsFournisseursIntoContacts() {
  const { rows: [{ already }] } = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'clients_legacy_%'
    ) AS already
  `);
  if (already) {
    await client.query('DROP TABLE IF EXISTS clients');
    await client.query('DROP TABLE IF EXISTS fournisseurs');
    console.log('ℹ️  contacts : fusion déjà effectuée — coquilles vides nettoyées, étape ignorée.');
    return;
  }

  try {
    await client.query('BEGIN');

    const { rows: [{ cl, fo }] } = await client.query(`
      SELECT (SELECT COUNT(*) FROM clients) AS cl, (SELECT COUNT(*) FROM fournisseurs) AS fo
    `);

    // Paires rapprochées : tier 1 (SIRET) en premier, puis tier 2 (nom non ambigu) en
    // excluant tout client/fournisseur déjà apparié au tier 1.
    const paires = await client.query(`
      WITH tier1 AS (
        SELECT cl.id AS client_id, fo.id AS fournisseur_id, cl.nom AS client_nom, fo.nom AS fournisseur_nom, 'siret' AS critere
        FROM clients cl JOIN fournisseurs fo
          ON cl.entreprise_id = fo.entreprise_id
          AND LOWER(TRIM(cl.siret)) = LOWER(TRIM(fo.siret))
          AND NULLIF(TRIM(cl.siret), '') IS NOT NULL AND NULLIF(TRIM(fo.siret), '') IS NOT NULL
      ),
      tier2_candidats AS (
        SELECT cl.id AS client_id, fo.id AS fournisseur_id, cl.nom AS client_nom, fo.nom AS fournisseur_nom,
               COUNT(*) OVER (PARTITION BY cl.id) AS n_cote_client,
               COUNT(*) OVER (PARTITION BY fo.id) AS n_cote_fournisseur
        FROM clients cl JOIN fournisseurs fo
          ON cl.entreprise_id = fo.entreprise_id
          AND LOWER(TRIM(cl.nom)) = LOWER(TRIM(fo.nom))
          AND COALESCE(LOWER(TRIM(cl.prenom)), '') = COALESCE(LOWER(TRIM(fo.prenom)), '')
          AND (NULLIF(TRIM(cl.siret), '') IS NULL OR NULLIF(TRIM(fo.siret), '') IS NULL)
        WHERE cl.id NOT IN (SELECT client_id FROM tier1) AND fo.id NOT IN (SELECT fournisseur_id FROM tier1)
      ),
      tier2 AS (
        SELECT client_id, fournisseur_id, client_nom, fournisseur_nom, 'nom' AS critere
        FROM tier2_candidats WHERE n_cote_client = 1 AND n_cote_fournisseur = 1
      )
      SELECT * FROM tier1 UNION ALL SELECT * FROM tier2
    `);
    for (const p of paires.rows) {
      console.log(`ℹ️  contacts : rapprochement (${p.critere}) — client #${p.client_id} "${p.client_nom}" ↔ fournisseur #${p.fournisseur_id} "${p.fournisseur_nom}"`);
    }
    console.log(`ℹ️  contacts : ${paires.rows.length} paire(s) rapprochée(s) sur ${cl} client(s) / ${fo} fournisseur(s).`);

    // Contacts fusionnés (les deux rôles) — clients en priorité, fournisseurs en complément
    // uniquement sur les champs vides côté client, jamais d'écrasement d'une valeur déjà là.
    await client.query(`
      INSERT INTO contacts (entreprise_id, user_id, nom, prenom, telephone, email, siret, adresse,
                             est_client, est_fournisseur, created_at, legacy_client_id, legacy_fournisseur_id)
      SELECT cl.entreprise_id, cl.user_id,
             cl.nom, COALESCE(NULLIF(cl.prenom, ''), fo.prenom),
             COALESCE(NULLIF(cl.telephone, ''), fo.telephone),
             COALESCE(NULLIF(cl.email, ''), fo.email),
             COALESCE(NULLIF(cl.siret, ''), fo.siret),
             COALESCE(NULLIF(cl.adresse, ''), fo.adresse),
             true, true, cl.created_at, cl.id, fo.id
      FROM clients cl
      JOIN (
        SELECT cl2.id AS client_id, fo2.id AS fournisseur_id
        FROM clients cl2 JOIN fournisseurs fo2
          ON cl2.entreprise_id = fo2.entreprise_id
          AND LOWER(TRIM(cl2.siret)) = LOWER(TRIM(fo2.siret))
          AND NULLIF(TRIM(cl2.siret), '') IS NOT NULL AND NULLIF(TRIM(fo2.siret), '') IS NOT NULL
      ) m ON m.client_id = cl.id
      JOIN fournisseurs fo ON fo.id = m.fournisseur_id
    `);
    // La requête ci-dessus ne couvre que le tier 1 (SIRET) pour rester simple à relire —
    // le tier 2 (nom non ambigu) est fusionné séparément juste après avec la même logique
    // COALESCE, en réutilisant exactement la CTE de détection utilisée pour le log plus haut.
    await client.query(`
      WITH tier1_deja_fait AS (
        SELECT cl.id AS client_id, fo.id AS fournisseur_id
        FROM clients cl JOIN fournisseurs fo
          ON cl.entreprise_id = fo.entreprise_id
          AND LOWER(TRIM(cl.siret)) = LOWER(TRIM(fo.siret))
          AND NULLIF(TRIM(cl.siret), '') IS NOT NULL AND NULLIF(TRIM(fo.siret), '') IS NOT NULL
      ),
      tier2_candidats AS (
        SELECT cl.id AS client_id, fo.id AS fournisseur_id,
               COUNT(*) OVER (PARTITION BY cl.id) AS n_cote_client,
               COUNT(*) OVER (PARTITION BY fo.id) AS n_cote_fournisseur
        FROM clients cl JOIN fournisseurs fo
          ON cl.entreprise_id = fo.entreprise_id
          AND LOWER(TRIM(cl.nom)) = LOWER(TRIM(fo.nom))
          AND COALESCE(LOWER(TRIM(cl.prenom)), '') = COALESCE(LOWER(TRIM(fo.prenom)), '')
          AND (NULLIF(TRIM(cl.siret), '') IS NULL OR NULLIF(TRIM(fo.siret), '') IS NULL)
        WHERE cl.id NOT IN (SELECT client_id FROM tier1_deja_fait) AND fo.id NOT IN (SELECT fournisseur_id FROM tier1_deja_fait)
      ),
      tier2 AS (
        SELECT client_id, fournisseur_id FROM tier2_candidats WHERE n_cote_client = 1 AND n_cote_fournisseur = 1
      )
      INSERT INTO contacts (entreprise_id, user_id, nom, prenom, telephone, email, siret, adresse,
                             est_client, est_fournisseur, created_at, legacy_client_id, legacy_fournisseur_id)
      SELECT cl.entreprise_id, cl.user_id,
             cl.nom, COALESCE(NULLIF(cl.prenom, ''), fo.prenom),
             COALESCE(NULLIF(cl.telephone, ''), fo.telephone),
             COALESCE(NULLIF(cl.email, ''), fo.email),
             COALESCE(NULLIF(cl.siret, ''), fo.siret),
             COALESCE(NULLIF(cl.adresse, ''), fo.adresse),
             true, true, cl.created_at, cl.id, fo.id
      FROM tier2 t JOIN clients cl ON cl.id = t.client_id JOIN fournisseurs fo ON fo.id = t.fournisseur_id
    `);

    // Clients non rapprochés → contact client seul.
    await client.query(`
      INSERT INTO contacts (entreprise_id, user_id, nom, prenom, telephone, email, siret, adresse,
                             est_client, est_fournisseur, created_at, legacy_client_id)
      SELECT entreprise_id, user_id, nom, prenom, telephone, email, siret, adresse, true, false, created_at, id
      FROM clients cl WHERE NOT EXISTS (SELECT 1 FROM contacts c WHERE c.legacy_client_id = cl.id)
    `);
    // Fournisseurs non rapprochés → contact fournisseur seul.
    await client.query(`
      INSERT INTO contacts (entreprise_id, user_id, nom, prenom, telephone, email, siret, adresse,
                             est_client, est_fournisseur, created_at, legacy_fournisseur_id)
      SELECT entreprise_id, user_id, nom, prenom, telephone, email, siret, adresse, false, true, created_at, id
      FROM fournisseurs fo WHERE NOT EXISTS (SELECT 1 FROM contacts c WHERE c.legacy_fournisseur_id = fo.id)
    `);

    // Les FK réelles vers clients/fournisseurs doivent être supprimées avant le repointage
    // (sinon l'UPDATE ci-dessous viole la contrainte existante), puis recréées vers
    // contacts(id) avec les mêmes ON DELETE qu'aujourd'hui. client_prix a disparu depuis
    // l'étape 3 (listes_prix) sur une base à jour — sur une base neuve elle n'a même jamais
    // existé — donc traitée seulement si elle existe encore (ex: dump antérieur à l'étape 3
    // rejoué contre le migrate.js actuel).
    const devisFk = await findForeignKeyName('devis', 'client_id');
    const achatsFk = await findForeignKeyName('achats_documents', 'fournisseur_id');
    await client.query(`ALTER TABLE devis DROP CONSTRAINT ${devisFk}`);
    await client.query(`ALTER TABLE achats_documents DROP CONSTRAINT ${achatsFk}`);

    const { rows: [{ exists: clientPrixExiste }] } = await client.query(
      `SELECT to_regclass('public.client_prix') IS NOT NULL AS exists`
    );
    if (clientPrixExiste) {
      const prixFk = await findForeignKeyName('client_prix', 'client_id');
      await client.query(`ALTER TABLE client_prix DROP CONSTRAINT ${prixFk}`);
    }

    await client.query(`
      UPDATE devis d SET client_id = c.id FROM contacts c
      WHERE d.client_id IS NOT NULL AND c.legacy_client_id = d.client_id
    `);
    if (clientPrixExiste) {
      await client.query(`
        UPDATE client_prix cp SET client_id = c.id FROM contacts c
        WHERE c.legacy_client_id = cp.client_id
      `);
    }
    await client.query(`
      UPDATE achats_documents ad SET fournisseur_id = c.id FROM contacts c
      WHERE ad.fournisseur_id IS NOT NULL AND c.legacy_fournisseur_id = ad.fournisseur_id
    `);

    await client.query(`ALTER TABLE devis ADD CONSTRAINT devis_client_id_fkey FOREIGN KEY (client_id) REFERENCES contacts(id)`);
    if (clientPrixExiste) {
      await client.query(`ALTER TABLE client_prix ADD CONSTRAINT client_prix_client_id_fkey FOREIGN KEY (client_id) REFERENCES contacts(id) ON DELETE CASCADE`);
    }
    await client.query(`ALTER TABLE achats_documents ADD CONSTRAINT achats_documents_fournisseur_id_fkey FOREIGN KEY (fournisseur_id) REFERENCES contacts(id) ON DELETE SET NULL`);

    // Vérification en transaction avant COMMIT — throw ici annule tout, clients/fournisseurs
    // restent intacts en cas de problème.
    const { rows: [r] } = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM contacts) AS total,
        (SELECT COUNT(*) FROM devis WHERE client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = devis.client_id)) AS orphan_devis,
        (SELECT COUNT(*) FROM achats_documents WHERE fournisseur_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = achats_documents.fournisseur_id)) AS orphan_achats
    `);
    const orphanPrix = clientPrixExiste
      ? Number((await client.query(`SELECT COUNT(*) FROM client_prix WHERE NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = client_prix.client_id)`)).rows[0].count)
      : 0;
    const attendu = Number(cl) + Number(fo) - paires.rows.length;
    const problemes = [];
    if (Number(r.total) !== attendu) problemes.push(`contacts ${r.total} ≠ attendu ${attendu} (${cl} clients + ${fo} fournisseurs − ${paires.rows.length} rapprochement(s))`);
    for (const k of ['orphan_devis', 'orphan_achats']) {
      if (Number(r[k]) > 0) problemes.push(`${k} = ${r[k]}`);
    }
    if (orphanPrix > 0) problemes.push(`orphan_prix = ${orphanPrix}`);
    if (problemes.length) {
      throw new Error(`Vérification post-fusion échouée : ${problemes.join(' | ')}`);
    }

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    await client.query(`ALTER TABLE clients RENAME TO clients_legacy_${stamp}`);
    await client.query(`ALTER TABLE fournisseurs RENAME TO fournisseurs_legacy_${stamp}`);

    await client.query('COMMIT');
    console.log(`✅ contacts : fusion réussie (${r.total} contacts, dont ${paires.rows.length} rapprochement(s)). Anciennes tables renommées *_legacy_${stamp}.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// Fusionne client_prix vers listes_prix/listes_prix_lignes (étape 3). Idempotence sur
// l'existence de la table elle-même : contrairement aux deux fusions précédentes (qui
// renomment en *_legacy_<date>), pas de données historiques à conserver sous cette forme
// une fois converties — DROP direct. Couvre à la fois "déjà migrée" et "base neuve qui n'a
// jamais créé client_prix" (son CREATE TABLE a été retiré du bloc SQL principal).
async function migrateClientPrixToListesPrix() {
  const { rows: [{ exists: clientPrixExiste }] } = await client.query(
    `SELECT to_regclass('public.client_prix') IS NOT NULL AS exists`
  );
  if (!clientPrixExiste) {
    console.log('ℹ️  listes_prix : client_prix déjà absente — étape ignorée.');
    return;
  }

  try {
    await client.query('BEGIN');

    const { rows: [{ count }] } = await client.query('SELECT COUNT(*) FROM client_prix');

    if (Number(count) === 0) {
      // Chemin attendu (confirmé : zéro ligne en production au moment de cette étape) —
      // rien à convertir.
      await client.query('DROP TABLE client_prix');
      await client.query('COMMIT');
      console.log('✅ listes_prix : client_prix était vide — supprimée sans conversion.');
      return;
    }

    // Chemin défensif, non exercé par les vraies données actuelles (couvre un autre
    // environnement, ou une relance avant déploiement) : une liste par client concerné,
    // nommée "Tarifs <nom>", dédoublonnée si ce nom existe déjà pour l'entreprise.
    const { rows: clientsAvecPrix } = await client.query(`
      SELECT DISTINCT cp.client_id, cp.entreprise_id, c.nom AS contact_nom
      FROM client_prix cp JOIN contacts c ON c.id = cp.client_id
    `);
    for (const { client_id, entreprise_id, contact_nom } of clientsAvecPrix) {
      let nomListe = `Tarifs ${contact_nom}`;
      let n = 1;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { rows: [{ exists: nomPris }] } = await client.query(
          `SELECT EXISTS (SELECT 1 FROM listes_prix WHERE entreprise_id = $1 AND nom = $2) AS exists`,
          [entreprise_id, nomListe]
        );
        if (!nomPris) break;
        n += 1;
        nomListe = `Tarifs ${contact_nom} (${n})`;
      }

      const { rows: [{ id: listeId }] } = await client.query(
        `INSERT INTO listes_prix (entreprise_id, nom) VALUES ($1, $2) RETURNING id`,
        [entreprise_id, nomListe]
      );

      // stock_module abandonné — stock_id seul suffit depuis la fusion produits (étape 1).
      await client.query(
        `INSERT INTO listes_prix_lignes (liste_prix_id, stock_id, prix)
         SELECT $1, cp.stock_id, cp.prix FROM client_prix cp WHERE cp.client_id = $2
         ON CONFLICT (liste_prix_id, stock_id) DO NOTHING`,
        [listeId, client_id]
      );

      await client.query(`UPDATE contacts SET liste_prix_id = $1 WHERE id = $2`, [listeId, client_id]);
      console.log(`ℹ️  listes_prix : contact #${client_id} "${contact_nom}" → liste "${nomListe}" (id ${listeId}).`);
    }

    // Vérification avant COMMIT — throw ici annule tout.
    const { rows: [{ orphan }] } = await client.query(`
      SELECT COUNT(*) AS orphan FROM client_prix cp
      WHERE NOT EXISTS (
        SELECT 1 FROM listes_prix_lignes lpl JOIN contacts c ON c.liste_prix_id = lpl.liste_prix_id
        WHERE c.id = cp.client_id AND lpl.stock_id = cp.stock_id AND lpl.prix = cp.prix
      )
    `);
    if (Number(orphan) > 0) {
      throw new Error(`Vérification post-conversion échouée : ${orphan} ligne(s) client_prix non retrouvée(s).`);
    }

    await client.query('DROP TABLE client_prix');
    await client.query('COMMIT');
    console.log(`✅ listes_prix : ${clientsAvecPrix.length} liste(s) créée(s) depuis client_prix (chemin défensif).`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// Convertit devis_lignes.remise (montant fixe FCFA) en remise_pourcentage (%), étape 4.
// Idempotence sur l'existence de la colonne remise elle-même (information_schema.columns,
// pas to_regclass puisqu'on modifie une colonne et non une table) : si elle n'existe plus,
// la conversion a déjà eu lieu.
async function migrateRemiseToPourcentage() {
  const { rows: [{ exists: remiseExiste }] } = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'devis_lignes' AND column_name = 'remise'
    ) AS exists
  `);
  if (!remiseExiste) {
    console.log('ℹ️  remise_pourcentage : colonne remise déjà absente — conversion déjà effectuée, étape ignorée.');
    return;
  }

  try {
    await client.query('BEGIN');

    const { rows: [{ count: nbAConvertir }] } = await client.query(
      `SELECT COUNT(*) FROM devis_lignes WHERE remise IS NOT NULL AND remise <> 0`
    );

    // Cas dégénéré (remise > 0 mais sous-total nul, donc aucun pourcentage équivalent
    // n'existe) : journalisé, laissé à remise_pourcentage = 0 par défaut (le montant remise,
    // non convertible, est perdu). Non exercé par les données réelles connues.
    const { rows: aberrantes } = await client.query(`
      SELECT id, devis_id, remise FROM devis_lignes
      WHERE remise IS NOT NULL AND remise <> 0 AND (quantite * prix_unitaire) = 0
    `);
    if (aberrantes.length > 0) {
      console.warn(`⚠️  remise_pourcentage : ${aberrantes.length} ligne(s) à sous-total nul, remise non convertible (restera à 0%) :`, aberrantes);
    }

    // Formule sans perte : remise_pourcentage = (remise / sous_total) * 100, arrondie à 2
    // décimales (précision de NUMERIC(5,2)).
    await client.query(`
      UPDATE devis_lignes
      SET remise_pourcentage = ROUND((remise / NULLIF(quantite * prix_unitaire, 0)) * 100, 2)
      WHERE remise IS NOT NULL AND remise <> 0 AND (quantite * prix_unitaire) <> 0
    `);

    // Vérification avant COMMIT : reproduit le total ligne par ligne avec la nouvelle formule
    // et compare à l'ancien. Tolérance 0.02 (pas 0) : la précision à 2 décimales de
    // remise_pourcentage introduit un écart d'arrondi résiduel documenté (jusqu'à 0.01 FCFA
    // sur une ligne réelle en production), inévitable pour un ratio non exactement décimal.
    const { rows: [{ maxEcart }] } = await client.query(`
      SELECT MAX(ABS(
        (quantite * prix_unitaire - remise) -
        (quantite * prix_unitaire * (1 - remise_pourcentage / 100))
      )) AS "maxEcart"
      FROM devis_lignes WHERE remise IS NOT NULL AND remise <> 0
    `);
    if (maxEcart !== null && Number(maxEcart) > 0.02) {
      throw new Error(`Vérification post-conversion échouée : écart max ${maxEcart} > tolérance 0.02.`);
    }

    await client.query('ALTER TABLE devis_lignes DROP COLUMN remise');
    await client.query('COMMIT');
    console.log(`✅ remise_pourcentage : ${nbAConvertir} ligne(s) converties (écart max ${maxEcart || 0}). Colonne remise supprimée.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// Bascule du taux de taxe unique par devis (colonne devis.taux_taxe, ajoutée puis abandonnée
// le même jour, voir le commentaire au-dessus de la définition de devis_lignes.taux_taxe)
// vers un vrai taux par ligne. Idempotent sur l'existence de devis.taux_taxe (même garde que
// migrateRemiseToPourcentage) : sur une base où la colonne n'a jamais existé (installation
// fraîche postérieure à ce changement), ne fait rien.
async function migrateTaxeDevisVersLignes() {
  const { rows: [{ exists: colonneExiste }] } = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'devis' AND column_name = 'taux_taxe'
    ) AS exists
  `);
  if (!colonneExiste) {
    console.log('ℹ️  taux_taxe par ligne : colonne devis.taux_taxe déjà absente — bascule déjà effectuée, étape ignorée.');
    return;
  }

  try {
    await client.query('BEGIN');

    const { rows: [{ count: nbDevisAffectes }] } = await client.query(
      `SELECT COUNT(*) FROM devis WHERE taux_taxe IS NOT NULL AND taux_taxe <> 0`
    );

    // Reporte le taux du devis sur chacune de ses lignes de type produit (les sections n'ont
    // jamais de taxe, voir normalizeLigne côté route).
    await client.query(`
      UPDATE devis_lignes dl SET taux_taxe = d.taux_taxe
      FROM devis d
      WHERE dl.devis_id = d.id AND d.taux_taxe IS NOT NULL AND d.taux_taxe <> 0 AND dl.type = 'produit'
    `);

    // Recalcule le total de chaque devis affecté avec la nouvelle formule par ligne
    // (remise globale puis taxe, ligne par ligne) pour rester cohérent avec calculerTotal()
    // côté route — voir routes/devis.js.
    await client.query(`
      UPDATE devis d SET total = sub.nouveau_total
      FROM (
        SELECT dl.devis_id,
               SUM(
                 CASE WHEN dl.type = 'section' THEN 0 ELSE
                   dl.quantite * dl.prix_unitaire * (1 - dl.remise_pourcentage / 100)
                   * (1 - d2.remise_globale / 100) * (1 + dl.taux_taxe / 100)
                 END
               ) AS nouveau_total
        FROM devis_lignes dl
        JOIN devis d2 ON d2.id = dl.devis_id
        WHERE d2.taux_taxe IS NOT NULL AND d2.taux_taxe <> 0
        GROUP BY dl.devis_id
      ) sub
      WHERE d.id = sub.devis_id
    `);

    await client.query('ALTER TABLE devis DROP COLUMN taux_taxe');
    await client.query('COMMIT');
    console.log(`✅ taux_taxe par ligne : ${nbDevisAffectes} devis converti(s). Colonne devis.taux_taxe supprimée.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// Étape 1 Comptabilité : bascule du % par ligne (devis_lignes.taux_taxe) vers de vraies
// taxes réutilisables (account_tax) reliées en Many2many par devis_lignes_taxes — cf.
// sale.order.line.tax_id d'un ERP de référence. Pour chaque (entreprise, taux) distinct avec
// taux > 0 : une taxe account_tax « TVA {taux} % » (amount_type 'percent'), puis un lien par
// ligne concernée. Puis DROP COLUMN taux_taxe. Idempotent sur l'existence de la colonne
// (même garde que migrateRemiseToPourcentage / migrateTaxeDevisVersLignes). En production
// 0 ligne réelle a un taux_taxe non nul (confirmé) → no-op de fait, mais la conversion est
// écrite pour être exacte si une base en contient.
async function migrateTaxeDevisLignesVersAccountTax() {
  const { rows: [{ exists: colonneExiste }] } = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'devis_lignes' AND column_name = 'taux_taxe'
    ) AS exists
  `);
  if (!colonneExiste) {
    console.log('ℹ️  account_tax : colonne devis_lignes.taux_taxe déjà absente — bascule déjà effectuée, étape ignorée.');
    return;
  }

  try {
    await client.query('BEGIN');

    const { rows: [{ count: nbLignesAffectees }] } = await client.query(
      `SELECT COUNT(*) FROM devis_lignes WHERE taux_taxe IS NOT NULL AND taux_taxe <> 0`
    );

    // Un couple (entreprise, taux) distinct = une taxe account_tax. entreprise_id vient du
    // devis parent (devis_lignes n'a pas de colonne entreprise_id propre).
    const { rows: couples } = await client.query(`
      SELECT DISTINCT d.entreprise_id AS "entrepriseId", dl.taux_taxe AS "taux"
      FROM devis_lignes dl
      JOIN devis d ON d.id = dl.devis_id
      WHERE dl.taux_taxe IS NOT NULL AND dl.taux_taxe <> 0
    `);

    for (const { entrepriseId, taux } of couples) {
      // Nom lisible aligné sur le taux ; le % est formaté sans décimale superflue.
      const tauxNum = Number(taux);
      const nom = `TVA ${Number.isInteger(tauxNum) ? tauxNum : tauxNum.toString()} %`;
      const { rows: [{ id: taxId }] } = await client.query(`
        INSERT INTO account_tax (entreprise_id, name, type_tax_use, amount_type, amount, sequence)
        VALUES ($1, $2, 'sale', 'percent', $3, 1)
        ON CONFLICT (entreprise_id, name) DO UPDATE SET amount_type = EXCLUDED.amount_type
        RETURNING id
      `, [entrepriseId, nom, tauxNum]);

      await client.query(`
        INSERT INTO devis_lignes_taxes (devis_ligne_id, tax_id)
        SELECT dl.id, $1
        FROM devis_lignes dl
        JOIN devis d ON d.id = dl.devis_id
        WHERE d.entreprise_id = $2 AND dl.taux_taxe = $3
        ON CONFLICT (devis_ligne_id, tax_id) DO NOTHING
      `, [taxId, entrepriseId, tauxNum]);
    }

    // Vérification avant COMMIT : chaque ligne convertie doit avoir exactement une taxe liée
    // dont amount == l'ancien taux_taxe. Une taxe unique 'percent' est strictement équivalente
    // à l'ancien facteur (1 + taux/100), donc les totaux stockés (recalculés seulement au PUT)
    // restent corrects — pas de réécriture de devis.total nécessaire.
    const { rows: [{ count: nonMigrees }] } = await client.query(`
      SELECT COUNT(*) FROM devis_lignes dl
      WHERE dl.taux_taxe IS NOT NULL AND dl.taux_taxe <> 0
        AND NOT EXISTS (
          SELECT 1 FROM devis_lignes_taxes dlt
          JOIN account_tax at ON at.id = dlt.tax_id
          WHERE dlt.devis_ligne_id = dl.id AND at.amount = dl.taux_taxe
        )
    `);
    if (Number(nonMigrees) > 0) {
      throw new Error(`Vérification account_tax échouée : ${nonMigrees} ligne(s) avec taux_taxe non reliées à une taxe équivalente.`);
    }

    await client.query('ALTER TABLE devis_lignes DROP COLUMN taux_taxe');
    await client.query('COMMIT');
    console.log(`✅ account_tax : ${nbLignesAffectees} ligne(s) reliées à ${couples.length} taxe(s). Colonne devis_lignes.taux_taxe supprimée.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// ═══════════════ RH complète — amorçage des données dérivées ═══════════════
// Ces trois fonctions ne retirent aucune colonne (contrairement à migrateRemiseToPourcentage
// etc.) : elles se contentent de peupler les nouvelles structures à partir de l'existant.
// Idempotentes : chacune ne touche que les lignes pas encore migrées.

// CONGES_TYPES_DEFAUT et PAYMENT_TERMS_DEFAUT (conditions de paiement par défaut, étape 0
// Comptabilité) : importés de utils/referentielsDefaut.js, source partagée avec l'inscription.

// Crée les conditions de paiement par défaut pour toute entreprise qui n'en a aucune.
async function seedPaymentTermsForExistingEntreprises() {
  const { rows: entreprises } = await client.query(
    `SELECT e.id FROM entreprises e
     WHERE NOT EXISTS (SELECT 1 FROM payment_terms pt WHERE pt.entreprise_id = e.id)`
  );
  for (const { id } of entreprises) {
    for (const term of PAYMENT_TERMS_DEFAUT) {
      const { rows } = await client.query(
        `INSERT INTO payment_terms (entreprise_id, name, sequence)
         VALUES ($1, $2, $3) ON CONFLICT (entreprise_id, name) DO NOTHING RETURNING id`,
        [id, term.name, term.sequence]
      );
      if (!rows[0]) continue;
      for (const l of term.lines) {
        await client.query(
          `INSERT INTO payment_term_lines (payment_term_id, value, value_amount, delay_type, nb_days, ordre)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [rows[0].id, l.value, l.value_amount, l.delay_type, l.nb_days, l.ordre]
        );
      }
    }
  }
  if (entreprises.length > 0) {
    console.log(`✅ Conditions de paiement par défaut créées pour ${entreprises.length} entreprise(s).`);
  }
}

// Module Pisciculture : les entreprises déjà existantes n'ont pas ces 4 catégories tant
// qu'elles n'activent pas le module — les créer par avance pour que StocksTab ait de quoi
// travailler dès la première activation (mirroir de seedPaymentTermsForExistingEntreprises
// ci-dessus). Les nouvelles inscriptions les reçoivent déjà via
// CATEGORIES_PRODUITS_PAR_DEFAUT dans routes/auth.js.
async function seedPiscicultureCategoriesForExistingEntreprises() {
  const { rows: entreprises } = await client.query(
    `SELECT e.id FROM entreprises e
     WHERE NOT EXISTS (SELECT 1 FROM produit_categories pc WHERE pc.entreprise_id = e.id AND pc.module = 'Pisciculture')`
  );
  for (const { id } of entreprises) {
    for (const cat of CATEGORIES_PAR_DEFAUT.filter((c) => c.module === 'Pisciculture')) {
      await client.query(
        `INSERT INTO produit_categories (entreprise_id, module, nom, ordre) VALUES ($1, $2, $3, $4)
         ON CONFLICT (entreprise_id, module, nom) DO NOTHING`,
        [id, cat.module, cat.nom, cat.ordre]
      );
    }
  }
  if (entreprises.length > 0) {
    console.log(`✅ Pisciculture : catégories par défaut créées pour ${entreprises.length} entreprise(s).`);
  } else {
    console.log('ℹ️  Pisciculture : rien à créer (déjà fait).');
  }
}

// Étape 2 Comptabilité : crée le plan de comptes + les journaux par défaut pour toute
// entreprise qui n'a aucun journal. Idempotent (garde sur l'absence de account_journal +
// ON CONFLICT DO NOTHING sur les deux tables). Mêmes listes que routes/auth.js (seed à
// l'inscription) via utils/comptaDefauts.js.
// Renommage du journal de vente INV → FAC (2026-09-11) : le code du journal EST le préfixe du
// numéro de pièce, et l'application est francophone.
//
// Deux règles non négociables ici :
//   1. Les pièces DÉJÀ ÉMISES gardent leur numéro INV/… — jamais renommées. Une pièce émise a
//      une valeur légale, et son `name` entre dans le hachage d'inaltérabilité
//      (utils/accountMove.js:chaineIntegriteMove) : les réécrire romprait la chaîne de
//      sécurisation des journaux verrouillés.
//   2. Le compteur doit être REPORTÉ. account_journal_sequence est indexée par préfixe : sans
//      report, la première facture après migration s'appellerait FAC/2026/0001 alors que
//      INV/2026/0001 existe déjà — deux pièces perçues comme « numéro 1 » du même exercice.
//
// Les anciennes lignes INV/… de la séquence sont conservées : plus jamais consultées (le
// préfixe dérive du code), elles gardent la trace du point d'arrêt.
async function renommerJournalVenteVersFac() {
  const { rows: journaux } = await client.query(
    `SELECT j.id, j.entreprise_id FROM account_journal j
      WHERE j.code = 'INV' AND j.type = 'sale'
        AND NOT EXISTS (SELECT 1 FROM account_journal f
                         WHERE f.entreprise_id = j.entreprise_id AND f.code = 'FAC')`
  );
  for (const j of journaux) {
    await client.query(
      `INSERT INTO account_journal_sequence (journal_id, prefix, last_number)
       SELECT s.journal_id, 'FAC/' || split_part(s.prefix, '/', 2) || '/', s.last_number
         FROM account_journal_sequence s
        WHERE s.journal_id = $1 AND s.prefix LIKE 'INV/%'
       ON CONFLICT (journal_id, prefix) DO UPDATE
         SET last_number = GREATEST(account_journal_sequence.last_number, EXCLUDED.last_number)`,
      [j.id]
    );
    await client.query(
      `INSERT INTO account_journal_sequence (journal_id, prefix, last_number)
       SELECT s.journal_id, 'RFAC/' || split_part(s.prefix, '/', 2) || '/', s.last_number
         FROM account_journal_sequence s
        WHERE s.journal_id = $1 AND s.prefix LIKE 'RINV/%'
       ON CONFLICT (journal_id, prefix) DO UPDATE
         SET last_number = GREATEST(account_journal_sequence.last_number, EXCLUDED.last_number)`,
      [j.id]
    );
    await client.query("UPDATE account_journal SET code = 'FAC' WHERE id = $1", [j.id]);
  }
  if (journaux.length > 0) {
    console.log(`✅ Journal de vente renommé INV → FAC pour ${journaux.length} entreprise(s), compteur reporté.`);
  } else {
    console.log('ℹ️  Journal de vente : déjà FAC (ou renommage impossible, un journal FAC existe).');
  }
}

async function seedComptaConfigForExistingEntreprises() {
  const { rows: entreprises } = await client.query(
    `SELECT e.id FROM entreprises e
     WHERE NOT EXISTS (SELECT 1 FROM account_journal j WHERE j.entreprise_id = e.id)`
  );
  for (const { id } of entreprises) {
    const compteIdParCode = {};
    for (const c of COMPTES_DEFAUT) {
      const { rows } = await client.query(
        `INSERT INTO account_account (entreprise_id, code, name, account_type, reconcile)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (entreprise_id, code) DO UPDATE SET code = EXCLUDED.code
         RETURNING id`,
        [id, c.code, c.name, c.account_type, c.reconcile]
      );
      compteIdParCode[c.code] = rows[0].id;
    }
    for (const j of JOURNAUX_DEFAUT) {
      await client.query(
        `INSERT INTO account_journal (entreprise_id, name, code, type, sequence, refund_sequence, default_account_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (entreprise_id, code) DO NOTHING`,
        [id, j.name, j.code, j.type, j.sequence, j.refund_sequence,
         j.defaultAccountCode ? compteIdParCode[j.defaultAccountCode] : null]
      );
    }
  }
  if (entreprises.length > 0) {
    console.log(`✅ Plan de comptes + journaux par défaut créés pour ${entreprises.length} entreprise(s).`);
  }
}

// Multi-devise réel, étape 4 : les deux nouveaux comptes (Gains/Pertes de change) ajoutés à
// COMPTES_DEFAUT n'existent pas encore pour une entreprise déjà configurée avant cette étape —
// seedComptaConfigForExistingEntreprises ci-dessus ne les rattrape pas (son garde-fou
// `NOT EXISTS (account_journal)` ne se redéclenche que pour une entreprise sans AUCUN
// journal, donc jamais pour une entreprise déjà passée par l'étape 2 Comptabilité). Backfill
// dédié, ne touche que ces deux codes, idempotent.
async function seedComptesChangeForExistingEntreprises() {
  const comptesChange = COMPTES_DEFAUT.filter((c) => ['768000', '668000'].includes(c.code));
  const { rows: entreprises } = await client.query('SELECT id FROM entreprises');
  let compte = 0;
  for (const { id } of entreprises) {
    for (const c of comptesChange) {
      const { rowCount } = await client.query(
        `INSERT INTO account_account (entreprise_id, code, name, account_type, reconcile)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (entreprise_id, code) DO NOTHING`,
        [id, c.code, c.name, c.account_type, c.reconcile]
      );
      compte += rowCount;
    }
  }
  if (compte > 0) {
    console.log(`✅ Comptes Gains/Pertes de change créés pour ${entreprises.length} entreprise(s) (${compte} lignes).`);
  } else {
    console.log('ℹ️  Comptes Gains/Pertes de change : déjà présents partout.');
  }
}

// Étape 1 alignement Odoo produit/stock : crée les catégories d'unités de mesure + unités
// par défaut pour toute entreprise qui n'en a aucune. Même liste que routes/auth.js (seed
// à l'inscription) via utils/unitesMesureDefaut.js.
async function seedUnitesMesureForExistingEntreprises() {
  const { rows: entreprises } = await client.query(
    `SELECT e.id FROM entreprises e
     WHERE NOT EXISTS (SELECT 1 FROM unites_mesure_categories c WHERE c.entreprise_id = e.id)`
  );
  for (const { id } of entreprises) {
    for (const cat of UNITES_MESURE_DEFAUT) {
      const { rows } = await client.query(
        `INSERT INTO unites_mesure_categories (entreprise_id, nom) VALUES ($1, $2)
         ON CONFLICT (entreprise_id, nom) DO NOTHING RETURNING id`,
        [id, cat.categorie]
      );
      if (!rows[0]) continue;
      for (const u of cat.unites) {
        await client.query(
          `INSERT INTO unites_mesure (entreprise_id, categorie_id, nom, symbole, facteur, est_reference)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, rows[0].id, u.nom, u.symbole, u.facteur, u.estReference]
        );
      }
    }
  }
  if (entreprises.length > 0) {
    console.log(`✅ Unités de mesure par défaut créées pour ${entreprises.length} entreprise(s).`);
  }
}

// Étape 1 alignement Odoo produit/stock : relie chaque produits.unite (texte libre) encore
// non résolu à une unites_mesure de son entreprise — par correspondance insensible à la
// casse sur le nom ou le symbole, sinon création d'une unité de secours dans une catégorie
// « Autre » (créée si besoin) avec un facteur de 1 (aucune conversion connue possible pour
// une unité inventée à la volée par un utilisateur). Ne touche que les produits dont
// unite_id est encore NULL — relançable sans effet une fois tout résolu.
async function backfillProduitsUniteId() {
  const { rows: aResoudre } = await client.query(
    `SELECT id, entreprise_id, unite FROM produits
     WHERE unite_id IS NULL AND unite IS NOT NULL AND unite <> ''`
  );
  if (aResoudre.length === 0) {
    console.log('ℹ️  produits.unite_id : rien à relier (aucune unité texte non résolue).');
    return;
  }
  const autreCategorieIdParEntreprise = {};
  let resolus = 0;
  for (const p of aResoudre) {
    const { rows: match } = await client.query(
      `SELECT id FROM unites_mesure
       WHERE entreprise_id = $1 AND (LOWER(nom) = LOWER($2) OR LOWER(symbole) = LOWER($2))
       LIMIT 1`,
      [p.entreprise_id, p.unite.trim()]
    );
    let uniteId = match[0]?.id;
    if (!uniteId) {
      let autreCategorieId = autreCategorieIdParEntreprise[p.entreprise_id];
      if (!autreCategorieId) {
        const { rows } = await client.query(
          `INSERT INTO unites_mesure_categories (entreprise_id, nom) VALUES ($1, 'Autre')
           ON CONFLICT (entreprise_id, nom) DO UPDATE SET nom = EXCLUDED.nom RETURNING id`,
          [p.entreprise_id]
        );
        autreCategorieId = rows[0].id;
        autreCategorieIdParEntreprise[p.entreprise_id] = autreCategorieId;
      }
      const { rows: created } = await client.query(
        `INSERT INTO unites_mesure (entreprise_id, categorie_id, nom, symbole, facteur, est_reference)
         VALUES ($1, $2, $3, $3, 1, FALSE)
         ON CONFLICT (entreprise_id, categorie_id, nom) DO UPDATE SET nom = EXCLUDED.nom
         RETURNING id`,
        [p.entreprise_id, autreCategorieId, p.unite.trim()]
      );
      uniteId = created[0].id;
    }
    await client.query('UPDATE produits SET unite_id = $1 WHERE id = $2', [uniteId, p.id]);
    resolus++;
  }
  console.log(`✅ produits.unite_id relié pour ${resolus} produit(s).`);
}

// Étape 2 alignement Odoo produit/stock : crée un gabarit à variante unique pour chaque
// produit existant sans template_id (nom/catégorie/module copiés depuis la variante) — un
// product.product n'existe jamais sans product.template. Ne touche que les produits dont
// template_id est encore NULL, relançable sans effet une fois tout résolu.
async function backfillProduitsTemplates() {
  const { rows: aResoudre } = await client.query(
    `SELECT id, entreprise_id, module, nom, categorie_id FROM produits WHERE template_id IS NULL`
  );
  if (aResoudre.length === 0) {
    console.log('ℹ️  produit_templates : rien à créer (tous les produits ont déjà un gabarit).');
    return;
  }
  for (const p of aResoudre) {
    const { rows: [tpl] } = await client.query(
      `INSERT INTO produit_templates (entreprise_id, module, nom, categorie_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [p.entreprise_id, p.module, p.nom, p.categorie_id]
    );
    await client.query('UPDATE produits SET template_id = $1 WHERE id = $2', [tpl.id, p.id]);
  }
  console.log(`✅ produit_templates rétroactifs créés pour ${aResoudre.length} produit(s) existants.`);
}

// Étape 3 alignement Odoo produit/stock : crée les 4 emplacements de stock par défaut pour
// toute entreprise qui n'en a aucun. Même liste que routes/auth.js (seed à l'inscription) via
// utils/emplacementsStockDefaut.js.
async function seedEmplacementsStockForExistingEntreprises() {
  const { rows: entreprises } = await client.query(
    `SELECT e.id FROM entreprises e
     WHERE NOT EXISTS (SELECT 1 FROM emplacements_stock es WHERE es.entreprise_id = e.id)`
  );
  for (const { id } of entreprises) {
    for (const e of EMPLACEMENTS_STOCK_DEFAUT) {
      await client.query(
        `INSERT INTO emplacements_stock (entreprise_id, nom, type, par_defaut) VALUES ($1, $2, $3, $4)
         ON CONFLICT (entreprise_id, nom) DO NOTHING`,
        [id, e.nom, e.type, e.type === 'interne']
      );
    }
  }
  if (entreprises.length > 0) {
    console.log(`✅ Emplacements de stock par défaut créés pour ${entreprises.length} entreprise(s).`);
  }
}

// Backfill d'un emplacement virtuel ajouté après coup, appelé une fois par type concerné
// (« Production » 2026-09-06, « Ajustements d'inventaire » 2026-09-10). Le garde-fou de
// seedEmplacementsStockForExistingEntreprises ci-dessus (NOT EXISTS *aucun* emplacement) ne se
// redéclenche jamais pour une entreprise déjà seedée, donc virtuellement toutes. Même idiome que
// seedComptesChangeForExistingEntreprises (multi-devise étape 4).
// Transferts (2026-09-10) : marque l'emplacement interne existant comme défaut. Les
// entreprises créées avant cette étape n'en ont qu'un — c'est donc lui, sans ambiguïté.
async function backfillEmplacementInterneParDefaut() {
  const { rowCount } = await client.query(
    `UPDATE emplacements_stock e SET par_defaut = TRUE
      WHERE e.type = 'interne' AND NOT e.par_defaut
        AND NOT EXISTS (SELECT 1 FROM emplacements_stock d
                         WHERE d.entreprise_id = e.entreprise_id AND d.par_defaut)
        AND e.id = (SELECT MIN(x.id) FROM emplacements_stock x
                     WHERE x.entreprise_id = e.entreprise_id AND x.type = 'interne')`
  );
  if (rowCount > 0) {
    console.log(`✅ Emplacement interne par défaut marqué pour ${rowCount} entreprise(s).`);
  } else {
    console.log('ℹ️  Emplacement interne par défaut : déjà défini partout.');
  }
}

async function seedEmplacementTypePourEntreprisesExistantes(type) {
  const modele = EMPLACEMENTS_STOCK_DEFAUT.find((e) => e.type === type);
  const { rows: entreprises } = await client.query(
    `SELECT e.id FROM entreprises e
     WHERE NOT EXISTS (SELECT 1 FROM emplacements_stock es WHERE es.entreprise_id = e.id AND es.type = $1)`,
    [type]
  );
  for (const { id } of entreprises) {
    await client.query(
      `INSERT INTO emplacements_stock (entreprise_id, nom, type, par_defaut) VALUES ($1, $2, $3, $4)
       ON CONFLICT (entreprise_id, nom) DO NOTHING`,
      [id, modele.nom, modele.type, modele.type === 'interne']
    );
  }
  if (entreprises.length > 0) {
    console.log(`✅ Emplacement « ${modele.nom} » créé pour ${entreprises.length} entreprise(s).`);
  } else {
    console.log(`ℹ️  Emplacement « ${modele.nom} » : déjà présent partout.`);
  }
}

// Étape 3 alignement Odoo produit/stock : initialise un stock_quants à l'emplacement interne
// pour chaque produit qui n'en a pas encore (quantite = produits.quantite actuel, reservee = 0),
// puis reconstitue les réservations en cours depuis les devis déjà signés/facturés (tout statut
// hors Brouillon/Devis/Envoyé/Annulé — ce sont les seuls à ne jamais avoir appelé
// applyVenteLignesToStock). Ne convertit pas un éventuel uom_id de ligne différent de l'unité
// de base du produit (cas marginal, jamais rencontré en pratique) : la quantité de ligne brute
// est utilisée telle quelle — écart possible mais sans risque, une libération ultérieure
// clippe toujours à 0 (GREATEST) plutôt que de passer en négatif. Relançable sans effet
// indésirable : la création de quant est un NOT EXISTS, la reconstitution de réservation
// recalcule à chaque fois la valeur absolue exacte depuis les devis en cours.
async function backfillStockQuants() {
  const { rows: entreprises } = await client.query(
    `SELECT e.id AS "entrepriseId", es.id AS "emplacementInterneId" FROM entreprises e
     JOIN emplacements_stock es ON es.entreprise_id = e.id AND es.type = 'interne'`
  );
  let produitsInitialises = 0;
  for (const { entrepriseId, emplacementInterneId } of entreprises) {
    const { rows: produits } = await client.query(
      `SELECT p.id, p.quantite::float8 AS quantite FROM produits p
       WHERE p.entreprise_id = $1
         AND NOT EXISTS (SELECT 1 FROM stock_quants q WHERE q.produit_id = p.id AND q.emplacement_id = $2)`,
      [entrepriseId, emplacementInterneId]
    );
    for (const p of produits) {
      await client.query(
        `INSERT INTO stock_quants (entreprise_id, produit_id, emplacement_id, quantite, quantite_reservee)
         VALUES ($1, $2, $3, $4, 0)`,
        [entrepriseId, p.id, emplacementInterneId, p.quantite]
      );
      produitsInitialises++;
    }

    const { rows: reserves } = await client.query(
      `SELECT dl.stock_id AS "produitId", SUM(dl.quantite)::float8 AS total
       FROM devis_lignes dl JOIN devis d ON d.id = dl.devis_id
       WHERE d.entreprise_id = $1 AND dl.stock_id IS NOT NULL
         AND d.statut NOT IN ('Brouillon', 'Devis', 'Envoyé', 'Annulé')
       GROUP BY dl.stock_id`,
      [entrepriseId]
    );
    for (const r of reserves) {
      await client.query(
        `UPDATE stock_quants SET quantite_reservee = $1 WHERE produit_id = $2 AND emplacement_id = $3`,
        [r.total, r.produitId, emplacementInterneId]
      );
    }
  }
  if (produitsInitialises > 0) {
    console.log(`✅ stock_quants initiaux créés pour ${produitsInitialises} produit(s), réservations reconstituées depuis les devis en cours.`);
  } else {
    console.log('ℹ️  stock_quants : rien à initialiser (déjà fait).');
  }
}

// Abonnement Phase 1 (2026-09-04) : grand-père toute entreprise déjà en base (trial_ends_at
// IS NULL = proxy « ligne antérieure au modèle d'abonnement ») en 'active' pendant 1 an, PUIS
// exempte les entreprises du/des platform-admin (ordre important : l'exemption doit s'appliquer
// après le grand-père générique, sinon la seconde UPDATE n'aurait rien à corriger — un
// platform-admin s'inscrit comme n'importe qui, is_platform_admin est basculé à la main après
// coup). Relançable sans effet une fois fait : le WHERE trial_ends_at IS NULL ne retrouve plus
// aucune ligne après le premier passage (chaque nouvelle inscription pose trial_ends_at).
// Désigne le propriétaire de chaque entreprise : le compte qui l'a ouverte, c'est-à-dire le plus
// ancien utilisateur rattaché. Il restera le maître — aucune restriction ne lui est opposable.
async function backfillProprietaireEntreprise() {
  const { rowCount } = await client.query(
    `UPDATE entreprises e
        SET proprietaire_user_id = premier.user_id
       FROM (
         SELECT DISTINCT ON (entreprise_id) entreprise_id, user_id
           FROM entreprise_utilisateurs ORDER BY entreprise_id, id ASC
       ) premier
      WHERE premier.entreprise_id = e.id AND e.proprietaire_user_id IS NULL`
  );
  if (rowCount > 0) {
    console.log(`✅ Propriétaires : ${rowCount} entreprise(s) rattachée(s) à leur compte créateur.`);
  } else {
    console.log('ℹ️  Propriétaires : rien à rattacher (déjà fait).');
  }
}

// Nettoyage unique : une première version amorçait six rôles imposés (Administrateur, Ouvrier…)
// avec leurs permissions. L'application ne doit imposer aucune politique — chaque entreprise part
// d'une page blanche. Ces rôles n'ont jamais servi (le garde est en observation, aucun écran ne
// permettait de les modifier), donc les retirer restaure l'état antérieur sans rien perdre.
async function nettoyerRolesImposes() {
  const { rowCount } = await client.query(
    `DELETE FROM roles r
      WHERE NOT EXISTS (SELECT 1 FROM role_restrictions rr WHERE rr.role_id = r.id)
        AND r.nom IN ('Administrateur','Directeur','Gestionnaire','Comptable','Assistant(e) de direction','Ouvrier')`
  );
  if (rowCount > 0) {
    console.log(`✅ Rôles imposés : ${rowCount} rôle(s) amorcé(s) d'office retiré(s) — page blanche.`);
  } else {
    console.log('ℹ️  Rôles imposés : rien à retirer.');
  }
}

async function seedAbonnementBackfill() {
  const { rowCount: grandpere } = await client.query(
    `UPDATE entreprises
        SET subscription_status = 'active',
            activated_at        = COALESCE(activated_at, now()),
            activated_until     = COALESCE(activated_until, now() + interval '1 year')
      WHERE trial_ends_at IS NULL
        AND subscription_status = 'trial'`
  );
  const { rowCount: exemptees } = await client.query(
    `UPDATE entreprises SET subscription_status = 'exempt'
      WHERE id IN (SELECT entreprise_id FROM entreprise_utilisateurs eu
                   JOIN users u ON u.id = eu.user_id WHERE u.is_platform_admin = true)
        AND subscription_status <> 'exempt'`
  );
  if (grandpere > 0 || exemptees > 0) {
    console.log(`✅ Abonnement : ${grandpere} entreprise(s) grand-périsée(s) en 'active' (1 an), ${exemptees} exemptée(s) (platform-admin).`);
  } else {
    console.log("ℹ️  Abonnement : rien à grand-périser (déjà fait).");
  }
}

// Blocage d'accès par module (2026-09-07) : grand-père toute entreprise dont
// modules_actifs_initialises est encore FALSE (jamais configuré explicitement) en activant
// les 3 modules payants — sinon une entreprise déjà existante, jusqu'ici jamais bloquée,
// perdrait d'un coup l'accès en écriture à la moitié de l'app. Relançable sans effet une fois
// fait : modules_actifs_initialises passe à TRUE ici, donc le WHERE ne retrouve plus la ligne
// ensuite — et une entreprise qui choisit plus tard de tout désactiver reste bien à '{}'
// (modules_actifs_initialises déjà TRUE ne la fait plus jamais retomber ici).
async function seedModulesActifsBackfill() {
  const { rowCount } = await client.query(
    `UPDATE entreprises
        SET modules_actifs = '{"cultures":true,"poulailler":true,"pisciculture":true}'::jsonb,
            modules_actifs_initialises = TRUE
      WHERE modules_actifs_initialises = FALSE`
  );
  if (rowCount > 0) {
    console.log(`✅ Modules payants : ${rowCount} entreprise(s) grand-périsée(s) (3 modules activés).`);
  } else {
    console.log('ℹ️  Modules payants : rien à grand-périser (déjà fait).');
  }
}

// Crée les 4 types de congés par défaut pour toute entreprise qui n'en a aucun.
async function seedCongesTypesForExistingEntreprises() {
  const { rows: entreprises } = await client.query(
    `SELECT e.id FROM entreprises e
     WHERE NOT EXISTS (SELECT 1 FROM conges_types ct WHERE ct.entreprise_id = e.id)`
  );
  for (const { id } of entreprises) {
    for (const t of CONGES_TYPES_DEFAUT) {
      await client.query(
        `INSERT INTO conges_types (entreprise_id, nom, paye, justificatif_requis, couleur, ordre)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (entreprise_id, nom) DO NOTHING`,
        [id, t.nom, t.paye, t.justificatif_requis, t.couleur, t.ordre]
      );
    }
  }
  if (entreprises.length > 0) {
    console.log(`✅ Types de congés par défaut créés pour ${entreprises.length} entreprise(s).`);
  }
}

// Crée un `postes` par intitulé distinct déjà présent dans salaries.poste, puis relie
// salaries.poste_id. Ne touche que les salariés dont poste_id est encore NULL.
async function migratePostesFromSalaries() {
  const { rowCount } = await client.query(
    `SELECT 1 FROM salaries WHERE poste IS NOT NULL AND poste <> '' AND poste_id IS NULL LIMIT 1`
  );
  if (rowCount === 0) {
    console.log('ℹ️  Postes : rien à migrer (tous les salariés avec un poste ont déjà un poste_id).');
    return;
  }
  await client.query(`
    INSERT INTO postes (entreprise_id, intitule)
    SELECT DISTINCT s.entreprise_id, s.poste
    FROM salaries s
    WHERE s.poste IS NOT NULL AND s.poste <> ''
    ON CONFLICT (entreprise_id, intitule) DO NOTHING
  `);
  const { rowCount: relies } = await client.query(`
    UPDATE salaries s SET poste_id = p.id
    FROM postes p
    WHERE p.entreprise_id = s.entreprise_id AND p.intitule = s.poste
      AND s.poste IS NOT NULL AND s.poste <> '' AND s.poste_id IS NULL
  `);
  console.log(`✅ Postes : ${relies} salarié(s) relié(s) à un poste référentiel.`);
}

// Amorce un contrat 'CDI' actif par salarié ayant un salaire mais aucun contrat.
async function migrateContratsFromSalaries() {
  const { rowCount: inserted } = await client.query(`
    INSERT INTO salaries_contrats (entreprise_id, salarie_id, type, date_debut, salaire, actif)
    SELECT s.entreprise_id, s.id, 'CDI', s.date_embauche, s.salaire, TRUE
    FROM salaries s
    WHERE s.salaire IS NOT NULL AND s.salaire <> 0
      AND NOT EXISTS (SELECT 1 FROM salaries_contrats c WHERE c.salarie_id = s.id)
  `);
  if (inserted > 0) {
    console.log(`✅ Contrats : ${inserted} contrat(s) CDI amorcé(s) depuis le salaire existant.`);
  } else {
    console.log('ℹ️  Contrats : rien à amorcer.');
  }
}

// Toute la variable SQL ci-dessus est envoyée en un seul `query()` — PostgreSQL exécute
// les instructions séparées par `;` dans l'ordre au sein d'une même requête multi-instructions
// (pas de vraie transaction globale explicite ici : une instruction en échec arrête tout,
// mais celles déjà exécutées avant elle restent appliquées, sans rollback automatique).
// Idempotent par construction (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS partout) : peut
// être relancé sans risque sur une base déjà à jour, ce qui en fait le seul mécanisme de
// migration du projet (pas de système de versions/migrations numérotées séparées).
async function migrate() {
  try {
    await client.connect();
    console.log('✅ Connecté à PostgreSQL');
    await client.query(SQL);
    console.log('✅ Tables Cultures + Poulailler créées, et cloisonnement par utilisateur (user_id) appliqué partout.');
    await mergeStocksIntoProduits();
    await mergeClientsFournisseursIntoContacts();
    await migrateClientPrixToListesPrix();
    await migrateRemiseToPourcentage();
    await migrateTaxeDevisVersLignes();
    await migrateTaxeDevisLignesVersAccountTax();
    await seedComptaConfigForExistingEntreprises();
    await renommerJournalVenteVersFac();
    await seedComptesChangeForExistingEntreprises();
    await seedCongesTypesForExistingEntreprises();
    await seedPaymentTermsForExistingEntreprises();
    await seedPiscicultureCategoriesForExistingEntreprises();
    await seedUnitesMesureForExistingEntreprises();
    await backfillProduitsUniteId();
    await backfillProduitsTemplates();
    await seedEmplacementsStockForExistingEntreprises();
    await seedEmplacementTypePourEntreprisesExistantes('production');
    await seedEmplacementTypePourEntreprisesExistantes('inventaire');
    await backfillEmplacementInterneParDefaut();
    await backfillStockQuants();
    await backfillProprietaireEntreprise();
    await nettoyerRolesImposes();
    await seedAbonnementBackfill();
    await seedModulesActifsBackfill();
    await migratePostesFromSalaries();
    await migrateContratsFromSalaries();
  } catch (err) {
    console.error('❌ Erreur de migration :', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();