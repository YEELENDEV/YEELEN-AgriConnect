# Déploiement en production — YEELEN AgriConnect

Cible retenue (décision 2026-08-13) : **un VPS unique** (DigitalOcean Droplet)
faisant tourner la stack `docker-compose` existante, avec **Caddy** en frontal
pour le HTTPS automatique (Let's Encrypt). Pas de Kubernetes, pas de service
managé, pas de CDN. C'est la procédure du Jalon 4 (*Mise en production*) de la
feuille de route — voir `CLAUDE.md` pour le contexte produit complet.

**État de la config (2026-09-03)** : `docker-compose.prod.yml` et le
`Caddyfile` sont écrits, committés et **vérifiés localement** (voir
`docs/journal.md`, entrées du 2026-08-13/2026-08-16/2026-09-03) — Caddy
démarre, sert en HTTPS, route `/api/*` vers le backend et le reste vers le
frontend, et le fallback sur son CA local en l'absence d'un vrai domaine
confirme que la config est correcte. **Rien n'est hébergé publiquement** :
bloqué sur la création d'un compte DigitalOcean/Droplet et l'achat d'un nom de
domaine — décisions et achats qu'un agent ne fait pas à la place de quelqu'un
(voir [[project_hosting_budget_blocked]] dans la mémoire du projet). Les
étapes marquées **[toi]** ci-dessous ne peuvent pas être faites à ta place
(compte, paiement, accès SSH) ; ce runbook prépare le reste pour que, une fois
ces deux étapes faites, aller en ligne n'ait rien à improviser.

## Vue d'ensemble de l'architecture de prod

```
Internet ──HTTPS──▶ Caddy (80/443) ──┬─▶ /api/*  ──▶ backend:4000 (Express)
                                      └─▶ /*       ──▶ frontend:80 (nginx, SPA)
                                                          │
                                                    db:5432 (Postgres, réseau interne uniquement)
                                                          │
                                                    backup (pg_dump périodique, réseau interne)
```

Seul Caddy publie des ports sur l'extérieur (`80`/`443`) : `docker-compose.prod.yml`
retire les mappings de ports de `db`/`backend`/`frontend` (`ports: !reset []`),
donc Postgres et le backend brut ne sont **jamais** exposés directement sur
Internet, contrairement à la config de dev locale (`5433`/`4000`/`8090`
publiés). Caddy obtient et renouvelle automatiquement un certificat Let's
Encrypt pour le domaine configuré — aucune manipulation `certbot` manuelle.

## 1. Prérequis — à faire manuellement **[toi]**

| # | Action | Détail |
|---|--------|--------|
| 1 | Créer un compte DigitalOcean | ou tout autre fournisseur de VPS Ubuntu |
| 2 | Créer un Droplet | Ubuntu 24.04 LTS, **2 Go RAM minimum** (4 Go confortable — le build frontend Vite est gourmand et peut se faire tuer par l'OOM killer en-dessous), 2 vCPU, 50 Go disque. Ajouter ta clé SSH à la création. |
| 3 | Acheter un nom de domaine | ou utiliser un sous-domaine que tu contrôles |
| 4 | Créer l'enregistrement DNS | Un **A record** (ex. `agriconnect.tondomaine.com`) → IP publique du Droplet. Vérifier avec `dig +short agriconnect.tondomaine.com` avant de continuer — doit renvoyer l'IP du Droplet (la propagation peut prendre quelques minutes à quelques heures). |

Caddy ne pourra pas obtenir de certificat Let's Encrypt tant que le DNS ne
pointe pas correctement — il retentera automatiquement en boucle si ce n'est
pas encore propagé, pas besoin de le relancer manuellement.

## 2. Préparer le serveur

En SSH sur le Droplet (`ssh root@IP_DU_DROPLET`) :

```bash
# Docker + plugin compose
apt-get update && apt-get install -y ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Pare-feu : n'ouvrir que SSH + HTTP + HTTPS
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

> **Ne pas** ouvrir 5432/5433/4000/8090 sur le pare-feu : en prod,
> `docker-compose.prod.yml` retire tous les ports publiés sauf ceux de Caddy
> (80/443) — la base et le backend ne sont de toute façon joignables que
> depuis le réseau Docker interne, mais autant ne pas compter uniquement
> là-dessus.

## 3. Récupérer le code et configurer

```bash
git clone https://github.com/GOUSNOO/YEELEN-AgriConnect.git
cd YEELEN-AgriConnect

# Fichiers d'environnement (voir .env.example et server/.env.example)
cp .env.example .env
cp server/.env.example server/.env
```

Éditer **`.env`** :

```ini
DB_USER=agri
DB_PASSWORD=<mot de passe fort — openssl rand -base64 24>
DB_NAME=agri_app
VITE_API_URL=/api                      # URL relative — Caddy sert front + API sur le même domaine
DOMAIN=agriconnect.tondomaine.com      # exactement le domaine du A record
```

Éditer **`server/.env`** :

```ini
DB_HOST=db
DB_PORT=5432
DB_USER=agri
DB_PASSWORD=<le MÊME mot de passe que dans .env>
DB_NAME=agri_app
PORT=4000
JWT_SECRET=<chaîne aléatoire longue — openssl rand -base64 48>
EMAIL_USER=<adresse Gmail, ou laisser vide>
EMAIL_PASS=<mot de passe d'application Gmail, ou laisser vide>
```

- [ ] `DOMAIN` (`.env`) = le domaine pointé à l'étape 1.4, sans `https://`.
- [ ] `DB_USER` / `DB_PASSWORD` / `DB_NAME` — **identiques dans les deux fichiers**, mot de passe généré pour l'occasion (pas celui de dev).
- [ ] `VITE_API_URL=/api` — URL relative, fonctionne quel que soit le domaine choisi (Caddy sert front et API sous le même nom de domaine).
- [ ] `EMAIL_USER` / `EMAIL_PASS` — compte SMTP réel (Gmail + mot de passe d'application, pas le mot de passe du compte), sinon les fonctions email (2FA par email, email de bienvenue employé, envoi de devis) échouent proprement plutôt que de bloquer le reste — le MFA par application (TOTP) fonctionne sans email.
- [ ] `JWT_SECRET` — généré avec `openssl rand -base64 48`, jamais réutilisé d'un environnement à l'autre. À fixer une bonne fois : le changer après coup invalide toutes les sessions ouvertes (tout le monde doit se reconnecter).

> ⚠️ `DB_PASSWORD` doit être **identique** dans les deux fichiers, sinon le
> backend ne peut pas se connecter à Postgres (le conteneur ne démarrera pas).

Les deux fichiers `.env`/`server/.env` réels restent gitignorés — ne jamais
les committer, ne jamais les faire transiter autrement que par SSH/copie
directe sur le Droplet.

## 4. Premier démarrage

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Ceci construit les images `backend`/`frontend` et démarre les 5 services
(`db`, `backend`, `frontend`, `backup`, `caddy`). Suivre les logs le temps que
Caddy obtienne son certificat :

```bash
docker compose logs -f caddy
```

Un message contenant `certificate obtained successfully` confirme que le
HTTPS public fonctionne.

**Journaux du backend** (lot 3b) : en production, une ligne JSON par événement,
avec une ligne d'accès par requête. Chaque ligne écrite pendant une requête porte
son identifiant (`requete`), l'utilisateur et l'entreprise. Quand un utilisateur
signale une erreur « … (réf. a1b2c3d4e5f6) », retrouver tout ce qui s'est passé
pendant cette requête :

```bash
docker compose logs backend | grep a1b2c3d4e5f6
docker compose logs backend --since 1h | grep '"niveau":"error"'   # erreurs de la dernière heure
```

`LOG_LEVEL=warn` dans `server/.env` réduit le volume (plus de lignes d'accès).

## 5. Appliquer les migrations

Le backend **ne migre pas automatiquement au démarrage** (`server.js` vérifie
seulement que Postgres répond, voir `CLAUDE.md`) — sur une base fraîche, les
tables n'existent pas encore tant que ceci n'a pas été lancé :

```bash
docker compose exec backend node src/db/migrate.js
```

Depuis le lot 3a (2026-11-19), les migrations sont **versionnées** : le socle
(`src/db/socle.js`, version 0000) puis chaque fichier de `src/db/migrations/`
est appliqué **une seule fois** et enregistré dans la table `schema_migrations`.
Relancer la commande est sans risque : elle n'applique que ce qui manque.
`node src/db/migrate.js --statut` liste ce qui reste à appliquer sans rien
modifier. Au démarrage, le backend écrit un avertissement `⚠️ Migrations en
attente` dans ses journaux s'il en reste.

Une migration qui échoue est annulée en entier (transaction) et bloque les
suivantes : corriger, puis relancer. Si la commande refuse parce qu'une
migration « a été modifiée après avoir été appliquée », ne pas forcer : le code
déployé ne correspond pas à l'historique de la base.

## 6. Vérifications post-déploiement

- [ ] `curl -sSI https://<DOMAIN>` répond `200`, en HTTPS (pas de warning certificat).
- [ ] `curl -sSI http://<DOMAIN>` répond `308` (redirection automatique vers HTTPS par Caddy).
- [ ] `curl -sS https://<DOMAIN>/api/` répond `{"message":"Backend AgriApp opérationnel 🚜"}` (ou équivalent) — confirme que `/api/*` atteint bien le backend Express, pas une page d'erreur Caddy/nginx.
- [ ] `curl https://<DOMAIN>/api/auth/login -X POST -H 'content-type: application/json' -d '{}'` répond une erreur JSON de validation de l'API.
- [ ] Dans un navigateur : ouvrir le domaine, **créer le premier compte entreprise** via l'onglet « Inscription », se connecter, vérifier qu'un module (Cultures, Comptabilité…) charge sans erreur. Puis supprimer manuellement ces données de test une fois vérifiées (voir la note de nettoyage multi-tables dans `CLAUDE.md`, section "Local dev environment" — les mêmes contraintes `NO ACTION` s'appliquent en prod).
- [ ] `docker compose ps` — les 5 services sont `Up`/`healthy`, aucun en `Restarting`.

## 7. Sauvegardes — vérifier qu'elles tournent réellement

Le service `backup` tourne dès le premier `up` (dépend de `db: healthy`) et
fait un `pg_dump` toutes les 6h dans `./backups`, avec rotation sur les 14
derniers, plus les fichiers sentinelles
`.last_success`/`.last_failure`/`.last_restore_test` (voir `CLAUDE.md`,
section Backups, pour le détail du mécanisme et le bug de dump silencieusement
vide déjà corrigé).

- [ ] Après le premier cycle (6h, ou forcer un cycle manuellement — voir ci-dessous), `backups/.last_success` existe et est récent.
- [ ] `backups/.last_failure` n'existe pas (ou a bien été effacé par le cycle suivant s'il existait d'un cycle précédent).
- [ ] **Copie hors du Droplet mise en place** (DigitalOcean Spaces, `rsync` cron, snapshot de volume…) — un dump qui ne quitte jamais la machine ne protège pas d'une perte du Droplet lui-même. Pas automatisé par le projet à ce stade, à faire manuellement.

Pour forcer un cycle sans attendre 6h (utile juste après le premier déploiement) :

```bash
docker compose exec backup /backup.sh
```

## 8. Test de restauration (drill)

Une sauvegarde qui n'a jamais été restaurée n'est qu'une hypothèse. À faire
une fois juste après la mise en ligne, puis périodiquement (le service
`backup` le fait déjà tout seul chaque semaine via son propre restore-test
automatique — voir `RESTORE_TEST_INTERVAL_HOURS` — mais un drill manuel une
fois, en observant le résultat, vaut la peine avant de faire confiance au
mécanisme automatique) :

```bash
# Dans le conteneur db : restaurer le dump le plus récent dans une base jetable
docker compose exec db sh -c '
  LATEST=$(ls -t /backups/agri_app_*.dump | head -1)
  createdb -U $POSTGRES_USER agri_app_restore_drill
  pg_restore -U $POSTGRES_USER -d agri_app_restore_drill "$LATEST"
  echo "Tables restaurées :"
  psql -U $POSTGRES_USER -d agri_app_restore_drill -c "\dt" | wc -l
  dropdb -U $POSTGRES_USER agri_app_restore_drill
'
```

- [ ] La restauration se termine sans erreur (`pg_restore` peut afficher des warnings sur l'ordre des contraintes, normal — l'échec réel serait un code de sortie non nul).
- [ ] Le nombre de tables restaurées correspond à ce qui est attendu (comparer avec `docker compose exec db psql -U $POSTGRES_USER -d agri_app -c "\dt" | wc -l` sur la vraie base).

## 9. Déployer une mise à jour (routine, après le premier déploiement)

```bash
cd YEELEN-AgriConnect
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose exec backend node src/db/migrate.js   # à chaque déploiement : n'applique que ce qui manque
```

`nginx.conf` a un `Cache-Control` correct sur `index.html` (`no-cache`) et sur
les assets hashés (`immutable`) — un déploiement ne laisse donc pas les
utilisateurs déjà ouverts coincés sur un vieux bundle JS indéfiniment (bug
identifié et corrigé, voir `CLAUDE.md`).

## 10. Rollback

Il n'y a pas de registre d'images ni de tags de versions à ce stade — le
rollback se fait au niveau du code source :

```bash
git log --oneline -10        # identifier le commit/tag stable précédent
git checkout <commit-ou-tag>
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

**Attention aux migrations de schéma** : les migrations n'ont pas de mécanisme
de `down`/rollback (voir `server/src/db/migrations/README.md`). Après un retour
à un code plus ancien, `migrate.js` signale les versions présentes en base mais
inconnues du code, sans bloquer. Si le
déploiement à annuler a ajouté des colonnes/tables, revenir en arrière côté
code ne les supprime pas côté base — dans la grande majorité des cas c'est
inoffensif (colonnes en plus non utilisées par l'ancien code), mais si le
rollback doit annuler un changement de schéma cassant, restaurer plutôt depuis
la sauvegarde la plus récente d'avant le déploiement fautif (voir §8).

## Limites connues de cette cible

- **Instance unique, pas de haute dispo** : une panne du Droplet = service indisponible jusqu'au redémarrage / à la restauration. Acceptable pour un MVP gratuit à faible trafic ; à revoir si l'usage décolle.
- **Base sur le même hôte** que l'app (volume Docker `pgdata`). La restauration repose entièrement sur les dumps du conteneur `backup` + leur copie offsite (voir §7).
- **Pas de CI/CD de déploiement** : la mise à jour est la séquence `git pull` + `up -d --build` du §9, faite à la main en SSH. La CI GitHub Actions ne fait que tester, elle ne déploie pas.
- **Ressources build** : `npm run build` (Vite) sur un Droplet à 1 Go de RAM peut se faire tuer par l'OOM killer — d'où le minimum de 2 Go recommandé au §1. Alternative si besoin : builder l'image ailleurs et la pousser sur un registre plutôt que de builder sur le Droplet lui-même.

## Checklist go-live complète

À cocher dans l'ordre, une seule fois, lors de la vraie mise en production :

- [ ] Compte DigitalOcean créé, carte bancaire ajoutée.
- [ ] Domaine acheté.
- [ ] Droplet créé (§1), IP notée, 2 Go RAM minimum.
- [ ] DNS pointé et propagé, vérifié avec `dig` (§1).
- [ ] Docker + git installés sur le Droplet, pare-feu configuré, dépôt cloné (§2-3).
- [ ] `.env` et `server/.env` remplis avec de vraies valeurs de prod, secrets générés pour l'occasion — pas réutilisés du dev (§3).
- [ ] Premier `docker compose up -d --build` réussi, certificat Let's Encrypt obtenu (§4).
- [ ] Migrations appliquées (§5).
- [ ] Toutes les vérifications post-déploiement passées (§6).
- [ ] Un cycle de sauvegarde forcé confirmé, copie offsite mise en place (§7).
- [ ] Drill de restauration réussi (§8).
- [ ] MFA obligatoire par entreprise — décision produit encore différée (voir `CLAUDE.md`, "MFA enforcement (by-policy)") : reconfirmer avec l'utilisateur si ça doit être tranché avant l'ouverture aux premiers agriculteurs, ou après.
- [ ] Forum de feedback testé en conditions réelles (soumission → triage platform-admin) — fait le 2026-09-03, voir `docs/journal.md`.
- [ ] Annoncer/ouvrir l'accès aux premiers utilisateurs.
