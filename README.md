# 🎬 Kinetic Reel Engine

Pipeline autonome de génération et de motion design pour vidéos verticales (**format 9:16**) dans le style **Kinetic Editorial** (@nv3us / Fares commercial short).

Propulsé à 100% par **Google AI Studio (Gemini 2.0 Audio)** et **HyperFrames**.

---

## ⚡ Fonctionnalités Clés

1. **Scénarisation & Storyboard IA (Gemini 2.0 Flash)** :
   * Découpage rythmé de 15s à 60s+ adapté à la cadence (`calm`, `standard`, `rapid`).
   * Sélection automatique de l'objet héros concret (physique, jamais abstrait) et du mot-clé d'impact.

2. **Détourage IA Transparent Automatique (Modèle Local U2Net)** :
   * Isolation nette du sujet en PNG transparent avec canal alpha en ~3 secondes.
   * Plus aucune boîte ou arrière-plan carré sur les objets en lévitation.

3. **Voiceover Ultra-Naturel 100% Google AI Studio** :
   * Voix humaines riches (`Puck`, `Aoede`, `Fenrir`, `Charon`, `Kore`) avec rotation multi-modèles (`gemini-3.8-flash-lite-tts`).

4. **Alignement Acoustique Mot par Mot & Taps Polyphoniques** :
   * Analyse d'enveloppe sonore et dips dB en Node.js pur.
   * **Syllable-Synced Taps** : Clics acoustiques subtils sur chaque mot prononcé et impacts sub-basse puissants sur les mots-clés.
   * Allocation dynamique multi-pistes (Pistes 10 à 15) sans collision audio.

5. **Bibliothèque de Styles d'Édition (`lib/styles/`)** :
   * `fares-editorial` : Fond noir obsidienne, mot-clé rouge écarlate (`#FF2E36`), ruban cinétique, secousses d'écran et sub-bass.
   * `swiss-editorial` : Contraste papier crème (`#FFF8F3`) & noir encre (`#151211`), rouge suisse (`#E71F28`).
   * `cyber-matrix` : Univers tech bleu nuit (`#040814`) & cyan néon (`#00F5FF`).
   * `minimal-luxury` : Anthracite velours (`#0F0E0D`) & or chaud (`#F59E0B`).

6. **Pilotage Mobile via Bot Telegram Dédié (`telegram-bot.mjs`)** :
   * Génération et envoi de vidéos en direct depuis un smartphone.

---

## 🚀 Utilisation en Ligne de Commande (CLI)

### 1. Configuration
```powershell
$env:GEMINI_API_KEY = "votre_cle_google_ai_studio"
```
*(ou créez un fichier `.env` avec `GEMINI_API_KEY=...`)*

### 2. Exécution
```powershell
node create-reel.mjs `
  --topic "Pourquoi l'intelligence artificielle révolutionne la création de contenu" `
  --duration 30 `
  --voice "Fenrir" `
  --style "fares-editorial" `
  --speed "standard"
```

### Options disponibles :
| Option | Raccourci | Description | Défaut |
| :--- | :---: | :--- | :---: |
| `--topic` | `-t` | Sujet ou script de la vidéo *(Requis)* | — |
| `--duration` | `-d` | Durée approximative en secondes | `30` |
| `--voice` | `-v` | Voix (`Puck`, `Aoede`, `Fenrir`, `Charon`, `Kore`) | `Puck` |
| `--style` | `-s` | Style visuel (`fares-editorial`, `swiss`, `cyber`, `luxury`) | `fares-editorial` |
| `--speed` | `--pace` | Cadence (`calm`, `standard`, `rapid`) | `standard` |
| `--lang` | `-l` | Langue (`French`, `English`, `Arabic`, `Spanish`...) | Auto-détecté |
| `--output` | `-o` | Chemin du fichier MP4 final | `<slug>.mp4` |
| `--skip-render` | — | Génère le projet HTML sans lancer le rendu | `false` |

---

## 🤖 Lancement du Bot Telegram

```powershell
node telegram-bot.mjs
```
Envoyez simplement vos idées en langage naturel au bot (ex: *"Fais-moi un reel de 30s sur l'or numérique en style fares avec la voix Fenrir"*).
