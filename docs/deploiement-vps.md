# Déployer l'API sur un VPS Hostinger

Ce guide met l'API en ligne sur un VPS (Ubuntu 24.04) en HTTPS, par exemple
sur `https://api.tondomaine.com`. Le frontend Next.js peut rester sur
Vercel.

Deux méthodes, au choix :

- **A. Docker (recommandée)** : API + MongoDB + Caddy (HTTPS automatique)
  avec une seule commande. Tout est isolé et se recrée à l'identique.
- **B. PM2** : Node installé directement sur le serveur, Caddy pour HTTPS.

Les fichiers utilisés sont dans le dépôt : `Dockerfile`,
`docker-compose.prod.yml`, `deploy/Caddyfile`, `ecosystem.config.cjs`.

---

## 1. Préparer le domaine et le serveur

### 1.1 DNS

Chez ton registrar (ou dans hPanel → Domaines → DNS), crée un
enregistrement :

| Type | Nom | Valeur |
| --- | --- | --- |
| A | `api` | l'adresse IP du VPS |

Vérifie depuis ton PC (quelques minutes à quelques heures) :

```bash
nslookup api.tondomaine.com
```

L'adresse doit être celle du VPS **avant** le premier démarrage, sinon
Caddy ne peut pas obtenir le certificat HTTPS.

### 1.2 Sécuriser le VPS

Connecte-toi en root (identifiants dans hPanel), puis :

```bash
# Utilisateur de déploiement (jamais root au quotidien)
adduser deploy
usermod -aG sudo deploy

# Copie ta clé SSH (depuis ton PC) : ssh-copy-id deploy@IP_DU_VPS
# Puis, une fois la connexion par clé vérifiée, désactive le mot de passe :
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh

# Pare-feu : seulement SSH, HTTP et HTTPS
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Mises à jour de sécurité automatiques + protection anti-bruteforce SSH
apt update && apt upgrade -y
apt install -y unattended-upgrades fail2ban git
```

> MongoDB (27017) et Redis (6379) ne doivent **jamais** être ouverts dans
> le pare-feu.

---

## 2. Variables d'environnement

Sur le serveur, les variables vont dans **`.env.production`** à la racine
du projet. Ce fichier est ignoré par git : ne le commite jamais.

### 2.1 Générer les secrets

```bash
# JWT_SECRET (64 caractères minimum conseillé)
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
# TWO_FACTOR_ENCRYPTION_KEY (exactement 32 octets en base64)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Mot de passe MongoDB
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

(Sans Node sur le serveur : `openssl rand -base64 48`, `openssl rand -base64 32`.)

### 2.2 Modèle de `.env.production`

```env
# --- Domaines
API_DOMAIN=api.tondomaine.com
API_PUBLIC_URL=https://api.tondomaine.com
APP_WEB_URL=https://tondomaine.com
# Toutes les origines du frontend, séparées par des virgules (obligatoire)
CORS_ORIGIN=https://tondomaine.com,https://www.tondomaine.com,https://admin.tondomaine.com

# --- Application
NODE_ENV=production
APP_NAME=Technoastuce
LOG_LEVEL=info
TRUST_PROXY=true

# --- Base de données
# Méthode A (MongoDB dans Docker) : utilisateur/mot de passe ci-dessous
MONGO_ROOT_USER=technoastuce
MONGO_ROOT_PASSWORD=COLLE_LE_MOT_DE_PASSE_GENERE
MONGODB_URI=mongodb://technoastuce:COLLE_LE_MOT_DE_PASSE_GENERE@mongo:27017/?authSource=admin
# Méthode B ou MongoDB Atlas : MONGODB_URI=mongodb+srv://...
DB_NAME=technoastuce

# --- Auth
JWT_SECRET=COLLE_LE_SECRET_GENERE
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_TTL_DAYS=30
TWO_FACTOR_ENCRYPTION_KEY=COLLE_LA_CLE_GENEREE
AUTH_REQUIRE_EMAIL_VERIFICATION=true

# --- Email (exemple : boîte mail Hostinger)
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@tondomaine.com
SMTP_PASS=MOT_DE_PASSE_DE_LA_BOITE
MAIL_FROM="Technoastuce <no-reply@tondomaine.com>"

# --- Redis : laisser vide avec une seule instance
REDIS_URL=
```

Points importants :

- **`CORS_ORIGIN`** : sans elle, l'API refuse de démarrer en production. Mets
  l'URL exacte de chaque frontend (sans `/` final). Une origine oubliée =
  le navigateur bloque les appels de ce site.
- **Mot de passe MongoDB** : utilise une valeur sans `@ : / ? #` (la
  commande `base64url` ci-dessus convient), sinon il casse `MONGODB_URI`.
- **Email** : avec `AUTH_REQUIRE_EMAIL_VERIFICATION=true`, il faut un SMTP
  qui fonctionne, sinon personne ne peut valider son compte. Configure aussi
  SPF/DKIM du domaine (hPanel → Emails) pour ne pas finir en spam.
- **Swagger** est désactivé en production (`SWAGGER_ENABLED=true` pour le
  réactiver temporairement).

---

## 3. Méthode A — Docker (recommandée)

### 3.1 Installer Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy   # puis déconnecte-toi / reconnecte-toi
docker compose version
```

### 3.2 Récupérer le projet et démarrer

```bash
cd ~
git clone https://github.com/Stephen707/backend-technoastuce.git
cd backend-technoastuce
nano .env.production            # colle le modèle de la section 2.2
chmod 600 .env.production

docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Ce qui tourne alors :

| Service | Rôle | Exposé sur Internet |
| --- | --- | --- |
| `caddy` | HTTPS (Let's Encrypt, renouvellement auto) + reverse proxy | 80, 443 |
| `api` | l'API NestJS (utilisateur non-root) | non |
| `mongo` | MongoDB avec mot de passe, données dans un volume | non |

Pour ne pas retaper les options, crée un alias :

```bash
echo "alias dc='docker compose -f ~/backend-technoastuce/docker-compose.prod.yml --env-file ~/backend-technoastuce/.env.production'" >> ~/.bashrc
source ~/.bashrc
```

### 3.3 Vérifier

```bash
dc ps                       # tous les services "healthy" / "running"
dc logs -f api              # logs de l'API (Ctrl+C pour quitter)
curl https://api.tondomaine.com/api/v1/health
```

La réponse doit contenir `"status":"ok"` et `"database":{"status":"up"}`.

### 3.4 Mettre à jour après un `git push`

```bash
cd ~/backend-technoastuce
git pull
dc up -d --build api
docker image prune -f       # supprime les anciennes images
```

La base (volume `mongo_data`) et les certificats (`caddy_data`) sont
conservés.

> Ne lance **jamais** `docker compose down -v` : le `-v` supprime les
> volumes, donc la base de données.

---

## 4. Méthode B — PM2 (sans Docker)

### 4.1 Installer Node 22, PM2 et Caddy

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

MongoDB : utilise **MongoDB Atlas** (offre gratuite, sauvegardes incluses)
ou installe MongoDB 7 sur le VPS en suivant la doc officielle, avec
l'authentification activée et `bindIp: 127.0.0.1`.

### 4.2 Construire et lancer

```bash
cd ~
git clone https://github.com/Stephen707/backend-technoastuce.git
cd backend-technoastuce
cp /chemin/vers/.env.production .env     # NestJS lit le fichier .env
chmod 600 .env

npm ci
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # copie-colle la commande affichée : redémarrage auto au boot
```

Dans `.env` pour cette méthode : `MONGODB_URI` pointe vers Atlas ou
`localhost`.

### 4.3 HTTPS avec Caddy

Remplace le contenu de `/etc/caddy/Caddyfile` :

```
api.tondomaine.com {
	encode zstd gzip
	request_body {
		max_size 2MB
	}
	reverse_proxy 127.0.0.1:5080
}
```

```bash
sudo systemctl reload caddy
curl https://api.tondomaine.com/api/v1/health
```

### 4.4 Mettre à jour

```bash
cd ~/backend-technoastuce
git pull
npm ci
npm run build
pm2 reload technoastuce-api
```

Commandes utiles : `pm2 status`, `pm2 logs technoastuce-api`, `pm2 monit`.

---

## 5. Créer le premier super-admin

L'API ne crée aucun compte admin automatiquement. Une seule fois :

1. Inscris-toi normalement depuis le frontend (ou `POST /api/v1/auth/register`)
   avec ton email.
2. Donne-toi le rôle `SUPER_ADMIN` directement en base :

   ```bash
   # Méthode A (Docker)
   dc exec mongo mongosh -u technoastuce -p --authenticationDatabase admin technoastuce
   # Méthode B : mongosh "<ton MONGODB_URI>"
   ```

   ```js
   db.users.updateOne(
     { email: 'toi@tondomaine.com' },
     { $set: { role: 'SUPER_ADMIN', emailVerified: true, emailVerifiedAt: new Date() } },
   )
   ```

3. Connecte-toi, puis active la 2FA (`POST /auth/2fa/setup` puis
   `POST /auth/2fa/enable` avec le code de ton application
   d'authentification). **Les routes admin refusent les comptes admin sans
   2FA.**

Les autres admins se nomment ensuite depuis l'API (`PATCH /users/:id`).

---

## 6. Sauvegardes

La seule donnée à sauvegarder est la base MongoDB.

Méthode A — script `~/backup.sh` :

```bash
#!/bin/sh
set -e
DIR=~/backups/$(date +%F)
mkdir -p "$DIR"
cd ~/backend-technoastuce
. ./.env.production
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T mongo \
  mongodump -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin --archive --gzip \
  > "$DIR/mongo.archive.gz"
find ~/backups -mindepth 1 -maxdepth 1 -mtime +14 -exec rm -rf {} +
```

```bash
chmod +x ~/backup.sh
crontab -e     # ajoute : 0 3 * * * /home/deploy/backup.sh
```

Méthode B : `mongodump --uri "$MONGODB_URI" --archive --gzip` (Atlas
sauvegarde déjà la base).

Copie régulièrement `~/backups` **hors du VPS** (ton PC, un stockage S3/R2,
ou les sauvegardes Hostinger) : une sauvegarde sur le même serveur ne
protège pas d'une panne du serveur.

---

## 7. Passer à plusieurs instances (plus tard)

Inutile pour démarrer. Si tu en as besoin un jour :

1. Active Redis : `REDIS_URL=redis://redis:6379` dans `.env.production`, puis
   `dc --profile redis up -d`.
2. Lance plusieurs API : `dc up -d --scale api=2` (Caddy répartit déjà les
   requêtes entre elles).

---

## 8. Checklist de mise en ligne

- [ ] `api.tondomaine.com` pointe vers l'IP du VPS.
- [ ] Pare-feu : seulement 22, 80, 443 ouverts.
- [ ] `.env.production` rempli, secrets générés, `chmod 600`.
- [ ] `CORS_ORIGIN` contient toutes les URLs du frontend.
- [ ] `https://api.tondomaine.com/api/v1/health` répond `ok`.
- [ ] Un email de vérification arrive bien (et pas en spam).
- [ ] Le super-admin est créé et sa 2FA activée.
- [ ] Le frontend utilise `https://api.tondomaine.com/api/v1` et a des pages
      `/verify-email`, `/reset-password`, `/newsletter/confirm`,
      `/newsletter/unsubscribe`.
- [ ] Les sauvegardes tournent et sont copiées hors du VPS.

## 9. Dépannage

| Symptôme | Cause probable |
| --- | --- |
| L'API ne démarre pas, `Config validation error` dans les logs | Une variable manque ou est invalide : le message indique laquelle |
| Le navigateur affiche une erreur CORS | L'origine du frontend n'est pas dans `CORS_ORIGIN` (attention à `www` et au `/` final) |
| Caddy n'obtient pas de certificat | DNS pas encore propagé, ou ports 80/443 fermés |
| Le lien de désinscription en un clic échoue | `API_PUBLIC_URL` incorrect |
| `Authentication failed` côté MongoDB | Mot de passe différent entre `MONGO_ROOT_PASSWORD` et `MONGODB_URI`, ou caractère spécial dans le mot de passe |
| Les routes admin renvoient 403 | La 2FA n'est pas activée sur le compte admin |
