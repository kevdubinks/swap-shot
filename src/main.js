import * as THREE from 'three';

const VERSION = '0.4.0';

// ---------------------------------------------------------------------------
// SWAP SHOT — FPS d'arène. Deux modes :
//  - Vagues : chaque drone touché meurt et échange sa position avec la tienne.
//  - Duel vs bot : les drones sont NEUTRES (pur réseau de mobilité, swap au
//    tir), le bot est un joueur simulé — le toucher fait des dégâts, pas de
//    swap subi entre joueurs. Premier à 5 kills.
// ---------------------------------------------------------------------------

const ARENA_HALF = 30;
const EYE_HEIGHT = 1.6;
const PLAYER_RADIUS = 0.45;
const PLAYER_HEIGHT = 1.7;
const GRAVITY = -24;
const MOVE_SPEED = 9;
const AIR_CONTROL = 0.35;
const JUMP_SPEED = 9;
const ENEMY_RADIUS = 0.9;
const COMBO_WINDOW = 3.0;
const SWAP_GRACE = 0.6;

const DUEL_TARGET = 5;        // kills pour gagner le duel
const DUEL_DRONES = 6;        // drones neutres maintenus dans l'arène
const DRONE_RESPAWN = 5;      // s avant réapparition d'un drone neutre
const BOT_HP = 100;
const BOT_MOVE_SPEED = 8;     // léger handicap vs joueur (9)
const PLAYER_DMG = 25;        // dégâts joueur → bot (4 tirs)

// Profils de difficulté du bot : bruit de visée (rad), cadence (s), dégâts,
// cooldown du swap-drone, probabilité de camper l'écho du joueur.
// campChance : probabilité de contester l'écho ; deny : parmi les contests,
// probabilité de choisir de DÉTRUIRE l'écho plutôt que de le camper en embuscade.
const DIFFICULTIES = {
  facile: { noise: 0.06,  fireMin: 1.0,  fireVar: 0.5,  dmg: 8,  swapCd: 8, campChance: 0,   deny: 0 },
  normal: { noise: 0.035, fireMin: 0.65, fireVar: 0.35, dmg: 12, swapCd: 6, campChance: 0.5, deny: 0.5 },
  dur:    { noise: 0.02,  fireMin: 0.45, fireVar: 0.3,  dmg: 15, swapCd: 4, campChance: 1,   deny: 0.6 },
};
const ECHO_HP = 75;   // 3 tirs de bot pour détruire un écho
const DIFF = () => DIFFICULTIES[settings.difficulty] || DIFFICULTIES.normal;

// --- DOM -------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const overlay = $('overlay');
const hudScore = $('score');
const hudWave = $('wave');
const hudEnemies = $('enemies-left');
const hudHpFill = $('hp-fill');
const hudCombo = $('combo');
const flashEl = $('flash');
const hurtEl = $('hurt');
const deathStats = $('death-stats');
const overlayTitle = overlay.querySelector('h1');
const modeButtons = $('mode-buttons');
const resumeCta = $('resume-cta');
const waveLabel = document.querySelector('#wave-panel .label');

// --- Rendu -----------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.fog = new THREE.FogExp2(0x05060a, 0.022);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);

// --- Réglages (persistés dans localStorage) -----------------------------------
const settings = { sens: 1.0, fov: 75, difficulty: 'normal' };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem('swapshot-settings') || '{}'));
} catch { /* réglages corrompus : on garde les défauts */ }
settings.sens = THREE.MathUtils.clamp(settings.sens, 0.2, 6);
settings.fov = THREE.MathUtils.clamp(settings.fov, 60, 120);
if (!['facile', 'normal', 'dur'].includes(settings.difficulty)) settings.difficulty = 'normal';
if (typeof settings.layout !== 'object' || settings.layout === null) settings.layout = {};

const sensSlider = $('sens-slider');
const fovSlider = $('fov-slider');
function applySettings(save = true) {
  sensSlider.value = settings.sens;
  fovSlider.value = settings.fov;
  $('sens-val').textContent = settings.sens.toFixed(2);
  $('fov-val').textContent = settings.fov + '°';
  document.querySelectorAll('.diff-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.diff === settings.difficulty));
  camera.fov = settings.fov;
  camera.updateProjectionMatrix();
  if (save) localStorage.setItem('swapshot-settings', JSON.stringify(settings));
}
sensSlider.addEventListener('input', () => { settings.sens = parseFloat(sensSlider.value); applySettings(); });
fovSlider.addEventListener('input', () => { settings.fov = parseInt(fovSlider.value, 10); applySettings(); });
document.querySelectorAll('.diff-btn').forEach((b) =>
  b.addEventListener('click', (e) => { e.stopPropagation(); settings.difficulty = b.dataset.diff; applySettings(); }));
$('settings').addEventListener('click', (e) => e.stopPropagation());
applySettings(false);

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 300));
if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

scene.add(new THREE.AmbientLight(0x334455, 1.2));
const keyLight = new THREE.DirectionalLight(0x99ccff, 0.9);
keyLight.position.set(12, 30, 8);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xff3d6e, 0.35);
rimLight.position.set(-15, 10, -20);
scene.add(rimLight);

// --- Arène -----------------------------------------------------------------
const floorMat = new THREE.MeshStandardMaterial({ color: 0x0a0f1a, roughness: 0.9, metalness: 0.2 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2), floorMat);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const grid = new THREE.GridHelper(ARENA_HALF * 2, 30, 0x4df3ff, 0x123344);
grid.material.transparent = true;
grid.material.opacity = 0.5;
grid.position.y = 0.01;
scene.add(grid);

const wallMat = new THREE.MeshStandardMaterial({
  color: 0x0d1626, roughness: 0.7, metalness: 0.4,
  emissive: 0x0a2a33, emissiveIntensity: 0.6,
});
const WALL_H = 20;
for (let i = 0; i < 4; i++) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(ARENA_HALF * 2 + 2, WALL_H, 1), wallMat);
  const angle = (i * Math.PI) / 2;
  wall.position.set(Math.sin(angle) * (ARENA_HALF + 0.5), WALL_H / 2, Math.cos(angle) * (ARENA_HALF + 0.5));
  wall.rotation.y = angle;
  scene.add(wall);
}

// Plateformes : [x, z, largeur, profondeur, hauteur du dessus]
const PLATFORM_DEFS = [
  [-14, -10, 8, 8, 3],
  [12, -14, 7, 7, 5],
  [16, 10, 9, 6, 4],
  [-16, 14, 6, 9, 6],
  [0, 0, 6, 6, 8],       // tour centrale
  [-4, 20, 10, 5, 3.5],
  [6, -24, 8, 5, 2.5],
  [-24, 2, 5, 8, 4.5],
];
const platforms = [];  // { minX, maxX, minZ, maxZ, top }
const platMat = new THREE.MeshStandardMaterial({
  color: 0x11203a, roughness: 0.5, metalness: 0.5,
  emissive: 0x123a55, emissiveIntensity: 0.5,
});
const edgeMat = new THREE.LineBasicMaterial({ color: 0x4df3ff, transparent: true, opacity: 0.85 });
for (const [x, z, w, d, top] of PLATFORM_DEFS) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, top, d), platMat);
  mesh.position.set(x, top / 2, z);
  scene.add(mesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMat);
  edges.position.copy(mesh.position);
  scene.add(edges);
  platforms.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top });
}

// Rayon contre les plateformes (méthode des slabs). Retourne la distance du
// premier impact, ou Infinity. Sert au clipping des tirs et à la ligne de vue.
function raycastWorld(origin, dir, maxDist = Infinity) {
  let tHit = Infinity;
  for (const p of platforms) {
    let tMin = 0, tMax = Math.min(maxDist, tHit);
    let ok = true;
    const bounds = [
      [p.minX, p.maxX, origin.x, dir.x],
      [0, p.top, origin.y, dir.y],
      [p.minZ, p.maxZ, origin.z, dir.z],
    ];
    for (const [lo, hi, o, d] of bounds) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) { ok = false; break; }
      } else {
        let t1 = (lo - o) / d, t2 = (hi - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) { ok = false; break; }
      }
    }
    if (ok && tMin < tHit && tMin > 0.01) tHit = tMin;
  }
  return tHit;
}
function hasLOS(a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const d = dir.length();
  if (d < 0.01) return true;
  dir.divideScalar(d);
  return raycastWorld(a, dir, d) >= d;
}

// --- Audio (WebAudio, généré à la volée) -------------------------------------
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
// `at` (Vector3 optionnel) : spatialise le son — panoramique gauche/droite selon
// la position par rapport au regard du joueur, volume atténué par la distance.
function beep({ type = 'sine', from = 440, to = from, dur = 0.12, gain = 0.15, at = null }) {
  if (!audioCtx) return;
  let pan = 0;
  if (at) {
    const dx = at.x - player.pos.x, dz = at.z - player.pos.z;
    const dist = Math.max(1, Math.hypot(dx, dz));
    // repère local : forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)
    const r = dx * Math.cos(player.yaw) + dz * -Math.sin(player.yaw);
    pan = THREE.MathUtils.clamp(r / dist, -1, 1) * 0.9;
    gain *= THREE.MathUtils.clamp(14 / dist, 0.25, 1);
  }
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  let tail = g;
  if (at && audioCtx.createStereoPanner) {
    const panner = audioCtx.createStereoPanner();
    panner.pan.value = pan;
    g.connect(panner);
    tail = panner;
  }
  osc.connect(g);
  tail.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur);
}
const sfx = {
  shoot: () => beep({ type: 'square', from: 260, to: 70, dur: 0.09, gain: 0.08 }),
  swap: (at) => { beep({ type: 'sine', from: 300, to: 1050, dur: 0.18, gain: 0.14, at }); beep({ type: 'triangle', from: 150, to: 40, dur: 0.25, gain: 0.12, at }); },
  botSwap: (at) => {
    // signature sonore distincte et FORTE : le bot vient de se téléporter
    beep({ type: 'sawtooth', from: 1200, to: 200, dur: 0.3, gain: 0.22, at });
    beep({ type: 'sine', from: 200, to: 900, dur: 0.25, gain: 0.18, at });
  },
  hurt: () => beep({ type: 'sawtooth', from: 160, to: 60, dur: 0.2, gain: 0.12 }),
  enemyShot: (at) => beep({ type: 'sawtooth', from: 520, to: 320, dur: 0.1, gain: 0.06, at }),
  botShot: (at) => beep({ type: 'square', from: 190, to: 90, dur: 0.1, gain: 0.12, at }),
  hitmark: () => beep({ type: 'sine', from: 900, to: 700, dur: 0.05, gain: 0.09 }),
  wave: () => { beep({ type: 'sine', from: 440, to: 660, dur: 0.3, gain: 0.1 }); beep({ type: 'sine', from: 660, to: 880, dur: 0.4, gain: 0.08 }); },
  death: () => beep({ type: 'sawtooth', from: 220, to: 30, dur: 0.9, gain: 0.18 }),
  botDeath: (at) => { beep({ type: 'sawtooth', from: 300, to: 40, dur: 0.5, gain: 0.14, at }); beep({ type: 'sine', from: 500, to: 1200, dur: 0.3, gain: 0.08, at }); },
  win: () => { beep({ type: 'sine', from: 523, to: 784, dur: 0.5, gain: 0.14 }); beep({ type: 'sine', from: 784, to: 1046, dur: 0.6, gain: 0.1 }); },
};

// --- État de jeu -------------------------------------------------------------
const state = {
  phase: 'menu',           // menu | playing | paused | dead
  mode: 'waves',           // waves | duel
  score: 0,
  wave: 0,
  combo: 0,
  comboTimer: 0,
  waveCooldown: 0,
  time: 0,
  duel: { player: 0, bot: 0 },
};

const player = {
  pos: new THREE.Vector3(0, 0, 26),   // position des PIEDS (zone dégagée, dos au mur sud)
  vel: new THREE.Vector3(),
  yaw: 0,                              // regarde vers le centre de l'arène
  pitch: 0,
  onGround: true,
  hp: 100,
  lastHurt: -10,
  swapGrace: 0,
  fovPunch: 0,
};

const enemies = [];        // drones (hostiles en vagues, neutres en duel)
const projectiles = [];
const effects = [];
const droneRespawns = [];  // timers de réapparition (duel)

function eyePos() {
  return new THREE.Vector3(player.pos.x, player.pos.y + EYE_HEIGHT, player.pos.z);
}

// --- Drones -----------------------------------------------------------------
const enemyCoreGeo = new THREE.OctahedronGeometry(0.6, 0);
const enemyShellGeo = new THREE.OctahedronGeometry(0.95, 1);
function spawnEnemy(x, y, z) {
  const group = new THREE.Group();
  const neutral = isDuel();
  const coreColor = neutral ? 0x4df3ff : 0xff3d6e;
  const core = new THREE.Mesh(
    enemyCoreGeo,
    new THREE.MeshStandardMaterial({ color: coreColor, emissive: coreColor, emissiveIntensity: 1.6, roughness: 0.3 })
  );
  const shell = new THREE.Mesh(
    enemyShellGeo,
    new THREE.MeshBasicMaterial({ color: neutral ? 0x9be8ff : 0xff88aa, wireframe: true, transparent: true, opacity: 0.5 })
  );
  group.add(core, shell);
  group.position.set(x, y, z);
  scene.add(group);
  enemies.push({
    mesh: group, core, shell,
    anchor: new THREE.Vector3(x, y, z),
    baseY: y,
    bobPhase: Math.random() * Math.PI * 2,
    orbitDir: Math.random() < 0.5 ? 1 : -1,
    orbitRadius: 9 + Math.random() * 8,
    fireTimer: 1.5 + Math.random() * 2.5,
    alive: true,
  });
}

function randomDronePos(minDistFromPlayer = 8) {
  let x, z;
  do {
    x = (Math.random() * 2 - 1) * (ARENA_HALF - 4);
    z = (Math.random() * 2 - 1) * (ARENA_HALF - 4);
  } while (Math.hypot(x - player.pos.x, z - player.pos.z) < minDistFromPlayer);
  return { x, y: 2 + Math.random() * 10, z };
}

function spawnWave(n) {
  const count = Math.min(2 + n, 12);
  for (let i = 0; i < count; i++) {
    const p = randomDronePos(12);
    spawnEnemy(p.x, p.y, p.z);
  }
  hudWave.textContent = n;
  if (n > 1) sfx.wave();
}

function enemyFireInterval() { return Math.max(1.2, 3.2 - state.wave * 0.18); }
function projectileSpeed() { return 13 + state.wave * 0.8; }

// --- Projectiles ennemis (mode vagues uniquement) ------------------------------
const projGeo = new THREE.SphereGeometry(0.22, 8, 8);
const projMat = new THREE.MeshBasicMaterial({ color: 0xffd54d });
function fireProjectile(fromPos) {
  const mesh = new THREE.Mesh(projGeo, projMat.clone());
  mesh.position.copy(fromPos);
  const target = eyePos();
  target.x += (Math.random() - 0.5) * 1.6;
  target.y += (Math.random() - 0.5) * 1.2;
  target.z += (Math.random() - 0.5) * 1.6;
  const vel = target.sub(fromPos).normalize().multiplyScalar(projectileSpeed());
  scene.add(mesh);
  projectiles.push({ mesh, vel, life: 6 });
  sfx.enemyShot(fromPos);
}

// --- Effets ------------------------------------------------------------------
function addRing(pos, color = 0x4df3ff) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.55, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.position.copy(pos);
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);
  effects.push({ mesh: ring, life: 0.5, maxLife: 0.5, grow: 14 });
}
function addBurst(pos, color = 0xff3d6e, count = 26) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const vels = [];
  for (let i = 0; i < count; i++) {
    positions.set([pos.x, pos.y, pos.z], i * 3);
    vels.push(new THREE.Vector3().randomDirection().multiplyScalar(4 + Math.random() * 6));
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.18, transparent: true, opacity: 1, depthWrite: false }));
  scene.add(pts);
  effects.push({ mesh: pts, life: 0.6, maxLife: 0.6, vels });
}
function addTracer(from, to, color = 0x4df3ff) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  scene.add(line);
  effects.push({ mesh: line, life: 0.12, maxLife: 0.12 });
}

// --- L'ÉCHO : tuer le bot laisse 10 s pour décider de voler sa position (touche E)
const ECHO_DURATION = 10;
const echoHint = $('echo-hint');
const echoTimer = $('echo-timer');
let echo = null;   // { pos, life, group, beam, ring }
let echoSeq = 0;   // identifiant d'écho (le bot décide une fois par écho s'il campe)

function createEcho(pos) {
  removeEcho();
  const group = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 14, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd54d, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
  );
  beam.position.y = 7;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 0.95, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd54d, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.12;
  group.add(beam, ring);
  group.position.set(pos.x, Math.max(0, pos.y), pos.z);
  scene.add(group);
  echo = { pos: new THREE.Vector3(pos.x, Math.max(0, pos.y), pos.z), life: ECHO_DURATION, group, beam, ring, hp: ECHO_HP, flash: 0 };
  echoSeq++;
  echoHint.classList.remove('hurt');
  echoHint.style.display = 'block';
  beep({ type: 'sine', from: 600, to: 1100, dur: 0.25, gain: 0.1 });
}

function removeEcho() {
  if (!echo) return;
  scene.remove(echo.group);
  echo = null;
  echoHint.style.display = 'none';
}

// le bot peut tirer sur l'écho pour te voler ta téléportation
function damageEcho(amount) {
  if (!echo) return;
  echo.hp -= amount;
  echo.flash = 0.25;
  echoHint.classList.add('hurt');
  if (echo.hp <= 0) {
    const pos = echo.pos.clone();
    addBurst(pos.clone().setY(pos.y + 1.2), 0xffd54d, 34);
    addRing(new THREE.Vector3(pos.x, Math.max(0.1, pos.y + 0.1), pos.z), 0xffd54d);
    removeEcho();
    // verre brisé : ton écho est parti
    beep({ type: 'sawtooth', from: 900, to: 80, dur: 0.45, gain: 0.16, at: pos });
    beep({ type: 'square', from: 1400, to: 400, dur: 0.2, gain: 0.1, at: pos });
  }
}

function useEcho() {
  if (!echo || state.phase !== 'playing') return;
  addBurst(eyePos(), 0xffd54d);
  addRing(new THREE.Vector3(player.pos.x, Math.max(0.1, player.pos.y + 0.1), player.pos.z), 0xffd54d);
  player.pos.copy(echo.pos);
  player.onGround = false;
  player.swapGrace = SWAP_GRACE;
  player.fovPunch = 1;
  addBurst(echo.pos.clone().setY(echo.pos.y + 1.2), 0xffd54d);
  flashEl.style.opacity = '0.55';
  setTimeout(() => (flashEl.style.opacity = '0'), 70);
  beep({ type: 'sine', from: 250, to: 950, dur: 0.2, gain: 0.15 });
  beep({ type: 'triangle', from: 120, to: 35, dur: 0.3, gain: 0.13 });
  removeEcho();
}

function updateEcho(dt) {
  if (!echo) return;
  echo.life -= dt;
  if (echo.life <= 0) {
    removeEcho();
    beep({ type: 'sine', from: 500, to: 200, dur: 0.25, gain: 0.07 });
    return;
  }
  const pulse = 1 + 0.15 * Math.sin(state.time * 6);
  echo.ring.scale.set(pulse, pulse, 1);
  echo.flash = Math.max(0, echo.flash - dt);
  echo.beam.material.opacity = 0.16 + 0.08 * Math.sin(state.time * 4) + echo.flash * 2.2;
  echoTimer.textContent = Math.ceil(echo.life);
}

// --- Les BOTS (joueurs simulés, modes duel 1v1 et 1v2) ---------------------------
const isDuel = () => state.mode === 'duel' || state.mode === 'duel2';

function makeBot(color) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 0.8, 4, 12),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.4, metalness: 0.3 })
  );
  body.position.y = 0.95;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x1a1a22, emissive: 0x111118, roughness: 0.3, metalness: 0.7 })
  );
  head.position.y = 1.68;
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.09, 0.1),
    new THREE.MeshBasicMaterial({ color: 0xffd54d })
  );
  visor.position.set(0, 1.7, -0.22);
  const barBg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false })
  );
  barBg.position.y = 2.25;
  const barFill = new THREE.Mesh(
    new THREE.PlaneGeometry(1.06, 0.08),
    new THREE.MeshBasicMaterial({ color: 0x2fe6a8, depthWrite: false })
  );
  barFill.position.set(0, 2.25, 0.001);
  group.add(body, head, visor, barBg, barFill);
  return {
    color,
    pos: new THREE.Vector3(0, 0, -18),
    vel: new THREE.Vector3(),
    onGround: true,
    hp: BOT_HP, alive: false, respawnTimer: 0,
    yaw: 0, strafeDir: 1, strafeTimer: 0, fireTimer: 1,
    losTimer: 0, stuckTimer: 0, swapCd: 0, grace: 0,
    rangeOffset: 0,          // distance de combat préférée décalée par coéquipier
    echoSeen: -1, echoCamps: false, echoPlan: 'camp',
    group, hpFill: barFill, barBg,
  };
}
const botPool = [makeBot(0xff8c3d), makeBot(0xb06bff)];   // orange, violet
const bots = [];   // bots actifs de la partie en cours

// handicap d'équipe : à 2 bots, chacun tape moins fort et tire moins vite
const teamDmg = () => (bots.length > 1 ? 0.75 : 1);
const teamFire = () => (bots.length > 1 ? 1.3 : 1);

function botEye(b) {
  return new THREE.Vector3(b.pos.x, b.pos.y + 1.5, b.pos.z);
}

function respawnBot(b) {
  // apparaît loin du joueur
  let best = null, bestD = -1;
  for (let i = 0; i < 12; i++) {
    const x = (Math.random() * 2 - 1) * (ARENA_HALF - 5);
    const z = (Math.random() * 2 - 1) * (ARENA_HALF - 5);
    const d = Math.hypot(x - player.pos.x, z - player.pos.z);
    if (d > bestD) { bestD = d; best = { x, z }; }
  }
  b.pos.set(best.x, 0, best.z);
  b.vel.set(0, 0, 0);
  b.hp = BOT_HP;
  b.alive = true;
  b.grace = 1;
  b.swapCd = 2;
  b.fireTimer = 1.2;
  scene.add(b.group);
  addRing(new THREE.Vector3(best.x, 0.1, best.z), b.color);
}

function damageBot(b, amount, hitPoint) {
  if (!b.alive || b.grace > 0) return;
  b.hp -= amount;
  addBurst(hitPoint, 0xffd54d, 10);
  sfx.hitmark();
  if (b.hp <= 0) {
    b.alive = false;
    b.respawnTimer = 3;
    scene.remove(b.group);
    addBurst(botEye(b), b.color, 40);
    addRing(new THREE.Vector3(b.pos.x, Math.max(0.1, b.pos.y + 0.1), b.pos.z), b.color);
    sfx.botDeath(b.pos);
    state.duel.player += 1;
    updateDuelHud();
    if (state.duel.player >= DUEL_TARGET) { duelEnd(true); return; }
    createEcho(b.pos);   // 10 s pour décider de voler sa position (E)
  }
}

// Les bots utilisent la même règle que le joueur : tirer sur un drone = swap.
function botSwapViaDrone(b, drone) {
  const dronePos = drone.mesh.position.clone();
  addTracer(botEye(b), dronePos, b.color);
  killDrone(drone, botEye(b));
  b.pos.set(dronePos.x, Math.max(0, dronePos.y - 0.8), dronePos.z);
  b.vel.set(0, 0, 0);
  b.onGround = false;
  // pas d'invulnérabilité post-swap : tracker le bot à travers sa TP doit payer
  b.swapCd = DIFF().swapCd;
  addRing(new THREE.Vector3(dronePos.x, Math.max(0.1, dronePos.y - 1), dronePos.z), b.color);
  addBurst(dronePos, b.color);
  sfx.botSwap(dronePos);
}

function killDrone(drone, burstAt) {
  drone.alive = false;
  scene.remove(drone.mesh);
  if (burstAt) addBurst(burstAt, 0x4df3ff, 14);
  if (isDuel()) droneRespawns.push(DRONE_RESPAWN);
}

function updateBot(b, dt) {
  if (!b.alive) {
    b.respawnTimer -= dt;
    if (b.respawnTimer <= 0 && state.phase === 'playing') respawnBot(b);
    return;
  }
  b.grace = Math.max(0, b.grace - dt);
  b.swapCd = Math.max(0, b.swapCd - dt);
  // la grâce de respawn est LISIBLE : le bot clignote tant qu'il est invulnérable
  b.group.visible = b.grace <= 0 || Math.sin(state.time * 30) > 0;

  const pEye = eyePos();
  const bEye = botEye(b);
  const toPlayer = new THREE.Vector3().subVectors(pEye, bEye);
  const dist = toPlayer.length();
  const los = hasLOS(bEye, pEye);
  b.losTimer = los ? 0 : b.losTimer + dt;

  // décision par écho, selon la difficulté : ignorer, CAMPER (embuscade
  // silencieuse) ou DÉTRUIRE (déni : 3 tirs et ta téléportation disparaît).
  // À 2 bots, un seul conteste chaque écho — l'autre reste sur le joueur.
  if (echo && b.echoSeen !== echoSeq) {
    b.echoSeen = echoSeq;
    const eligible = bots.length <= 1 || bots[echoSeq % bots.length] === b;
    b.echoCamps = eligible && Math.random() < DIFF().campChance;
    b.echoPlan = Math.random() < DIFF().deny ? 'destroy' : 'camp';
  }
  const contesting = !!echo && b.echoCamps;
  const denying = contesting && b.echoPlan === 'destroy';

  // --- déplacement
  b.strafeTimer -= dt;
  if (b.strafeTimer <= 0) {
    b.strafeDir = Math.random() < 0.5 ? -1 : 1;
    b.strafeTimer = 0.8 + Math.random() * 1.2;
  }
  const flat = new THREE.Vector3(toPlayer.x, 0, toPlayer.z).normalize();
  const tangent = new THREE.Vector3(-flat.z, 0, flat.x).multiplyScalar(b.strafeDir);
  const wish = new THREE.Vector3();
  if (contesting && (!los || dist > 18)) {
    // CONTEST : se poste à ~5-9 m de l'écho, tourne autour, gâchette nerveuse
    const toEcho = new THREE.Vector3().subVectors(echo.pos, b.pos);
    toEcho.y = 0;
    const dEcho = toEcho.length();
    toEcho.normalize();
    const eTangent = new THREE.Vector3(-toEcho.z, 0, toEcho.x).multiplyScalar(b.strafeDir);
    if (dEcho > 9) wish.add(toEcho);
    else if (dEcho < 5) wish.addScaledVector(toEcho, -1);
    else wish.add(eTangent);
    // gâchette nerveuse uniquement en embuscade — la destruction garde sa cadence
    if (!denying) b.fireTimer = Math.min(b.fireTimer, 0.35);
  } else {
    // distance préférée décalée par coéquipier : l'un presse, l'autre couvre
    if (!los || dist > 16 + b.rangeOffset) wish.add(flat);
    else if (dist < 8 + b.rangeOffset * 0.5) wish.addScaledVector(flat, -1);
    if (los) wish.add(tangent);
  }
  // espacement d'équipe : ne pas se marcher dessus
  for (const o of bots) {
    if (o === b || !o.alive) continue;
    const away = new THREE.Vector3(b.pos.x - o.pos.x, 0, b.pos.z - o.pos.z);
    const d = away.length();
    if (d > 0.01 && d < 4) wish.addScaledVector(away.normalize(), (4 - d) / 4);
  }
  if (wish.lengthSq() > 0) wish.normalize();

  // saute si bloqué contre un obstacle
  const hSpeed = Math.hypot(b.vel.x, b.vel.z);
  let wantJump = false;
  if (wish.lengthSq() > 0 && hSpeed < 1.2 && b.onGround) {
    b.stuckTimer += dt;
    if (b.stuckTimer > 0.4) { wantJump = true; b.stuckTimer = 0; }
  } else {
    b.stuckTimer = 0;
  }

  moveBody(b, wish, wantJump, dt, BOT_MOVE_SPEED);

  // orientation visuelle + barre de vie face caméra
  b.group.position.copy(b.pos);
  b.group.rotation.y = Math.atan2(-toPlayer.x, -toPlayer.z) + Math.PI;
  b.hpFill.scale.x = Math.max(0.001, b.hp / BOT_HP);
  b.hpFill.position.x = -(1 - b.hp / BOT_HP) * 0.53;
  b.hpFill.material.color.setHex(b.hp > 40 ? 0x2fe6a8 : 0xff3d6e);
  b.barBg.lookAt(camera.position);
  b.hpFill.lookAt(camera.position);

  // --- tir : hitscan bruité, seulement avec ligne de vue
  b.fireTimer -= dt;
  if (los && dist < 42 && b.fireTimer <= 0) {
    b.fireTimer = (DIFF().fireMin + Math.random() * DIFF().fireVar) * teamFire();
    const dir = new THREE.Vector3().subVectors(pEye, bEye).normalize();
    dir.add(new THREE.Vector3().randomDirection().multiplyScalar(DIFF().noise)).normalize();
    const wallDist = raycastWorld(bEye, dir);
    // le tir touche-t-il le joueur (2 sphères : tête et torse) ?
    let hitT = Infinity;
    for (const targetPos of [pEye, new THREE.Vector3(player.pos.x, player.pos.y + 0.5, player.pos.z)]) {
      const toT = targetPos.clone().sub(bEye);
      const proj = toT.dot(dir);
      if (proj < 0) continue;
      const closest = bEye.clone().addScaledVector(dir, proj);
      if (closest.distanceTo(targetPos) < 0.55 && proj < hitT) hitT = proj;
    }
    const end = bEye.clone().addScaledVector(dir, Math.min(hitT, wallDist, 60));
    addTracer(bEye.clone().addScaledVector(dir, 1), end, b.color);
    sfx.botShot(bEye);
    if (hitT < wallDist) hurtPlayer(DIFF().dmg * teamDmg(), bEye);
  } else if (denying && b.fireTimer <= 0) {
    // pas de joueur en vue : il démonte ton écho — chaque tir trahit sa position
    const echoMid = echo.pos.clone().setY(echo.pos.y + 1.2);
    const dEcho = echoMid.distanceTo(bEye);
    if (dEcho < 30 && hasLOS(bEye, echoMid)) {
      b.fireTimer = (DIFF().fireMin + Math.random() * DIFF().fireVar) * teamFire();
      addTracer(bEye.clone().lerp(echoMid, 0.06), echoMid, b.color);
      sfx.botShot(bEye);
      damageEcho(25);
    }
  }

  // --- swap tactique via un drone : pour fuir (PV bas) ou retrouver le joueur
  // (jamais pendant qu'il campe l'écho : il tient sa position)
  if (!contesting && b.swapCd <= 0 && (b.hp < 35 || b.losTimer > 2.5)) {
    let best = null, bestD = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = e.mesh.position.distanceTo(bEye);
      if (d < bestD && hasLOS(bEye, e.mesh.position)) { best = e; bestD = d; }
    }
    if (best) botSwapViaDrone(b, best);
  }
}

// --- Entrées tactiles (mobile) -------------------------------------------------
// Détection : écran tactile "grossier" ou ?touch=1 pour forcer (tests/hybrides)
const IS_TOUCH = /[?&]touch=1/.test(location.search) ||
  (window.matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0);
if (IS_TOUCH) document.body.classList.add('touch');

const touch = { joy: new THREE.Vector2(), jumpQueued: false, moveId: null, lookId: null, lookLast: { x: 0, y: 0 }, lookStart: null, lookDrag: 0, joyCenter: { x: 0, y: 0 } };
const JOY_RADIUS = 48;
let layoutEdit = false;   // mode « déplacer les touches »

// positions personnalisées des boutons tactiles (en % de l'écran)
const MOVABLE_KEYS = ['btn-fire', 'btn-jump', 'btn-pause', 'echo-hint'];
function applyLayout() {
  for (const id of MOVABLE_KEYS) {
    const el = $(id);
    const p = settings.layout[id];
    if (p) {
      el.style.left = p.cx + '%';
      el.style.top = p.cy + '%';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.transform = 'translate(-50%, -50%)';
    } else {
      el.style.left = el.style.top = el.style.right = el.style.bottom = el.style.transform = '';
    }
  }
}
applyLayout();

if (IS_TOUCH) {
  const joyZone = $('joy-zone');
  const joyBase = $('joy-base');
  const joyStick = $('joy-stick');
  const lookZone = $('look-zone');

  joyZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (touch.moveId !== null) return;
    const t = e.changedTouches[0];
    touch.moveId = t.identifier;
    touch.joyCenter = { x: t.clientX, y: t.clientY };
    joyBase.style.display = 'block';
    joyBase.style.left = t.clientX + 'px';
    joyBase.style.top = t.clientY + 'px';
  }, { passive: false });
  joyZone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== touch.moveId) continue;
      let dx = t.clientX - touch.joyCenter.x;
      let dy = t.clientY - touch.joyCenter.y;
      const len = Math.hypot(dx, dy);
      if (len > JOY_RADIUS) { dx *= JOY_RADIUS / len; dy *= JOY_RADIUS / len; }
      joyStick.style.transform = `translate(${dx}px, ${dy}px)`;
      touch.joy.set(dx / JOY_RADIUS, dy / JOY_RADIUS);   // haut d'écran = -y = avant (-z)
    }
  }, { passive: false });
  const joyEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== touch.moveId) continue;
      touch.moveId = null;
      touch.joy.set(0, 0);
      joyStick.style.transform = 'translate(0,0)';
      joyBase.style.display = 'none';
    }
  };
  joyZone.addEventListener('touchend', joyEnd);
  joyZone.addEventListener('touchcancel', joyEnd);

  lookZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (touch.lookId !== null) return;
    const t = e.changedTouches[0];
    touch.lookId = t.identifier;
    touch.lookLast = { x: t.clientX, y: t.clientY };
    touch.lookStart = { x: t.clientX, y: t.clientY, time: performance.now() };
    touch.lookDrag = 0;
  }, { passive: false });
  lookZone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== touch.lookId) continue;
      touch.lookDrag += Math.hypot(t.clientX - touch.lookLast.x, t.clientY - touch.lookLast.y);
      if (state.phase === 'playing') {
        player.yaw -= (t.clientX - touch.lookLast.x) * 0.005 * settings.sens;
        player.pitch -= (t.clientY - touch.lookLast.y) * 0.005 * settings.sens;
        player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));
      }
      touch.lookLast = { x: t.clientX, y: t.clientY };
    }
  }, { passive: false });
  const lookEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== touch.lookId) continue;
      touch.lookId = null;
      // TAP court et immobile = TIR (le même pouce vise ET tire)
      if (state.phase === 'playing' && touch.lookStart &&
          performance.now() - touch.lookStart.time < 220 && touch.lookDrag < 12) {
        shoot();
      }
      touch.lookStart = null;
    }
  };
  lookZone.addEventListener('touchend', lookEnd);
  lookZone.addEventListener('touchcancel', lookEnd);

  $('btn-fire').addEventListener('touchstart', (e) => { e.preventDefault(); if (!layoutEdit && state.phase === 'playing') shoot(); }, { passive: false });
  $('btn-jump').addEventListener('touchstart', (e) => { e.preventDefault(); if (!layoutEdit) touch.jumpQueued = true; }, { passive: false });
  $('btn-pause').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (layoutEdit || state.phase !== 'playing') return;
    overlayTitle.innerHTML = 'PAUSE';
    deathStats.style.display = 'none';
    modeButtons.style.display = 'none';
    resumeCta.style.display = '';
    overlay.classList.remove('hidden');
    state.phase = 'paused';
  }, { passive: false });
  echoHint.addEventListener('touchstart', (e) => { e.preventDefault(); if (!layoutEdit) useEcho(); }, { passive: false });

  // --- éditeur de disposition : glisser les boutons où on veut -------------------
  const setLayoutEdit = (on) => {
    layoutEdit = on;
    document.body.classList.toggle('layout-edit', on);
    overlay.classList.toggle('hidden', on);
  };
  $('layout-btn').addEventListener('click', (e) => { e.stopPropagation(); setLayoutEdit(true); });
  $('layout-done').addEventListener('click', () => setLayoutEdit(false));
  $('layout-reset').addEventListener('click', () => {
    settings.layout = {};
    applyLayout();
    applySettings();
  });

  let dragEl = null, dragId = null;
  for (const id of MOVABLE_KEYS) {
    $(id).addEventListener('touchstart', (e) => {
      if (!layoutEdit) return;
      e.preventDefault();
      dragEl = $(id);
      dragId = e.changedTouches[0].identifier;
    }, { passive: false });
  }
  document.addEventListener('touchmove', (e) => {
    if (!layoutEdit || !dragEl) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== dragId) continue;
      e.preventDefault();
      settings.layout[dragEl.id] = {
        cx: +THREE.MathUtils.clamp((t.clientX / window.innerWidth) * 100, 4, 96).toFixed(1),
        cy: +THREE.MathUtils.clamp((t.clientY / window.innerHeight) * 100, 6, 94).toFixed(1),
      };
      applyLayout();
    }
  }, { passive: false });
  document.addEventListener('touchend', (e) => {
    if (!layoutEdit || !dragEl) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== dragId) continue;
      dragEl = null;
      dragId = null;
      applySettings();   // persiste la disposition
    }
  });
}

function tryFullscreen() {
  const el = document.documentElement;
  if (el.requestFullscreen) {
    el.requestFullscreen()
      .then(() => { if (screen.orientation && screen.orientation.lock) return screen.orientation.lock('landscape'); })
      .catch(() => { /* refus / non supporté : pas bloquant */ });
  }
}

// --- Entrées -----------------------------------------------------------------
const keys = new Set();
document.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyE' && isDuel()) useEcho();
});
document.addEventListener('keyup', (e) => keys.delete(e.code));

document.addEventListener('mousemove', (e) => {
  if (state.phase !== 'playing' || document.pointerLockElement !== renderer.domElement) return;
  player.yaw -= e.movementX * 0.0022 * settings.sens;
  player.pitch -= e.movementY * 0.0022 * settings.sens;
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));
});

function startGame(mode) {
  ensureAudio();
  resetGame(mode);
  if (IS_TOUCH) {
    // pas de pointer lock sur mobile : on démarre direct, en plein écran paysage
    tryFullscreen();
    state.phase = 'playing';
    overlay.classList.add('hidden');
  } else {
    renderer.domElement.requestPointerLock();
  }
}
$('play-waves').addEventListener('click', (e) => { e.stopPropagation(); startGame('waves'); });
$('play-nomove').addEventListener('click', (e) => { e.stopPropagation(); startGame('nomove'); });
$('play-duel').addEventListener('click', (e) => { e.stopPropagation(); startGame('duel'); });
$('play-duel2').addEventListener('click', (e) => { e.stopPropagation(); startGame('duel2'); });

overlay.addEventListener('click', () => {
  if (state.phase === 'paused') {
    ensureAudio();
    if (IS_TOUCH) {
      state.phase = 'playing';
      overlay.classList.add('hidden');
    } else {
      renderer.domElement.requestPointerLock();
    }
  }
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === renderer.domElement) {
    state.phase = 'playing';
    overlay.classList.add('hidden');
  } else if (state.phase === 'playing') {
    overlayTitle.innerHTML = 'PAUSE';
    deathStats.style.display = 'none';
    modeButtons.style.display = 'none';
    resumeCta.style.display = '';
    overlay.classList.remove('hidden');
    state.phase = 'paused';
  }
});

document.addEventListener('mousedown', (e) => {
  if (state.phase === 'playing' && e.button === 0 && document.pointerLockElement === renderer.domElement) {
    shoot();
  }
});

// --- Tir du joueur ---------------------------------------------------------------
function shoot() {
  sfx.shoot();
  player.fovPunch = Math.max(player.fovPunch, 0.25);

  const origin = eyePos();
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));

  // magnétisme de visée (mobile) : si une cible est à < ~6° du réticule et en
  // ligne de vue, le tir se verrouille dessus — viser au pouce reste jouable
  if (IS_TOUCH) {
    const candidates = enemies.filter((e) => e.alive).map((e) => e.mesh.position.clone());
    if (isDuel()) {
      for (const b of bots) {
        if (b.alive && b.grace <= 0) candidates.push(new THREE.Vector3(b.pos.x, b.pos.y + 1.0, b.pos.z));
      }
    }
    let bestDir = null, bestAng = 0.105;
    for (const c of candidates) {
      const to = c.sub(origin);
      const d = to.length();
      to.divideScalar(d);
      const ang = Math.acos(THREE.MathUtils.clamp(to.dot(dir), -1, 1));
      if (ang < bestAng && raycastWorld(origin, to, d) >= d) { bestAng = ang; bestDir = to; }
    }
    if (bestDir) dir.copy(bestDir);
  }

  const wallDist = raycastWorld(origin, dir);

  // drones : test sphère (rayon élargi sur mobile — aide à la visée tactile)
  const aimAssist = IS_TOUCH ? 1.35 : 1;
  let bestDrone = null, droneT = Infinity;
  for (const e of enemies) {
    if (!e.alive) continue;
    const toCenter = e.mesh.position.clone().sub(origin);
    const proj = toCenter.dot(dir);
    if (proj < 0 || proj > wallDist) continue;
    const closest = origin.clone().addScaledVector(dir, proj);
    if (closest.distanceTo(e.mesh.position) <= ENEMY_RADIUS * aimAssist && proj < droneT) {
      bestDrone = e; droneT = proj;
    }
  }

  // bots : 2 sphères chacun (tête, torse) — dégâts, PAS de swap entre joueurs
  let botT = Infinity, botHitPoint = null, hitBot = null;
  if (isDuel()) {
    for (const b of bots) {
      if (!b.alive) continue;
      for (const [center, r] of [
        [new THREE.Vector3(b.pos.x, b.pos.y + 1.6, b.pos.z), 0.4 * aimAssist],
        [new THREE.Vector3(b.pos.x, b.pos.y + 0.9, b.pos.z), 0.55 * aimAssist],
      ]) {
        const toC = center.clone().sub(origin);
        const proj = toC.dot(dir);
        if (proj < 0 || proj > wallDist) continue;
        const closest = origin.clone().addScaledVector(dir, proj);
        if (closest.distanceTo(center) <= r && proj < botT) {
          botT = proj;
          botHitPoint = closest;
          hitBot = b;
        }
      }
    }
  }

  const muzzle = origin.clone().addScaledVector(dir, 0.8).add(new THREE.Vector3(0, -0.15, 0));
  if (botT < droneT) {
    addTracer(muzzle, botHitPoint);
    damageBot(hitBot, PLAYER_DMG, botHitPoint);
  } else if (bestDrone) {
    addTracer(muzzle, bestDrone.mesh.position.clone());
    doSwap(bestDrone);
  } else {
    addTracer(muzzle, origin.clone().addScaledVector(dir, Math.min(wallDist, 60)));
  }
}

function doSwap(drone) {
  const dronePos = drone.mesh.position.clone();
  const oldEyePos = eyePos();

  killDrone(drone, oldEyePos);
  addRing(new THREE.Vector3(oldEyePos.x, Math.max(0.1, player.pos.y + 0.1), oldEyePos.z), 0xff3d6e);

  player.pos.set(dronePos.x, Math.max(0, dronePos.y - EYE_HEIGHT * 0.5), dronePos.z);
  player.onGround = false;
  player.swapGrace = SWAP_GRACE;
  addRing(new THREE.Vector3(dronePos.x, Math.max(0.1, dronePos.y - 1), dronePos.z), 0x4df3ff);
  addBurst(dronePos, 0x4df3ff);

  // score/combo : modes vagues et swap-only (en duel, le swap est de la mobilité)
  if (!isDuel()) {
    state.combo = state.comboTimer > 0 ? state.combo + 1 : 1;
    state.comboTimer = COMBO_WINDOW;
    state.score += 100 * state.combo;
    hudScore.textContent = state.score;
    if (state.combo > 1) {
      hudCombo.textContent = `COMBO ×${state.combo}`;
      hudCombo.classList.add('show');
    }
  }

  flashEl.style.opacity = '0.55';
  setTimeout(() => (flashEl.style.opacity = '0'), 70);
  player.fovPunch = 1;
  sfx.swap();
}

// --- Indicateurs directionnels de dégâts ------------------------------------------
const dmgContainer = $('dmg-container');
const dmgIndicators = [];   // { el, source: Vector3, life }
function addDmgIndicator(sourcePos) {
  const el = document.createElement('div');
  el.className = 'dmg-arc';
  dmgContainer.appendChild(el);
  dmgIndicators.push({ el, source: sourcePos.clone(), life: 1.4 });
}
// suit la source pendant que le joueur tourne la tête
function updateDmgIndicators(dt) {
  for (let i = dmgIndicators.length - 1; i >= 0; i--) {
    const d = dmgIndicators[i];
    d.life -= dt;
    if (d.life <= 0) {
      d.el.remove();
      dmgIndicators.splice(i, 1);
      continue;
    }
    const dx = d.source.x - player.pos.x, dz = d.source.z - player.pos.z;
    // composantes avant/droite dans le repère du regard (yaw)
    const f = dx * -Math.sin(player.yaw) + dz * -Math.cos(player.yaw);
    const r = dx * Math.cos(player.yaw) + dz * -Math.sin(player.yaw);
    const deg = Math.atan2(r, f) * (180 / Math.PI);
    d.el.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    d.el.style.opacity = Math.min(1, d.life / 0.5).toFixed(2);
  }
}

// --- Dégâts joueur --------------------------------------------------------------
function hurtPlayer(amount, sourcePos = null) {
  if (player.swapGrace > 0) return;
  player.hp -= amount;
  player.lastHurt = state.time;
  hurtEl.style.opacity = '1';
  setTimeout(() => (hurtEl.style.opacity = '0'), 150);
  sfx.hurt();
  if (sourcePos) addDmgIndicator(sourcePos);
  if (player.hp <= 0) {
    player.hp = 0;
    if (isDuel()) {
      state.duel.bot += 1;
      updateDuelHud();
      if (state.duel.bot >= DUEL_TARGET) { duelEnd(false); updateHpBar(); return; }
      // réapparition immédiate loin des bots, avec grâce
      addBurst(eyePos(), 0xff3d6e, 40);
      sfx.death();
      let best = null, bestD = -1;
      for (const [sx, sz] of [[-24, -24], [24, -24], [-24, 24], [24, 24], [0, 24], [0, -24]]) {
        let d = Infinity;
        for (const b of bots) if (b.alive) d = Math.min(d, Math.hypot(sx - b.pos.x, sz - b.pos.z));
        if (d === Infinity) d = 1;
        if (d > bestD) { bestD = d; best = [sx, sz]; }
      }
      player.pos.set(best[0], 0, best[1]);
      player.vel.set(0, 0, 0);
      player.hp = 100;
      player.swapGrace = 1.2;
      flashEl.style.opacity = '0.7';
      setTimeout(() => (flashEl.style.opacity = '0'), 200);
    } else {
      die();
    }
  }
  updateHpBar();
}

function updateHpBar() {
  const pct = Math.max(0, player.hp);
  hudHpFill.style.width = pct + '%';
  hudHpFill.classList.toggle('low', pct < 35);
}

function updateDuelHud() {
  hudWave.textContent = `${state.duel.player} – ${state.duel.bot}`;
  hudEnemies.textContent = `premier à ${DUEL_TARGET}`;
}

function showEndOverlay(title, stats) {
  state.phase = 'dead';
  document.exitPointerLock();
  overlayTitle.innerHTML = title;
  deathStats.style.display = 'block';
  deathStats.textContent = stats;
  modeButtons.style.display = '';
  resumeCta.style.display = 'none';
  overlay.classList.remove('hidden');
}

// records par mode, persistés
let best = {};
try { best = JSON.parse(localStorage.getItem('swapshot-best') || '{}'); } catch { /* on repart de zéro */ }

function die() {
  sfx.death();
  const prev = best[state.mode];
  const isRecord = !prev || state.score > prev.score;
  if (isRecord) {
    best[state.mode] = { score: state.score, wave: state.wave };
    localStorage.setItem('swapshot-best', JSON.stringify(best));
  }
  const recap = `Score : ${state.score} — Vague ${state.wave}`;
  showEndOverlay(
    'DÉCONNECTÉ',
    isRecord && prev ? `${recap} — NOUVEAU RECORD !`
    : prev ? `${recap} (record : ${prev.score}, vague ${prev.wave})`
    : recap
  );
}

function duelEnd(playerWon) {
  if (playerWon) sfx.win(); else sfx.death();
  showEndOverlay(
    playerWon ? 'VICTOIRE' : 'DÉFAITE',
    `${state.duel.player} – ${state.duel.bot}`
  );
}

function resetGame(mode = state.mode) {
  state.mode = mode;
  for (const e of enemies) scene.remove(e.mesh);
  for (const p of projectiles) scene.remove(p.mesh);
  for (const fx of effects) scene.remove(fx.mesh);
  enemies.length = 0; projectiles.length = 0; effects.length = 0; droneRespawns.length = 0;
  for (const b of botPool) { scene.remove(b.group); b.alive = false; }
  bots.length = 0;
  removeEcho();

  state.score = 0; state.wave = 1; state.combo = 0; state.comboTimer = 0; state.waveCooldown = 0;
  state.duel.player = 0; state.duel.bot = 0;
  // swap only : on démarre au sommet de la tour centrale, vue à 360°
  if (mode === 'nomove') player.pos.set(0, 8, 0);
  else player.pos.set(0, 0, 26);
  player.vel.set(0, 0, 0);
  player.yaw = 0; player.pitch = 0;
  player.hp = 100; player.swapGrace = 0;
  hudScore.textContent = '0';
  hudCombo.classList.remove('show');
  updateHpBar();

  if (isDuel()) {
    const count = mode === 'duel2' ? 2 : 1;
    waveLabel.textContent = count === 2 ? 'Duel 1v2' : 'Duel';
    for (let i = 0; i < DUEL_DRONES; i++) {
      const p = randomDronePos(8);
      spawnEnemy(p.x, p.y, p.z);
    }
    updateDuelHud();
    for (let i = 0; i < count; i++) {
      const b = botPool[i];
      b.rangeOffset = i * 5;   // le 2e bot combat plus loin : pince naturelle
      b.echoSeen = -1;
      b.respawnTimer = 0;
      bots.push(b);
      respawnBot(b);
    }
  } else {
    waveLabel.textContent = 'Vague';
    spawnWave(1);
  }
}

// --- Physique partagée joueur/bot ---------------------------------------------------
// b : { pos (pieds), vel, onGround } — wish : direction horizontale normalisée.
function moveBody(b, wish, wantJump, dt, maxSpeed = MOVE_SPEED) {
  const control = b.onGround ? 1 : AIR_CONTROL;
  const accel = 60 * control;
  b.vel.x += wish.x * accel * dt;
  b.vel.z += wish.z * accel * dt;

  const hv = new THREE.Vector2(b.vel.x, b.vel.z);
  const friction = b.onGround ? Math.pow(0.0001, dt) : Math.pow(0.2, dt);
  if (wish.lengthSq() === 0) hv.multiplyScalar(friction);
  if (hv.length() > maxSpeed) hv.setLength(maxSpeed);
  b.vel.x = hv.x; b.vel.z = hv.y;

  if (wantJump && b.onGround) {
    b.vel.y = JUMP_SPEED;
    b.onGround = false;
  }
  b.vel.y += GRAVITY * dt;

  // horizontal + collisions
  b.pos.x += b.vel.x * dt;
  b.pos.z += b.vel.z * dt;
  const limit = ARENA_HALF - PLAYER_RADIUS - 0.5;
  b.pos.x = Math.max(-limit, Math.min(limit, b.pos.x));
  b.pos.z = Math.max(-limit, Math.min(limit, b.pos.z));

  for (const p of platforms) {
    const withinX = b.pos.x > p.minX - PLAYER_RADIUS && b.pos.x < p.maxX + PLAYER_RADIUS;
    const withinZ = b.pos.z > p.minZ - PLAYER_RADIUS && b.pos.z < p.maxZ + PLAYER_RADIUS;
    const verticalOverlap = b.pos.y < p.top - 0.05 && b.pos.y + PLAYER_HEIGHT > 0;
    if (withinX && withinZ && verticalOverlap) {
      const pushLeft = b.pos.x - (p.minX - PLAYER_RADIUS);
      const pushRight = (p.maxX + PLAYER_RADIUS) - b.pos.x;
      const pushBack = b.pos.z - (p.minZ - PLAYER_RADIUS);
      const pushFront = (p.maxZ + PLAYER_RADIUS) - b.pos.z;
      const min = Math.min(pushLeft, pushRight, pushBack, pushFront);
      if (min === pushLeft) b.pos.x = p.minX - PLAYER_RADIUS;
      else if (min === pushRight) b.pos.x = p.maxX + PLAYER_RADIUS;
      else if (min === pushBack) b.pos.z = p.minZ - PLAYER_RADIUS;
      else b.pos.z = p.maxZ + PLAYER_RADIUS;
    }
  }

  // vertical + atterrissage
  const prevY = b.pos.y;
  b.pos.y += b.vel.y * dt;
  b.onGround = false;

  if (b.pos.y <= 0) {
    b.pos.y = 0;
    b.vel.y = 0;
    b.onGround = true;
  } else if (b.vel.y <= 0) {
    for (const p of platforms) {
      const withinX = b.pos.x > p.minX - PLAYER_RADIUS * 0.5 && b.pos.x < p.maxX + PLAYER_RADIUS * 0.5;
      const withinZ = b.pos.z > p.minZ - PLAYER_RADIUS * 0.5 && b.pos.z < p.maxZ + PLAYER_RADIUS * 0.5;
      if (withinX && withinZ && prevY >= p.top - 0.01 && b.pos.y <= p.top) {
        b.pos.y = p.top;
        b.vel.y = 0;
        b.onGround = true;
        break;
      }
    }
  }
}

function updatePlayer(dt) {
  // mode "swap only" : aucun déplacement, le swap est la seule locomotion
  const frozen = state.mode === 'nomove';
  const wish = new THREE.Vector3();
  if (!frozen) {
    if (IS_TOUCH && touch.joy.lengthSq() > 0.04) {
      // joystick analogique (haut d'écran = avant)
      wish.set(touch.joy.x, 0, touch.joy.y);
      if (wish.lengthSq() > 1) wish.normalize();
      wish.applyEuler(new THREE.Euler(0, player.yaw, 0));
    } else {
      // e.code = position physique → ZQSD marche en AZERTY
      const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      wish.set(strafe, 0, -fwd);
      if (wish.lengthSq() > 0) wish.normalize().applyEuler(new THREE.Euler(0, player.yaw, 0));
    }
  }

  moveBody(player, wish, !frozen && (keys.has('Space') || touch.jumpQueued), dt);
  touch.jumpQueued = false;

  if (state.time - player.lastHurt > 4 && player.hp < 100 && player.hp > 0) {
    player.hp = Math.min(100, player.hp + 5 * dt);
    updateHpBar();
  }

  player.swapGrace = Math.max(0, player.swapGrace - dt);

  camera.position.copy(eyePos());
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  player.fovPunch = Math.max(0, player.fovPunch - dt * 3.5);
  camera.fov = settings.fov + player.fovPunch * 18;
  camera.updateProjectionMatrix();
}

// --- Mise à jour drones / projectiles / effets --------------------------------------
function updateEnemies(dt) {
  const pEye = eyePos();

  for (const e of enemies) {
    if (!e.alive) continue;
    e.bobPhase += dt * 2;
    e.core.rotation.y += dt * 2.5;
    e.shell.rotation.y -= dt * 1.2;
    e.shell.rotation.x += dt * 0.8;

    if (isDuel()) {
      // drone neutre : dérive douce autour de son ancre, ne tire pas
      e.mesh.position.set(
        THREE.MathUtils.clamp(e.anchor.x + Math.sin(state.time * 0.25 + e.bobPhase) * 2.5, -(ARENA_HALF - 2), ARENA_HALF - 2),
        Math.max(1.6, e.anchor.y + Math.sin(e.bobPhase) * 0.6),
        THREE.MathUtils.clamp(e.anchor.z + Math.cos(state.time * 0.21 + e.bobPhase) * 2.5, -(ARENA_HALF - 2), ARENA_HALF - 2)
      );
      continue;
    }

    // mode vagues : orbite hostile + tir
    const toPlayer = new THREE.Vector3().subVectors(pEye, e.mesh.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    toPlayer.normalize();
    const tangent = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).multiplyScalar(e.orbitDir);
    const radialSpeed = THREE.MathUtils.clamp((dist - e.orbitRadius) * 0.4, -2.5, 2.5);
    const speed = 2 + state.wave * 0.15;

    e.mesh.position.addScaledVector(toPlayer, radialSpeed * dt);
    e.mesh.position.addScaledVector(tangent, speed * dt);
    e.mesh.position.y = Math.max(1.6, e.baseY + Math.sin(e.bobPhase) * 0.6);
    const lim = ARENA_HALF - 2;
    e.mesh.position.x = THREE.MathUtils.clamp(e.mesh.position.x, -lim, lim);
    e.mesh.position.z = THREE.MathUtils.clamp(e.mesh.position.z, -lim, lim);

    e.fireTimer -= dt;
    if (e.fireTimer <= 0) {
      // pas de tir sans ligne de vue — le drone réessaie bientôt
      if (hasLOS(e.mesh.position, pEye)) {
        e.fireTimer = enemyFireInterval() * (0.7 + Math.random() * 0.6);
        fireProjectile(e.mesh.position.clone());
      } else {
        e.fireTimer = 0.4;
      }
    }
  }

  if (isDuel()) {
    // respawn des drones neutres
    for (let i = droneRespawns.length - 1; i >= 0; i--) {
      droneRespawns[i] -= dt;
      if (droneRespawns[i] <= 0) {
        droneRespawns.splice(i, 1);
        const p = randomDronePos(8);
        spawnEnemy(p.x, p.y, p.z);
        addRing(new THREE.Vector3(p.x, p.y, p.z), 0x4df3ff);
      }
    }
    return;
  }

  // mode vagues : décompte + vague suivante
  const alive = enemies.filter((e) => e.alive);
  hudEnemies.textContent = alive.length > 0 ? `${alive.length} drone${alive.length > 1 ? 's' : ''}` : 'secteur nettoyé';

  if (alive.length === 0 && state.phase === 'playing') {
    state.waveCooldown += dt;
    if (state.waveCooldown > 2) {
      state.waveCooldown = 0;
      state.wave += 1;
      enemies.length = 0;
      spawnWave(state.wave);
    }
  }
}

function updateProjectiles(dt) {
  const pEye = eyePos();
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.mesh.position.addScaledVector(p.vel, dt);
    p.life -= dt;

    const feet = new THREE.Vector3(player.pos.x, player.pos.y + 0.5, player.pos.z);
    const hit = p.mesh.position.distanceTo(pEye) < 0.8 || p.mesh.position.distanceTo(feet) < 0.8;
    const out = Math.abs(p.mesh.position.x) > ARENA_HALF || Math.abs(p.mesh.position.z) > ARENA_HALF || p.mesh.position.y < 0;
    // les plateformes arrêtent les projectiles
    let inWall = false;
    for (const pl of platforms) {
      if (p.mesh.position.x > pl.minX && p.mesh.position.x < pl.maxX &&
          p.mesh.position.z > pl.minZ && p.mesh.position.z < pl.maxZ &&
          p.mesh.position.y < pl.top) { inWall = true; break; }
    }

    if (hit) hurtPlayer(12 + state.wave * 1.5, p.mesh.position);
    if (inWall) addBurst(p.mesh.position, 0xffd54d, 6);
    if (hit || out || inWall || p.life <= 0) {
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }
}

function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const fx = effects[i];
    fx.life -= dt;
    const t = Math.max(0, fx.life / fx.maxLife);
    if (fx.mesh.material) fx.mesh.material.opacity = t;
    if (fx.grow) {
      const s = 1 + (1 - t) * fx.grow;
      fx.mesh.scale.set(s, s, s);
    }
    if (fx.vels) {
      const attr = fx.mesh.geometry.getAttribute('position');
      for (let j = 0; j < fx.vels.length; j++) {
        attr.setXYZ(j, attr.getX(j) + fx.vels[j].x * dt, attr.getY(j) + fx.vels[j].y * dt, attr.getZ(j) + fx.vels[j].z * dt);
      }
      attr.needsUpdate = true;
    }
    if (fx.life <= 0) {
      scene.remove(fx.mesh);
      effects.splice(i, 1);
    }
  }
}

function updateCombo(dt) {
  if (state.comboTimer > 0) {
    state.comboTimer -= dt;
    if (state.comboTimer <= 0) {
      state.combo = 0;
      hudCombo.classList.remove('show');
    }
  }
}

// --- Boucle principale --------------------------------------------------------------
const clock = new THREE.Clock();
function step(dt) {
  if (state.phase === 'playing') {
    state.time += dt;
    updatePlayer(dt);
    updateEnemies(dt);
    if (isDuel()) {
      for (const b of bots) updateBot(b, dt);
      updateEcho(dt);
    } else {
      updateProjectiles(dt);
    }
    updateCombo(dt);
  }
  updateEffects(dt);
  updateDmgIndicators(dt);
  renderer.render(scene, camera);
}
function tick() {
  requestAnimationFrame(tick);
  step(Math.min(clock.getDelta(), 0.05));
}

// hook de debug (tests automatisés / console)
window.__game = {
  state, player, bots, botPool, enemies, projectiles, platforms, settings, dmgIndicators,
  applySettings, step, shoot, resetGame, raycastWorld, hasLOS, damageBot, hurtPlayer,
  useEcho, getEcho: () => echo, damageEcho, DIFFICULTIES, DIFF, touch, IS_TOUCH, VERSION,
};

// caméra de menu
camera.position.set(0, EYE_HEIGHT, 26);
camera.rotation.set(0, 0, 0, 'YXZ');
resetGame('waves');
state.phase = 'menu';
tick();
