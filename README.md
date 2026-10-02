# 🎬 Kinetic Editorial Reel Automation Engine

Pipeline automatisé de génération de vidéos verticales (9:16) au format **Kinetic Editorial** ultra-qualitatif, propulsé par **Google AI Studio (Gemini 2.0 Audio)** et **HyperFrames**.

---

## ⚡ Fonctionnalités

1. **Génération de Script & Storyboard IA (Gemini 2.0 Flash)** :
   - Découpage en scènes rythmées (5 à 12 scènes pour des vidéos de 20s à 60s+).
   - Alternance visuelle signature : Fond crème (`#fff8f3`) vs Noir profond (`#060505`).
   - Sélection automatique du **mot-clé rouge (#e71f28)** par scène pour le slam visuel.
   - Prompts de rendu 3D studio isolés pour chaque objet héros.

2. **Voiceover Ultra-Naturel (Google AI Studio Gemini 2.0 Audio)** :
   - Voix humaines expressives avec intonation, rythme et souffle :
     - `Puck` : Masculin énergique, dynamique, percutant.
     - `Aoede` : Féminin chaleureux, naturel, fluide.
     - `Fenrir` : Masculin grave, autoritaire, cinématographique.
     - `Charon` : Masculin posé, documentaire, clair.
     - `Kore` : Féminin accessible, moderne.
   - Support multilingue natif (Français, Anglais, Espagnol, Arabe, etc.).

3. **Alignement Acoustique Mot par Mot** :
   - Détection d'enveloppe sonore et dip acoustique native en Node.js (0 dépendance python lourde).
   - Synchronisation précise des effets de texte cinétiques (blur reveal progressif + slam keyword).

4. **Détourage Automatique d'Images (HyperFrames AI Cutout)** :
   - Isolation automatique du sujet principal sur fond transparent.

5. **Rendu Headless Direct en MP4** :
   - Export 1080x1920 60/30fps prêt à publier sur TikTok, Instagram Reels, YouTube Shorts.

---

## 🚀 Utilisation Rapide

### 1. Définir votre clé Google AI Studio
```powershell
$env:GEMINI_API_KEY = "AIzaSy..."
```
*(ou créez un fichier `.env` dans le dossier avec `GEMINI_API_KEY=AIzaSy...`)*

### 2. Lancer la création d'une vidéo
```powershell
node create-reel.mjs --topic "Pourquoi l'intelligence artificielle révolutionne la médecine" --duration 30 --voice "Puck" --lang "French"
```

### Options disponibles :
| Option | Description | Valeur par défaut |
|---|---|---|
| `--topic`, `-t` | Sujet ou script de la vidéo (Requis) | - |
| `--duration`, `-d` | Durée cible en secondes | `30` |
| `--voice`, `-v` | Voix (`Puck`, `Aoede`, `Fenrir`, `Charon`, `Kore`) | `Puck` |
| `--lang`, `-l` | Langue du voiceover | `French` |
| `--key`, `-k` | Clé d'API explicite | `$env:GEMINI_API_KEY` |
| `--output`, `-o` | Chemin de sortie du MP4 | `<slug>.mp4` |
| `--skip-render` | Générer tout sans lancer le rendu vidéo | `false` |
