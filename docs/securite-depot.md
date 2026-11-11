# Garde-fous du dépôt

Objectif : qu'aucun secret, aucune donnée réelle et aucune dépendance vulnérable n'atteigne
GitHub. Le dépôt est **public** : tout ce qui y est poussé est lisible par n'importe qui,
historique compris.

## Les trois couches

| Couche | Où | Contournable ? |
|---|---|---|
| Hooks Lefthook (`lefthook.yml`) | poste du développeur, avant commit et avant push | oui (`LEFTHOOK=0`, `--no-verify`) |
| Job « Sécurité » de la CI (`.github/workflows/ci.yml`) | GitHub Actions, à chaque push | non |
| Secret scanning + push protection de GitHub, CodeQL, Dependabot | GitHub | non |

Les hooks servent à attraper le problème **tôt**, sur votre machine. La CI refait tout : c'est
elle qui fait foi.

### Avant chaque commit

- **Fichiers interdits** (`scripts/verifier-fichiers-interdits.mjs`) : `.env` (sauf
  `.env.example`), sauvegardes de base (`*.dump`, `backups/`), clés privées et certificats,
  fichiers d'identifiants, clés `age`, fichiers `.bak`, tout fichier de plus de 5 Mo.
- **Secrets** (`secretlint`) : jetons et clés d'API de formats connus (AWS, GitHub, Google,
  Slack, npm…), clés privées, URL contenant un mot de passe.
- **Lint** (`oxlint`) : erreurs uniquement, sur les fichiers modifiés.

### Avant chaque push

- Secrets sur tous les fichiers modifiés par les commits poussés.
- Tests unitaires frontend et backend.
- `npm audit` des dépendances de production (frontend et backend), bloquant à partir du
  niveau « high ».

### En CI (job « Sécurité »)

- **gitleaks** sur tout l'historique publié.
- Fichiers interdits sur tous les fichiers suivis, secretlint, lint, `npm audit`.

> **Limite à connaître.** Les détecteurs (gitleaks, secretlint, GitHub) reconnaissent des
> **formats** de secrets. Un mot de passe choisi à la main dans un fichier `.env` ne ressemble
> à aucun format : c'est exactement ce qui s'est produit en juillet 2026 (un `server/.env`
> poussé, non détecté par gitleaks lors de la vérification du 11/11/2026). Le contrôle des
> fichiers interdits existe pour ce cas : ne le désactivez pas.

## Installation

Rien à faire : `npm install` à la racine installe les hooks (script `prepare`). Pour vérifier :

```bash
npx lefthook version
```

Commandes utiles :

```bash
npm run secrets   # scanne tout le dépôt
npm run lint      # lint complet (avertissements compris)
```

En cas d'urgence absolue (hook cassé, par exemple), un commit peut passer avec
`LEFTHOOK=0 git commit …` — la CI bloquera de toute façon un secret ou une vulnérabilité.

## Que faire si un secret a été poussé

1. **Le changer immédiatement** là où il est utilisé (mot de passe de la base, clé d'API…).
   Supprimer le commit ne suffit pas : le dépôt est public, il a pu être copié.
2. Vérifier qu'il n'est réutilisé nulle part ailleurs.
3. Seulement ensuite, si nécessaire, purger l'historique (`git filter-repo`) et forcer le push
   — opération qui réécrit l'historique de tous les collaborateurs, à décider ensemble.

## Partager des secrets : SOPS + age

Les fichiers `.env` ne se commitent jamais en clair. Quand plusieurs personnes doivent
partager la configuration de production, on versionne une copie **chiffrée** avec
[SOPS](https://github.com/getsops/sops) et des clés [age](https://github.com/FiloSottile/age).

Mise en place (une fois) :

1. Installer `sops` et `age` (binaires publiés sur leurs pages GitHub respectives).
2. Chaque personne génère sa paire de clés et garde la clé privée **hors du dépôt** :
   ```bash
   age-keygen -o "$HOME/.config/sops/age/keys.txt"
   ```
   et communique sa clé **publique** (`age1…`).
3. À la racine du dépôt, créer `.sops.yaml` avec les clés publiques autorisées :
   ```yaml
   creation_rules:
     - path_regex: secrets/.*\.env$
       age: age1aaaa…,age1bbbb…
   ```

Utilisation :

```bash
sops --encrypt secrets/production.env > secrets/production.enc.env   # chiffrer
sops --decrypt secrets/production.enc.env > server/.env              # déchiffrer en local
```

Seul `secrets/production.enc.env` est commité. Retirer l'accès à quelqu'un : enlever sa clé de
`.sops.yaml`, puis `sops updatekeys secrets/production.enc.env` **et** changer les secrets
qu'il connaissait.

En production (DigitalOcean) et en CI, les secrets sont fournis par les variables
d'environnement du serveur et par les *secrets* GitHub Actions, jamais par un fichier commité.
