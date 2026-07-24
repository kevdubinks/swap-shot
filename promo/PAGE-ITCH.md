# Page itch.io — kit de mise à jour

Tout est prêt à copier-coller dans **Edit game** sur https://niocecream.itch.io/swap-shot.

## 1. Visuels (dans ce dossier)

| Fichier | Où le mettre |
|---|---|
| `cover-630x500.png` | Cover image (vignette du jeu) |
| `swap-gameplay.gif` | **1re position des screenshots** (un GIF en tête = le gameplay bouge dès qu'on arrive ; version avec le blaster viewmodel) |
| `screenshot-1-action.png` → `5-scene.png` | Screenshots, dans cet ordre (1 = vue joueur avec l'arme et le flash de tir) |

## 2. Tagline (champ « Short description »)

> Chaque kill te téléporte. FPS d'arène synthwave où ton flingue est aussi tes jambes.

Version EN (itch est surtout anglophone, recommandé) :

> Every kill teleports you. A synthwave arena FPS where your gun is also your legs.

## 3. Description (zone principale — coller tel quel, itch accepte ce format)

**Your gun is your only way to move.**

Shoot a drone: it dies — and you *take its place, instantly*. Chain swaps to cross the arena at light speed, steal the high ground, and dodge death by being somewhere else.

**Modes**
- **Endless waves** — survive, chain combos, climb the global leaderboard
- **Swap only** — no walking allowed: the swap IS your legs
- **Duel vs bot** — 1v1 or 1v2 against AI that camps your Echo (3 difficulties)
- **Online multiplayer** — 1v1 duels and **2v2 team battles**: share a 4-letter code, no account needed

**The Echo** — every kill drops a 10-second teleport anchor where your victim died. Take it… but enemies see it, can camp it, and can *destroy* it.

**Also in the box:** global leaderboard with claimable nicknames, full mobile/touch support (play it on your phone!), remappable keys, dash & double-jump, CRT-retro visuals with quality presets (Auto/High/Light/Off), and a fully procedural synthwave soundtrack that kicks in when the fight starts.

**Controls** — WASD/ZQSD move (remappable) · mouse aim · Space double-jump · Shift dash (dashes where you look) · E echo teleport · Esc pause. Mobile: left thumb joystick, right thumb aim, tap to shoot.

---

*Version française* : Chaque tir sur un drone le détruit ET te téléporte à sa place. Enchaîne les swaps pour traverser l'arène, vole la position de tes ennemis, et utilise l'Écho — l'ancre de téléportation laissée par chaque kill — sans te la faire camper. Vagues infinies, Swap only, duels contre bots, et multijoueur en ligne 1v1 / 2v2 par code à 4 lettres.

## 4. Métadonnées

- **Genre** : Action / Shooter
- **Tags** (12 max) : `fps`, `arcade`, `synthwave`, `retro`, `multiplayer`, `pvp`, `3d`, `teleportation`, `singleplayer`, `leaderboard`, `touch-friendly`, `threejs`
- **Made with** : Three.js
- **Average session** : A few minutes
- **Inputs** : Keyboard, Mouse, Touchscreen
- **Multiplayer** : Server-based networked multiplayer (WebRTC P2P en vrai, mais c'est l'option la plus proche)
- ⚠ **Uploader aussi le zip v0.10.0** (`swap-shot-web.zip` à la racine du projet) si ce n'est pas déjà fait — sans ça le multi itch ↔ Vercel est incompatible.

## 5. Après la mise à jour

Poste un **devlog** (« v0.10 : refonte Rétro-Néon + 2v2 en ligne ») — itch remonte les jeux avec devlogs récents dans les flux. Le GIF + 2 captures suffisent.
