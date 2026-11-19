# Migrations de la base

Chaque changement de schéma ou de données = **un nouveau fichier** dans ce dossier.
Il est appliqué une seule fois par base, dans une transaction, par
`node src/db/migrate.js` (depuis `server/`), puis enregistré dans la table
`schema_migrations`.

## Nommer le fichier

`NNNN_ce_que_ca_fait.sql` ou `NNNN_ce_que_ca_fait.js` : numéro sur 4 chiffres, le
suivant du plus grand existant, puis un nom en minuscules avec `_`.
Exemple : `0001_devis_date_expiration.sql`. La version `0000` est réservée au socle
(`../socle.js`).

- **`.sql`** : pour un changement de schéma simple.
- **`.js`** : quand il faut du code (rattrapage de données par entreprise, valeurs
  par défaut importées de `utils/`). Le fichier exporte
  `export async function up(client) { … }` et n'utilise que le `client` reçu
  (il est déjà dans une transaction : pas de `BEGIN`/`COMMIT`).

## Règles

- **Ne jamais modifier une migration déjà fusionnée**, ni le socle. Son empreinte
  est enregistrée : la modifier fait échouer `migrate.js` sur toutes les bases qui
  l'ont déjà appliquée. Pour corriger, ajouter une nouvelle migration.
- Écrire des migrations qui supposent l'état laissé par les précédentes (pas besoin
  de `IF NOT EXISTS` partout), mais qui ne cassent pas une base remplie : prévoir
  une valeur par défaut pour une colonne `NOT NULL` ajoutée, rattraper les lignes
  existantes.
- Pas de retour en arrière automatique (`down`) : un déploiement annulé laisse les
  colonnes ajoutées en place (sans effet sur l'ancien code). Pour annuler un
  changement cassant, restaurer la sauvegarde d'avant le déploiement.
- **Valeurs par défaut des entreprises** (`utils/*Defaut.js` : comptes, journaux,
  unités, emplacements, catégories, types de congés, conditions de paiement) : en
  ajouter une ne la crée que pour les **nouvelles** entreprises (inscription). Le
  socle ne tourne plus à chaque déploiement : pour les entreprises existantes,
  écrire une migration `.js` qui fait le rattrapage.
- Une instruction impossible en transaction (`CREATE INDEX CONCURRENTLY`) n'est pas
  prise en charge pour l'instant : en parler avant.
- Tester : `npm run test:integration` recrée la base de test et applique tout
  (socle + migrations) depuis zéro.
