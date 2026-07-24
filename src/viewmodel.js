import * as THREE from 'three';
import { PAL } from './fx.js';

// ---------------------------------------------------------------------------
// Viewmodel : le « personnage » en 1re personne — un blaster néon low-poly
// accroché à la caméra. Bob de marche, recul au tir, roulé complet au swap,
// inclinaison pendant le dash, flash de bouche. Aucune physique : pur habillage.
// ---------------------------------------------------------------------------

const BASE_POS = new THREE.Vector3(0.3, -0.24, -0.55);
const BASE_ROT = new THREE.Euler(0.03, -0.07, 0);
const GUN_SCALE = 0.5;   // le modèle est construit « grandeur nature » puis réduit

export function createViewmodel(camera, scene) {
  scene.add(camera);   // sans ça, les enfants de la caméra ne sont jamais rendus

  const gun = new THREE.Group();

  // plus clair que les plateformes pour ne pas se fondre dedans, et rendu
  // PAR-DESSUS le décor (depthTest off) comme tout viewmodel FPS
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x232a55, roughness: 0.4, metalness: 0.5, emissive: 0x2a2470, emissiveIntensity: 0.55, depthTest: false });
  const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x151a3a, roughness: 0.5, metalness: 0.5, emissive: 0x141048, emissiveIntensity: 0.5, depthTest: false });
  const cyanMat = new THREE.MeshBasicMaterial({ color: PAL.player, depthTest: false });
  const echoMat = new THREE.MeshBasicMaterial({ color: PAL.echo, depthTest: false });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.4), darkMat);
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.3), ridgeMat);
  ridge.position.set(0, 0.08, -0.02);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.34), ridgeMat);
  barrel.position.set(0, 0.02, -0.36);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.03), cyanMat);
  tip.position.set(0, 0.02, -0.53);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.11), darkMat);
  grip.position.set(0, -0.16, 0.12);
  grip.rotation.x = 0.35;
  // liserés néon latéraux + cellule d'énergie jaune (rappel de l'Écho)
  const stripeL = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.028, 0.34), cyanMat);
  stripeL.position.set(-0.072, 0.02, -0.06);
  const stripeR = stripeL.clone();
  stripeR.position.x = 0.072;
  const cell = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.08), echoMat);
  cell.position.set(0, 0.1, 0.1);

  // flash de bouche : deux plans croisés additifs, visibles ~2 images
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xbdfaff, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
  });
  const flashGeo = new THREE.PlaneGeometry(0.17, 0.17);
  const flashA = new THREE.Mesh(flashGeo, flashMat);
  const flashB = new THREE.Mesh(flashGeo, flashMat);
  flashB.rotation.z = Math.PI / 4;
  const flash = new THREE.Group();
  flash.add(flashA, flashB);
  flash.visible = false;

  flash.position.set(0, 0.02, -0.57);
  gun.add(body, ridge, barrel, tip, grip, stripeL, stripeR, cell, flash);
  gun.scale.setScalar(GUN_SCALE);
  gun.position.copy(BASE_POS);
  gun.traverse((o) => { o.renderOrder = 999; });
  camera.add(gun);

  let bobPhase = 0;
  let bobAmp = 0;
  let recoil = 0;
  let spinT = 0;      // 1 → 0 : roulé complet au swap/écho
  let flashT = 0;
  let dashLean = 0;

  return {
    onShoot() {
      recoil = 1;
      flashT = 0.045;
      flash.rotation.z = Math.random() * Math.PI;
      const s = 0.8 + Math.random() * 0.5;
      flash.scale.set(s, s, 1);
    },
    onSwap() { spinT = 1; },
    // masqué pendant l'édition de layout tactile / si jamais on veut une option
    setVisible(v) { gun.visible = v; },
    update(dt, { speed = 0, onGround = true, dashing = false } = {}) {
      // bob : l'amplitude suit la vitesse au sol, s'éteint en l'air
      const moving = onGround && speed > 0.5;
      bobAmp += ((moving ? Math.min(1, speed / 9) : 0) - bobAmp) * Math.min(1, dt * 8);
      if (moving) bobPhase += dt * (5 + speed * 0.55);
      const bobY = Math.sin(bobPhase * 2) * 0.011 * bobAmp;
      const bobX = Math.cos(bobPhase) * 0.008 * bobAmp;

      recoil = Math.max(0, recoil - dt * 7);
      spinT = Math.max(0, spinT - dt / 0.38);
      flashT = Math.max(0, flashT - dt);
      dashLean += ((dashing ? 1 : 0) - dashLean) * Math.min(1, dt * 10);

      const spin = (1 - spinT * spinT) * Math.PI * 2;   // 0 → 2π, freiné en fin de course
      gun.position.set(
        BASE_POS.x + bobX,
        BASE_POS.y + bobY - recoil * 0.02,
        BASE_POS.z + recoil * 0.1
      );
      gun.rotation.set(
        BASE_ROT.x + recoil * 0.38 + spin,
        BASE_ROT.y,
        BASE_ROT.z - dashLean * 0.16 + bobX * 0.6
      );
      flash.visible = flashT > 0;
    },
  };
}
