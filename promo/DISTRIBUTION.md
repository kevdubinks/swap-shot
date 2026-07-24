# Plan de distribution — SWAP SHOT

Objectif : faire jouer un maximum de monde, gratuitement, sans serveur à payer.

## Étape 1 — La base (15 min)

- [ ] Mettre à jour la page itch avec le kit `PAGE-ITCH.md` (cover, GIF, textes, tags) + zip v0.10.0
- [ ] Publier un devlog itch : « v0.10 — refonte Rétro-Néon + 2v2 en ligne »
- [ ] Épingler le lien direct https://swap-shot.vercel.app dans tes bios/serveurs Discord

## Étape 2 — Les portails web (le vrai trafic)

### CrazyGames (priorité n°1 — des millions de joueurs/mois)
1. Créer un compte développeur sur **developer.crazygames.com** (gratuit)
2. « Submit game » → choisir HTML5, uploader le zip (même contenu que le zip itch)
3. Ils testent le jeu (compte ~1-2 semaines de review). Critères qu'on coche déjà :
   jouable clavier/souris ET tactile, pas de liens sortants, chargement rapide, contenu tout public
4. S'ils acceptent, ils demanderont d'intégrer leur **SDK** (pub entre les parties +
   partage de revenus ~50 %). Dis-le moi à ce moment-là : c'est ~30 lignes de code, je m'en charge
5. ⚠ Sur leur version, prévoir de désactiver le lien classement si exigé (variable à prévoir)

### Newgrounds (simple, communauté rétro friendly)
1. Compte sur newgrounds.com → « Submit your game »
2. Uploader le même zip HTML5, dimensions 1280×720, cocher « touch compatible »
3. Tags identiques à itch. Zéro SDK requis, publication immédiate après upload

### Poki (plus sélectif, à tenter après CrazyGames)
- developers.poki.com — même principe que CrazyGames, review plus dure, SDK obligatoire

## Étape 3 — Faire du bruit (en continu)

- **Clips courts** : le GIF de swap est fait pour ça. 15-30 s verticaux pour TikTok/Shorts :
  « ce FPS où chaque kill te téléporte » — filme un enchaînement de 4-5 swaps + un vol d'écho
- **Reddit** : r/WebGames (lien direct ok), r/playmygame (feedback), r/IndieGaming (GIF)
  → poster le GIF, pas juste un lien
- **Discords** de jeux indés / Three.js showcase (le canal #showcase du serveur Three.js aime ce genre de projet)

## À surveiller si ça décolle

| Brique | Gratuit jusqu'à | Si dépassé |
|---|---|---|
| Vercel (jeu + API classement) | 100 Go/mois de bande passante | Plan Pro 20 $/mois |
| Upstash Redis (classement) | 10k commandes/jour | ~0,2 $/100k |
| Broker PeerJS (matchmaking) | best effort, pas de SLA | héberger son PeerServer (gratuit sur Render/Fly) |
| TURN Open Relay (multi via 4G) | best effort | Metered/Twilio TURN payant, ou PeerServer+coturn |

Rien à faire tant que le jeu reste confidentiel ; premier signal d'alerte = classement qui rame.

## Idée bonus (quand le contenu grossira)

Steam via Tauri/Electron (100 $ de frais, review) — pertinent seulement avec plusieurs arènes,
progression, et un vrai flux de joueurs multi. Pareil pour les stores mobiles (Capacitor).
