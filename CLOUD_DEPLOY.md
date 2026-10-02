# ☁️ Guide de Déploiement Cloud 24h/24 (Sans PC allumé)

Pour que votre bot Telegram réponde **partout, tout le temps**, même quand votre PC est éteint ou rangé dans votre sac, voici les 2 meilleures options :

---

## 🚀 Option 1 : Déploiement en 3 clics sur Railway (Le plus simple)

Railway est une plateforme Cloud qui exécute des conteneurs Docker 24h/24 sans que vous ayez à gérer de serveur Linux.

1. Créez un compte gratuit sur **[railway.app](https://railway.app)**.
2. Créez un nouveau dépôt privé sur **GitHub** et déposez-y le contenu du dossier `kinetic-reel-engine`.
3. Sur Railway, cliquez sur **"New Project"** → **"Deploy from GitHub repo"**.
4. Dans l'onglet **Variables** de Railway, ajoutez vos 2 clés :
   - `GEMINI_API_KEY` = `<votre_cle_gemini>`
   - `TELEGRAM_BOT_TOKEN` = `<votre_token_telegram>`
5. Railway détecte automatiquement le `Dockerfile` et lance votre bot !
   👉 **Votre bot Telegram tournera désormais 24h/24 dans le Cloud, indépendamment de votre PC.**

---

## 🖥️ Option 2 : Sur un petit VPS Linux (Hetzner / OVH à 3-4€ / mois)

Si vous avez déjà un petit serveur VPS Ubuntu :

```bash
# 1. Cloner ou copier le dossier
git clone <votre-repo> /opt/kinetic-reel
cd /opt/kinetic-reel

# 2. Configurer le fichier .env avec vos clés
nano .env

# 3. Lancer en arrière-plan 24h/24 avec Docker
docker compose up -d --build
```

---

## 🏠 Option 3 : Si votre PC reste allumé à la maison (Sans Antigravity)

Si votre PC fixe ou portable reste allumé chez vous mais que vous voulez **fermer Antigravity et VS Code**, vous pouvez lancer le bot en tâche de fond permanente via un service Windows :

```powershell
# Installer PM2 pour Windows
npm install -g pm2
cd C:\Users\bbouzid\.gemini\antigravity\scratch\kinetic-reel-engine
pm2 start telegram-bot.mjs --name "kinetic-bot"
pm2 save
```
*(Le bot tournera en tâche de fond sous Windows même si toutes les applications sont fermées).*
