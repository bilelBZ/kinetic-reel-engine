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

## 📰 Mode News-Reel (extraits YouTube réels)

`create-news-reel.mjs` reproduit le workflow éditorial quotidien : télécharger
**uniquement le passage** d'une vidéo YouTube récente, le recadrer en 9:16,
générer des **captions karaoké** (Anton, mot actif en jaune) avec timestamps
Whisper au millième de seconde, puis assembler le MP4 final avec teaser,
hook highlight, badge animé et écran de fin CTA.

Prérequis : `yt-dlp` (`pip install yt-dlp`) et, pour l'alignement précis,
`faster-whisper` (`pip install faster-whisper`). Sans Whisper, le pipeline
utilise les sous-titres auto YouTube en fallback.

```powershell
node create-news-reel.mjs `
  --video "https://www.youtube.com/watch?v=10WEvfjwkIk" `
  --start 07:35 --end 08:06 `
  --teaser 07:58-08:02 `
  --hook "GAZOLE : -12 À -18 CENTIMES ?" `
  --badge "-18 CTS" `
  --cta "VOUS EN PENSEZ QUOI ?" `
  --keywords "gazole,centimes" `
  --lang fr `
  --title "Gazole : Lecornu promet -12 à -18 centimes le litre" `
  --description "Ce soir, Sébastien Lecornu a annoncé..." `
  --hashtags "#Gazole #Carburant #PouvoirDAchat" `
  --pinned "12 à 18 centimes de moins le litre : vous y croyez ?" `
  --package ./package.json
```

### Options du mode news :
| Option | Description |
| :--- | :--- |
| `--video`, `-u` | URL YouTube *(requis)* |
| `--start`, `-s` / `--end`, `-e` | Passage `MM:SS` *(requis)* — seul ce segment est téléchargé |
| `--teaser` | Teaser 0–3s `"MM:SS-MM:SS"` placé devant, transition flash blanc |
| `--hook` | Barre highlight (noir sur jaune) en haut, slide-in |
| `--badge` / `--badge-at` | Badge animé qui pop sur le chiffre (défaut : 1er mot-clé détecté) |
| `--cta` | Écran de fin noir + question highlight |
| `--keywords`, `-k` | Mots-clés (les chiffres sont auto-détectés comme mots-clés) |
| `--lang`, `-l` | `fr` `de` `ar` `en` — langue Whisper + direction du texte |
| `--focus-x` | Cadrage horizontal 0..1 pour centrer l'orateur (défaut 0.5) |
| `--package` | Chemin du package de publication JSON (titre, description, hashtags, commentaire épinglé, source, miniature) |
| `--skip-render` | Génère le projet HTML sans lancer le rendu MP4 |

Style utilisé : `news-viral` (karaoke Anton, mot actif `#FFD60A`).

---

## 🤖 Lancement du Bot Telegram

```powershell
node telegram-bot.mjs
```
Envoyez simplement vos idées en langage naturel au bot (ex: *"Fais-moi un reel de 30s sur l'or numérique en style fares avec la voix Fenrir"*).
