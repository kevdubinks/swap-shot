import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------------------------------------------------------------------------
// FX « Rétro-Néon » — palette centralisée, post-processing (bloom + passe
// rétro : pixelation douce par rendu interne réduit, scanlines, vignette,
// grain, aberration chromatique), sol-grille animé et horizon synthwave.
// Tout est débrayable via le réglage Qualité (« off » = rendu direct).
// ---------------------------------------------------------------------------

// Palette du jeu — la seule source de vérité côté 3D (le CSS a ses variables
// miroir dans index.html : les garder synchronisées à la main).
export const PAL = {
  player: 0x4df3ff,   // cyan — joueur, swap, drones neutres, UI principale
  playerSoft: 0x9be8ff,
  danger: 0xff3d6e,   // rose — dégâts, drones hostiles, adversaire distant
  dangerSoft: 0xff88aa,
  echo: 0xffd54d,     // jaune — écho, score, récompenses
  bot1: 0xff8c3d,     // orange — 1er bot
  bot2: 0xb06bff,     // violet — 2e bot
  good: 0x2fe6a8,     // vert menthe — PV pleins, multijoueur
  proj: 0xffd54d,     // projectiles ennemis
  bg: 0x05060a,
};

// Presets de qualité. « auto » = léger sur tactile, élevé sinon — la DA rétro
// SERT la perf mobile : pixelation plus forte = moins de fragments à rendre.
const QUALITIES = {
  eleve: { pixel: 1.6, bloomStrength: 0.45, bloomRadius: 0.35, bloomThreshold: 0.75, scan: 0.12, grain: 0.05, vig: 0.32, aberr: 0.0022, off: false },
  leger: { pixel: 2.4, bloomStrength: 0.35, bloomRadius: 0.3, bloomThreshold: 0.82, scan: 0.1, grain: 0.04, vig: 0.3, aberr: 0.0018, off: false },
  off: { pixel: 1, off: true },
};

const RetroShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberr: { value: 0.0022 },
    uScan: { value: 0.12 },
    uGrain: { value: 0.05 },
    uVig: { value: 0.32 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAberr, uScan, uGrain, uVig;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      // aberration chromatique radiale : nulle au centre (la visée reste nette)
      vec2 off = (vUv - 0.5) * uAberr;
      vec3 col = vec3(
        texture2D(tDiffuse, vUv + off).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - off).b
      );
      // scanlines CRT subtiles (période 4 px écran)
      float sl = sin(gl_FragCoord.y * 1.5707963);
      col *= 1.0 - uScan * (0.5 + 0.5 * sl);
      // vignette
      col *= 1.0 - uVig * smoothstep(0.42, 0.88, distance(vUv, vec2(0.5)));
      // les ombres tirent vers le violet (lift synthwave)
      col += vec3(0.012, 0.005, 0.030) * (1.0 - smoothstep(0.0, 0.5, dot(col, vec3(0.333))));
      // grain animé
      col += (hash(gl_FragCoord.xy + fract(uTime * 13.7) * 251.0) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const FloorShader = {
  vertexShader: /* glsl */ `
    varying vec2 vWorld;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */ `
    varying vec2 vWorld;
    uniform float uTime;
    uniform vec3 uBase, uGrid;
    uniform vec4 uWaves[4];      // xy = centre, z = date de départ, w = actif
    uniform vec3 uWaveCol[4];
    void main() {
      vec2 coord = vWorld / 2.0;
      vec2 g = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
      float line = 1.0 - min(min(g.x, g.y), 1.0);
      float dist = length(vWorld);
      // la grille respire : pulsation qui rayonne depuis le centre
      float pulse = 0.6 + 0.4 * sin(uTime * 1.8 - dist * 0.22);
      vec3 col = uBase * (1.0 - 0.4 * smoothstep(0.0, 32.0, dist));
      col += uGrid * line * (0.16 + 0.14 * pulse);
      // ondes de choc des swaps/échos
      for (int i = 0; i < 4; i++) {
        if (uWaves[i].w < 0.5) continue;
        float age = uTime - uWaves[i].z;
        if (age < 0.0 || age > 1.5) continue;
        float d = abs(distance(vWorld, uWaves[i].xy) - age * 20.0);
        float ring = exp(-d * d * 0.55) * (1.0 - age / 1.5);
        col += uWaveCol[i] * ring * (0.35 + line * 0.75);
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const SkyShader = {
  vertexShader: /* glsl */ `
    varying vec3 vPos;
    void main() {
      vPos = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vPos;
    void main() {
      float h = normalize(vPos).y;
      vec3 zenith = vec3(0.016, 0.010, 0.055);
      vec3 horizon = vec3(0.13, 0.028, 0.19);
      vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.55));
      col += vec3(0.42, 0.09, 0.27) * exp(-max(h, 0.0) * 5.0) * 0.5;  // halo rose au ras de l'horizon
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const SunShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform float uTime;
    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      float disc = 1.0 - smoothstep(0.9, 0.98, length(p));
      if (disc <= 0.001) discard;
      // stries horizontales qui s'épaississent vers le bas et défilent lentement
      float bands = sin(p.y * 34.0 - uTime * 0.6);
      float thr = mix(0.95, -0.85, (p.y + 1.0) * 0.5);
      float cut = smoothstep(thr - 0.15, thr + 0.15, bands);
      vec3 col = mix(vec3(0.85, 0.20, 0.38), vec3(0.92, 0.66, 0.26), (p.y + 1.0) * 0.5);
      float a = disc * cut * 0.8;
      gl_FragColor = vec4(col * a, a);
    }`,
};

export function createFX(renderer, scene, camera, { arenaHalf, wallHeight, isTouch }) {
  let t = 0;
  let punchV = 0;
  let q = QUALITIES.eleve;
  let qualityName = 'auto';

  // --- chaîne de post-processing : rendu → bloom → sRGB → passe rétro finale.
  // La passe rétro est la DERNIÈRE (renderToScreen) : elle rééchantillonne le
  // buffer interne réduit vers le plein écran (pixelation douce) tout en
  // calculant scanlines/grain par pixel ÉCRAN, donc nets malgré le downscale.
  const composer = new EffectComposer(renderer);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.85, 0.4, 0.55);
  const retroPass = new ShaderPass(RetroShader);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  composer.addPass(retroPass);

  // --- sol : grille pulsante + ondes de choc (remplace floor + GridHelper)
  const waves = [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0));
  const waveCols = [0, 1, 2, 3].map(() => new THREE.Color(PAL.player));
  let waveIdx = 0;
  const floorMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBase: { value: new THREE.Color(0x070a14) },
      uGrid: { value: new THREE.Color(PAL.player) },
      uWaves: { value: waves },
      uWaveCol: { value: waveCols },
    },
    vertexShader: FloorShader.vertexShader,
    fragmentShader: FloorShader.fragmentShader,
    fog: false,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(arenaHalf * 2, arenaHalf * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // --- horizon synthwave : dôme dégradé + soleil strié + étoiles
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(170, 32, 16),
    new THREE.ShaderMaterial({ ...SkyShader, side: THREE.BackSide, depthWrite: false, fog: false })
  );
  scene.add(sky);

  const sunMat = new THREE.ShaderMaterial({
    ...SunShader,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), sunMat);
  sun.position.set(0, 85, -165);   // énorme et haut : il domine le mur nord
  scene.add(sun);

  const starCount = 260;
  const starPos = new Float32Array(starCount * 3);
  const starCol = new Float32Array(starCount * 3);
  const starTints = [new THREE.Color(0xcfe8ff), new THREE.Color(PAL.playerSoft), new THREE.Color(0xffc9de)];
  for (let i = 0; i < starCount; i++) {
    // hémisphère supérieur, jamais sous l'horizon
    const az = Math.random() * Math.PI * 2;
    const el = 0.12 + Math.random() * 1.35;
    const r = 160;
    starPos.set([
      Math.cos(el) * Math.sin(az) * r,
      Math.sin(el) * r,
      Math.cos(el) * Math.cos(az) * r,
    ], i * 3);
    const c = starTints[Math.floor(Math.random() * starTints.length)];
    starCol.set([c.r, c.g, c.b], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
  const starMat = new THREE.PointsMaterial({
    size: 2, sizeAttenuation: false, vertexColors: true,
    transparent: true, opacity: 0.85, depthWrite: false, fog: false,
  });
  scene.add(new THREE.Points(starGeo, starMat));

  // --- bandeaux néon sur les murs : skirting cyan au sol, liseré rose en haut
  const stripGeo = new THREE.BoxGeometry(arenaHalf * 2 + 2, 0.14, 0.14);
  const stripBottomMat = new THREE.MeshBasicMaterial({ color: PAL.player });
  const stripTopMat = new THREE.MeshBasicMaterial({ color: PAL.danger });
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    for (const [mat, y] of [[stripBottomMat, 0.3], [stripTopMat, wallHeight - 0.4]]) {
      const strip = new THREE.Mesh(stripGeo, mat);
      strip.position.set(Math.sin(angle) * (arenaHalf - 0.08), y, Math.cos(angle) * (arenaHalf - 0.08));
      strip.rotation.y = angle;
      scene.add(strip);
    }
  }

  function resize() {
    const pr = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(pr);
    renderer.setSize(window.innerWidth, window.innerHeight);
    // buffer interne réduit = pixelation douce + rendu (et bloom) moins chers
    composer.setPixelRatio(pr / q.pixel);
    composer.setSize(window.innerWidth, window.innerHeight);
  }

  function setQuality(name) {
    qualityName = name;
    const resolved = name === 'auto' ? (isTouch ? 'leger' : 'eleve') : name;
    q = QUALITIES[resolved] || QUALITIES.eleve;
    if (!q.off) {
      bloomPass.strength = q.bloomStrength;
      bloomPass.radius = q.bloomRadius;
      bloomPass.threshold = q.bloomThreshold;
      retroPass.uniforms.uScan.value = q.scan;
      retroPass.uniforms.uGrain.value = q.grain;
      retroPass.uniforms.uVig.value = q.vig;
    }
    resize();
  }

  return {
    resize,
    setQuality,
    get quality() { return qualityName; },
    // à-coup d'aberration chromatique (swap, écho, dash) — décroît tout seul
    punch(amount) { punchV = Math.min(1.2, Math.max(punchV, amount)); },
    // onde de choc sur la grille du sol
    wave(x, z, colorHex = PAL.player) {
      waves[waveIdx].set(x, z, t, 1);
      waveCols[waveIdx].setHex(colorHex);
      waveIdx = (waveIdx + 1) % 4;
    },
    render(dt) {
      t += dt;
      punchV = Math.max(0, punchV - dt * 3.2);
      floorMat.uniforms.uTime.value = t;
      sunMat.uniforms.uTime.value = t;
      starMat.opacity = 0.72 + 0.18 * Math.sin(t * 1.7);
      if (q.off) {
        renderer.render(scene, camera);
      } else {
        retroPass.uniforms.uTime.value = t;
        retroPass.uniforms.uAberr.value = q.aberr + punchV * 0.022;
        composer.render();
      }
    },
  };
}
