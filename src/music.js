// ---------------------------------------------------------------------------
// Musique synthwave PROCÉDURALE (WebAudio pur, zéro fichier audio).
// Quatre couches sous un master dédié : basse sciée pompée, nappes détunées,
// arpège 16es avec écho, batterie (kick/snare/charleys). Deux modes crossfadés :
// « menu » (nappes + arpège doux) et « combat » (tout, batterie en tête).
// Boucle : Am – F – C – G à 104 BPM, la valeur sûre du genre.
// ---------------------------------------------------------------------------

const BPM = 104;
const STEP = 60 / BPM / 4;          // double-croche
const BAR = STEP * 16;

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
// accords (MIDI) et toniques de basse : Am, F, C, G
const CHORDS = [
  [57, 60, 64],   // A3 C4 E4
  [53, 57, 60],   // F3 A3 C4
  [48, 52, 55],   // C3 E3 G3  (descente = respiration)
  [55, 59, 62],   // G3 B3 D4
];
const ROOTS = [33, 29, 36, 31];     // A1 F1 C2 G1
const ARP_PATTERN = [0, 3, 1, 4, 2, 5, 4, 3];   // indices dans l'accord sur 2 octaves

// gains cibles par couche selon le mode
const MODES = {
  menu: { pad: 0.8, arp: 0.45, bass: 0.25, drums: 0 },
  combat: { pad: 0.6, arp: 0.85, bass: 1, drums: 1 },
};

export function createMusic() {
  let ctx = null;
  let started = false;
  let mode = 'menu';
  let volume = 0.6;
  let master, pump, layers, noiseBuf, delaySend;
  let step = 0;
  let nextTime = 0;
  let timer = null;

  function init(audioCtx) {
    if (ctx) return;
    ctx = audioCtx;
    master = ctx.createGain();
    master.gain.value = volume * 0.5;
    master.connect(ctx.destination);
    // la pompe « sidechain » : tout le mélodique respire sous le kick
    pump = ctx.createGain();
    pump.connect(master);
    layers = {};
    for (const name of ['pad', 'arp', 'bass', 'drums']) {
      layers[name] = ctx.createGain();
      layers[name].gain.value = MODES[mode][name];
      layers[name].connect(name === 'drums' ? master : pump);
    }
    // écho pointé pour l'arpège (3 double-croches, feedback doux)
    delaySend = ctx.createGain();
    delaySend.gain.value = 0.35;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    delaySend.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(layers.arp);
    // bruit blanc partagé (snare, charleys)
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  const osc2 = (type, freq, detune = 0) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    return o;
  };
  const env = (dest, t, peak, a, dur) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(dest);
    return g;
  };
  const noise = (dest, t, peak, dur, filterType, filterFreq) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = filterFreq;
    const g = env(dest, t, peak, 0.003, dur);
    src.connect(f);
    f.connect(g);
    src.start(t);
    src.stop(t + dur + 0.05);
  };

  function scheduleStep(s, t) {
    const bar = Math.floor(s / 16) % 4;
    const inBar = s % 16;
    const chord = CHORDS[bar];

    // --- nappes : un accord détuné par mesure, attaque lente
    if (inBar === 0) {
      for (const m of chord) {
        for (const det of [-9, 9]) {
          const o = osc2('sawtooth', midi(m), det);
          const f = ctx.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.setValueAtTime(700, t);
          f.frequency.linearRampToValueAtTime(1400, t + BAR * 0.6);
          const g = env(layers.pad, t, 0.05, BAR * 0.35, BAR * 1.05);
          o.connect(f);
          f.connect(g);
          o.start(t);
          o.stop(t + BAR * 1.1);
        }
      }
    }

    // --- basse : croches, octave sur le dernier temps, scie filtrée
    if (inBar % 2 === 0) {
      const root = ROOTS[bar] + (inBar === 12 ? 12 : 0);
      const o = osc2('sawtooth', midi(root));
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 420;
      const g = env(layers.bass, t, 0.24, 0.01, STEP * 1.9);
      o.connect(f);
      f.connect(g);
      o.start(t);
      o.stop(t + STEP * 2);
    }

    // --- arpège : double-croches sur 2 octaves, pluck bref + écho
    {
      const idx = ARP_PATTERN[s % ARP_PATTERN.length];
      const m = chord[idx % 3] + (idx >= 3 ? 12 : 0) + 12;
      const o = osc2('square', midi(m));
      const g = env(layers.arp, t, 0.05, 0.004, STEP * 1.4);
      o.connect(g);
      g.connect(delaySend);   // copie vers l'écho
      o.start(t);
      o.stop(t + STEP * 1.5);
    }

    // --- batterie + pompe (uniquement audible en combat via layers.drums)
    if (inBar % 4 === 0) {
      // kick : sinus qui plonge
      const o = osc2('sine', 130);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.1);
      const g = env(layers.drums, t, 0.55, 0.002, 0.16);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.18);
      // la pompe : le mélodique s'écrase puis regonfle entre deux kicks
      pump.gain.cancelScheduledValues(t);
      pump.gain.setValueAtTime(1, t);
      pump.gain.linearRampToValueAtTime(0.55, t + 0.03);
      pump.gain.linearRampToValueAtTime(1, t + STEP * 3.6);
    }
    if (inBar === 4 || inBar === 12) noise(layers.drums, t, 0.3, 0.16, 'bandpass', 1900);   // snare
    if (inBar % 2 === 0) noise(layers.drums, t, inBar % 4 === 2 ? 0.1 : 0.055, 0.035, 'highpass', 8000);   // charleys
  }

  function tick() {
    // planification en avance de phase : insensible aux à-coups du thread
    while (nextTime < ctx.currentTime + 0.6) {
      scheduleStep(step, Math.max(nextTime, ctx.currentTime + 0.02));
      nextTime += STEP;
      step++;
    }
  }

  return {
    init,
    start() {
      if (!ctx || started) return;
      started = true;
      step = 0;
      nextTime = ctx.currentTime + 0.1;
      timer = setInterval(tick, 150);
      tick();
    },
    setMode(m) {
      if (!ctx || m === mode || !MODES[m]) return;
      mode = m;
      const t = ctx.currentTime;
      for (const name of Object.keys(layers)) {
        layers[name].gain.cancelScheduledValues(t);
        layers[name].gain.setValueAtTime(layers[name].gain.value, t);
        layers[name].gain.linearRampToValueAtTime(MODES[m][name], t + 0.9);
      }
    },
    setVolume(v) {
      volume = v;
      if (ctx) master.gain.setTargetAtTime(v * 0.5, ctx.currentTime, 0.05);
    },
    get mode() { return mode; },
    stop() { if (timer) clearInterval(timer); started = false; },
  };
}
