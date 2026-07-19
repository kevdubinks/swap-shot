import { defineConfig } from 'vite';

// Config DEV UNIQUEMENT — chargée via `--config vite.dev.config.js` par le
// script `npm run dev`. Ne PAS la renommer en vite.config.js : sa seule
// présence sous ce nom fait résoudre la racine du build par le chemin réel
// MSIX (Packages\...\LocalCache) et casse les modules proxy du CSS inline
// d'index.html (« No matching HTML proxy module found »).
// Pourquoi ces réglages en dev (virtualisation MSIX de AppData\Local) :
// - dedupe three : sinon deux copies chargées (« Multiple instances of Three.js »)
// - fs.strict false : la police @fontsource se résout hors racine et est bloquée
export default defineConfig({
  resolve: { dedupe: ['three'] },
  server: { fs: { strict: false } },
});
