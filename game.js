// Ordinary Game Jam #1 — Lobby
//
// A 3D hub that reads jam1.json and spawns a portal per submission.
// On load the player picks a traveler (the jam's "choices" mechanic);
// mouse-look is third-person orbit via pointer lock.

import * as THREE from 'three';

const incoming = Portal.readPortalParams();

// Resolve a display name. Priority:
//   1. localStorage (set last time we committed a real name)
//   2. portal-passed username, if it isn't a generated guest-XXXX stub
//   3. the incoming guest-XXXX stub (we'll prompt before letting them
//      commit a traveler, so this is only temporary)
const NAME_KEY = 'gamejam1-lobby:username:v1';
const usernameEl = document.getElementById('username');
let username = incoming.username;
let hasRealName = false;
try {
  const saved = localStorage.getItem(NAME_KEY);
  if (saved) {
    username = saved;
    hasRealName = true;
  } else if (incoming.username && !incoming.username.startsWith('guest-')) {
    username = incoming.username;
    hasRealName = true;
    localStorage.setItem(NAME_KEY, username);
  }
} catch {}
if (usernameEl) usernameEl.textContent = username;

// ------------------------------------------------------------------
// Background music — controls + persistence
// ------------------------------------------------------------------

const AUDIO_VOL_KEY  = 'gamejam1-lobby:bgm:volume';
const AUDIO_MUTE_KEY = 'gamejam1-lobby:bgm:muted';

const bgmEl          = document.getElementById('bgm');
const audioToggleEl  = document.getElementById('audio-toggle');
const audioVolumeEl  = document.getElementById('audio-volume');

let bgmStarted = false;

function loadAudioPrefs() {
  let volume = 0.32;
  let muted = false;
  try {
    const savedVol = localStorage.getItem(AUDIO_VOL_KEY);
    if (savedVol !== null) {
      const n = Number(savedVol);
      if (Number.isFinite(n)) volume = Math.max(0, Math.min(1, n));
    }
    muted = localStorage.getItem(AUDIO_MUTE_KEY) === '1';
  } catch {}
  return { volume, muted };
}

function applyAudioPrefs({ volume, muted }) {
  if (bgmEl) {
    bgmEl.volume = volume;
    bgmEl.muted = muted;
  }
  if (audioVolumeEl) audioVolumeEl.value = String(Math.round(volume * 100));
  if (audioToggleEl) {
    audioToggleEl.textContent = muted ? 'unmute' : 'mute';
    audioToggleEl.setAttribute('aria-pressed', muted ? 'true' : 'false');
  }
}

applyAudioPrefs(loadAudioPrefs());

function startBgm() {
  if (bgmStarted || !bgmEl) return;
  const p = bgmEl.play();
  if (p && typeof p.catch === 'function') {
    p.then(() => { bgmStarted = true; })
     .catch(() => { /* autoplay blocked; resolved on next user gesture */ });
  } else {
    bgmStarted = true;
  }
}

if (audioToggleEl && bgmEl) {
  audioToggleEl.addEventListener('click', () => {
    const muted = !bgmEl.muted;
    bgmEl.muted = muted;
    audioToggleEl.textContent = muted ? 'unmute' : 'mute';
    audioToggleEl.setAttribute('aria-pressed', muted ? 'true' : 'false');
    try { localStorage.setItem(AUDIO_MUTE_KEY, muted ? '1' : '0'); } catch {}
    // The click itself is a valid gesture for autoplay, so kick the
    // track off now if it hasn't started yet.
    startBgm();
    ensureSfx();
    setSfxMuted(muted);
  });
}

if (audioVolumeEl && bgmEl) {
  audioVolumeEl.addEventListener('input', () => {
    const v = Math.max(0, Math.min(1, Number(audioVolumeEl.value) / 100));
    bgmEl.volume = v;
    try { localStorage.setItem(AUDIO_VOL_KEY, String(v)); } catch {}
  });
}

// ------------------------------------------------------------------
// Perf overlay — enabled with ?perf=1. Tracks a 1s rolling window of
// frame times and flags any frame over SPIKE_MS to the console with
// a timestamp so we can correlate hitches with gameplay events.
// ------------------------------------------------------------------

const perfEnabled = (() => {
  try { return new URLSearchParams(location.search).get('perf') === '1'; }
  catch { return false; }
})();
const perfEl       = document.getElementById('perf');
const perfFpsEl    = document.getElementById('perf-fps');
const perfWorstEl  = document.getElementById('perf-worst');
const perfSpikesEl = document.getElementById('perf-spikes');
const perfSamples = []; // { t: ms-since-epoch, dt: ms }
const PERF_WINDOW_MS = 1000;
const PERF_SPIKE_MS  = 40;
let perfSpikeCount = 0;
let perfLastDomUpdate = 0;
let perfSpikeFlashUntil = 0;

if (perfEnabled && perfEl) perfEl.hidden = false;

function perfRecord(now, dtMs) {
  if (!perfEnabled) return;
  perfSamples.push({ t: now, dt: dtMs });
  // Drop anything outside the 1s window.
  while (perfSamples.length && now - perfSamples[0].t > PERF_WINDOW_MS) {
    perfSamples.shift();
  }
  if (dtMs > PERF_SPIKE_MS) {
    perfSpikeCount += 1;
    perfSpikeFlashUntil = now + 800;
    // Snapshot of gameplay context at the spike — makes it obvious
    // whether it correlates with peers joining, portals spawning, etc.
    console.warn(
      `[perf] frame spike ${dtMs.toFixed(1)}ms @ t=${(now / 1000).toFixed(2)}s ` +
      `peers=${peers.size} particles=${particles.filter((p) => p.userData.alive).length}`,
    );
  }
  if (now - perfLastDomUpdate > 200 && perfSamples.length) {
    perfLastDomUpdate = now;
    let sum = 0, max = 0;
    for (const s of perfSamples) { sum += s.dt; if (s.dt > max) max = s.dt; }
    const avg = sum / perfSamples.length;
    if (perfFpsEl)    perfFpsEl.textContent    = (1000 / avg).toFixed(0);
    if (perfWorstEl)  perfWorstEl.textContent  = `${max.toFixed(0)}ms`;
    if (perfSpikesEl) perfSpikesEl.textContent = String(perfSpikeCount);
    if (perfEl) perfEl.classList.toggle('spike', now < perfSpikeFlashUntil);
  }
}

// ------------------------------------------------------------------
// Lobby SFX — procedural Web Audio. Snow-crunch footsteps for the
// local player and nearby peers, plus a soft portal hum whose gain
// ramps with proximity. Lazy-initialized on the first user gesture
// (browser autoplay policy) and muted alongside the BGM toggle.
// ------------------------------------------------------------------

let sfxCtx = null;
let sfxMaster = null;
let sfxCrunchBus = null;
let sfxHumBus = null;
let noiseBuffer = null;
const portalHums = []; // { obj3d, gainNode, maxGain }

// Rain ambience — pink noise through a bandpass, looped. A single
// gain node is crossfaded by weatherMix so it only becomes audible
// when the scene transitions into rain.
let rainSource = null;
let rainGain = null;

function ensureSfx() {
  if (sfxCtx) {
    if (sfxCtx.state === 'suspended') sfxCtx.resume().catch(() => {});
    return sfxCtx;
  }
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try { sfxCtx = new Ctor(); } catch { return null; }

  sfxMaster = sfxCtx.createGain();
  sfxMaster.gain.value = (bgmEl && bgmEl.muted) ? 0 : 1;
  sfxMaster.connect(sfxCtx.destination);

  sfxCrunchBus = sfxCtx.createGain();
  sfxCrunchBus.gain.value = 0.7;
  sfxCrunchBus.connect(sfxMaster);

  sfxHumBus = sfxCtx.createGain();
  sfxHumBus.gain.value = 0.35;
  sfxHumBus.connect(sfxMaster);

  // Brown noise (integrated white noise, low-passed by construction)
  // is much softer than white — the high-frequency hiss that made the
  // old crunch sound metallic/ringing is mostly absent. DC drift is
  // suppressed with a leaky integrator.
  const len = Math.floor(sfxCtx.sampleRate * 0.25);
  noiseBuffer = sfxCtx.createBuffer(1, len, sfxCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  let acc = 0;
  for (let i = 0; i < len; i++) {
    acc = acc * 0.985 + (Math.random() * 2 - 1) * 0.22;
    data[i] = acc;
  }

  buildPortalHums();
  buildRainAudio();
  return sfxCtx;
}

// Pink noise (Paul Kellet approximation) through a wide bandpass gives
// a passable rain hush. The source is one long buffer on loop so the
// seam is continuous by construction — no need for crossfade tricks.
function buildRainAudio() {
  if (!sfxCtx || rainSource) return;
  const len = Math.floor(sfxCtx.sampleRate * 6);
  const buf = sfxCtx.createBuffer(1, len, sfxCtx.sampleRate);
  const out = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  rainSource = sfxCtx.createBufferSource();
  rainSource.buffer = buf;
  rainSource.loop = true;

  const filter = sfxCtx.createBiquadFilter();
  // Lowpass instead of bandpass — drops the bright hiss entirely so
  // what's left reads as muffled, low rain rather than a shower head.
  filter.type = 'lowpass';
  filter.frequency.value = 520;
  filter.Q.value = 0.5;

  rainGain = sfxCtx.createGain();
  rainGain.gain.value = 0;

  rainSource.connect(filter);
  filter.connect(rainGain);
  rainGain.connect(sfxMaster);
  rainSource.start();
}

function setRainLevel(mix) {
  if (!rainGain || !sfxCtx) return;
  // Quadratic so the hiss only really comes up when we're firmly in
  // the rain state, and fades away early on the way back to snow.
  const target = Math.max(0, Math.min(1, mix)) ** 1.6 * 0.05;
  rainGain.gain.setTargetAtTime(target, sfxCtx.currentTime, 0.6);
}

function setSfxMuted(muted) {
  if (!sfxMaster || !sfxCtx) return;
  sfxMaster.gain.setTargetAtTime(muted ? 0 : 1, sfxCtx.currentTime, 0.02);
}

// Soft compacted-snow thud: brown noise through a low-pass that sweeps
// downward, wrapped in a slow attack and lingering tail. No high-Q
// bandpass and no bright frequencies, so it reads as "padded footfall"
// rather than "tapping metal."
function playCrunch(volume = 1.0, pan = 0) {
  if (!sfxCtx || !noiseBuffer) return;
  const t = sfxCtx.currentTime;
  const src = sfxCtx.createBufferSource();
  src.buffer = noiseBuffer;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;

  const filter = sfxCtx.createBiquadFilter();
  filter.type = 'lowpass';
  const fBase = 430 + Math.random() * 110;
  filter.frequency.setValueAtTime(fBase, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(160, fBase * 0.45), t + 0.22);
  filter.Q.value = 0.35;

  const gain = sfxCtx.createGain();
  const peak = Math.max(0, Math.min(1, volume)) * 0.06;
  gain.gain.setValueAtTime(0, t);
  // Slower attack (~55ms) rounds the transient off entirely. Longer
  // exponential tail reads as a soft sink into snow.
  gain.gain.linearRampToValueAtTime(peak, t + 0.055);
  gain.gain.exponentialRampToValueAtTime(0.0004, t + 0.32);

  src.connect(filter);
  filter.connect(gain);
  if (sfxCtx.createStereoPanner) {
    const panner = sfxCtx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    gain.connect(panner);
    panner.connect(sfxCrunchBus);
  } else {
    gain.connect(sfxCrunchBus);
  }
  src.start(t);
  src.stop(t + 0.4);
}

// Remote crunch: attenuate + pan based on listener (player + camera).
function playCrunchAt(x, z) {
  if (!sfxCtx) return;
  const dx = x - player.position.x;
  const dz = z - player.position.z;
  const d = Math.hypot(dx, dz);
  if (d > 18) return;
  const falloff = 1 - Math.min(1, d / 18);
  // Camera-right vector in world XZ; matches the movement basis.
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const pan = d < 0.01 ? 0 : (dx * rx + dz * rz) / d;
  playCrunch(0.8 * falloff * falloff, pan);
}

// Continuous drone per portal: a pure sine fundamental plus a quiet
// sine an octave up for a hint of shimmer, summed through a gentle
// (non-resonant) low-pass. The only movement is a very slow amplitude
// LFO — no detune beating and no cutoff sweeping, which is what made
// the previous version feel "vibraty." The result is a soft pad rather
// than a modulated synth tone.
function buildPortalHums() {
  if (!sfxCtx || portalHums.length) return;
  const make = (obj3d, freq) => {
    const fund = sfxCtx.createOscillator();
    fund.type = 'sine';
    fund.frequency.value = freq;

    const high = sfxCtx.createOscillator();
    high.type = 'sine';
    high.frequency.value = freq * 2;
    const highGain = sfxCtx.createGain();
    highGain.gain.value = 0.18;

    const filter = sfxCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.5;

    // Subtle amplitude breath — ~0.12Hz, depth ±0.06 around unity.
    const breathOsc = sfxCtx.createOscillator();
    breathOsc.type = 'sine';
    breathOsc.frequency.value = 0.12;
    const breathDepth = sfxCtx.createGain();
    breathDepth.gain.value = 0.06;
    const breathGain = sfxCtx.createGain();
    breathGain.gain.value = 1;
    breathOsc.connect(breathDepth);
    breathDepth.connect(breathGain.gain);

    const gain = sfxCtx.createGain();
    gain.gain.value = 0;

    fund.connect(filter);
    high.connect(highGain);
    highGain.connect(filter);
    filter.connect(breathGain);
    breathGain.connect(gain);
    gain.connect(sfxHumBus);

    fund.start();
    high.start();
    breathOsc.start();
    portalHums.push({ obj3d, gainNode: gain, maxGain: 0.22 });
  };
  portals.forEach((p, i) => make(p, 118 + (i % 3) * 7));
  if (returnPortal) make(returnPortal.group, 104);
}

function updatePortalHums() {
  if (!sfxCtx || !portalHums.length) return;
  const now = sfxCtx.currentTime;
  const px = player.position.x, pz = player.position.z;
  // Pulled in tight — the hum should be essentially inaudible unless
  // the player is right up against a portal.
  const NEAR = 0.8, FAR = 3.2;
  for (const h of portalHums) {
    const o = h.obj3d;
    if (!o) continue;
    const dx = o.position.x - px;
    const dz = o.position.z - pz;
    const d = Math.hypot(dx, dz);
    const k = 1 - Math.max(0, Math.min(1, (d - NEAR) / (FAR - NEAR)));
    h.gainNode.gain.setTargetAtTime(h.maxGain * k * k, now, 0.1);
  }
}

// ------------------------------------------------------------------
// Scene, renderer, camera
// ------------------------------------------------------------------

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a18);
// Snowy haze — exponential falloff so distant objects dim smoothly
// rather than stopping at a hard edge. Moon and stars opt out of fog.
// Heavy density + lightened fog color reads as thick snow in the air.
scene.fog = new THREE.FogExp2(0x1a2340, 0.065);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (snowMat) snowMat.uniforms.uPixelScale.value = innerHeight * renderer.getPixelRatio() * 0.5;
});

// ------------------------------------------------------------------
// Lighting
// ------------------------------------------------------------------

// Moonlit night — cool sky fill, dim top-down moonlight.
scene.add(new THREE.HemisphereLight(0x6a88b8, 0x0a1020, 0.28));
const moonLight = new THREE.DirectionalLight(0xcdd6ef, 0.35);
moonLight.position.set(-18, 26, -14);
scene.add(moonLight);

// ------------------------------------------------------------------
// Ground + rings + center lantern
// ------------------------------------------------------------------

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(32, 72),
  new THREE.MeshStandardMaterial({ color: 0xdbe2ef, roughness: 0.92 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const innerRing = new THREE.Mesh(
  new THREE.RingGeometry(3.5, 3.9, 72),
  new THREE.MeshStandardMaterial({
    color: 0xf0d38a,
    emissive: 0xe8b64c,
    emissiveIntensity: 0.3,
    side: THREE.DoubleSide,
  }),
);
innerRing.rotation.x = -Math.PI / 2;
innerRing.position.y = 0.01;
scene.add(innerRing);

const outerRing = new THREE.Mesh(
  new THREE.RingGeometry(13.6, 14.4, 96),
  new THREE.MeshStandardMaterial({
    color: 0xb7c2cf,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.6,
  }),
);
outerRing.rotation.x = -Math.PI / 2;
outerRing.position.y = 0.02;
scene.add(outerRing);

// Central lantern — gives the hub a visual anchor without theming.
const lanternColumn = new THREE.Mesh(
  new THREE.CylinderGeometry(0.18, 0.24, 1.2, 20),
  new THREE.MeshStandardMaterial({ color: 0x5a6578, roughness: 0.55, metalness: 0.25 }),
);
lanternColumn.position.y = 0.6;
scene.add(lanternColumn);

const lantern = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.3, 2),
  new THREE.MeshStandardMaterial({
    color: 0xffd494,
    emissive: 0xffd494,
    emissiveIntensity: 0.95,
    roughness: 0.3,
  }),
);
lantern.position.y = 1.55;
scene.add(lantern);

const lanternLight = new THREE.PointLight(0xffd494, 1.2, 10, 2);
lanternLight.position.y = 1.55;
scene.add(lanternLight);

// ------------------------------------------------------------------
// Night sky — radial glow texture, full moon + halo, star field
// ------------------------------------------------------------------

function makeRadialGlowTexture() {
  const size = 128;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cvs);
  tex.needsUpdate = true;
  return tex;
}
const glowTex = makeRadialGlowTexture();

// Full moon sits off to one side of the sky; halo fakes a soft bloom.
const moonPos = new THREE.Vector3(-28, 32, -42);
const moon = new THREE.Mesh(
  new THREE.CircleGeometry(2.6, 48),
  new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false }),
);
moon.position.copy(moonPos);
moon.lookAt(0, 0, 0);
scene.add(moon);

const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTex,
  color: 0xffe8c8,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
  fog: false,
}));
moonHalo.scale.set(11, 11, 1);
moonHalo.position.copy(moonPos);
scene.add(moonHalo);

// Stars on a sky dome. Biased toward higher altitudes so nothing
// pokes through the horizon line.
const STAR_COUNT = 420;
const starPositions = new Float32Array(STAR_COUNT * 3);
for (let i = 0; i < STAR_COUNT; i++) {
  const theta = Math.random() * Math.PI * 2;
  const alt = 0.12 + Math.random() * 0.82;        // fraction of pi/2
  const phi = alt * (Math.PI / 2);
  const r = 90 + Math.random() * 10;
  starPositions[i * 3]     = Math.cos(phi) * Math.cos(theta) * r;
  starPositions[i * 3 + 1] = Math.sin(phi) * r;
  starPositions[i * 3 + 2] = Math.cos(phi) * Math.sin(theta) * r;
}
const starGeom = new THREE.BufferGeometry();
starGeom.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
const stars = new THREE.Points(starGeom, new THREE.PointsMaterial({
  color: 0xffffff,
  size: 0.55,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
  fog: false,
}));
scene.add(stars);

// ------------------------------------------------------------------
// Street lamps — ring of dim warm posts around the hub
// ------------------------------------------------------------------

const LAMP_COUNT = 8;
const LAMP_R = 17;
const lampHeads = [];
for (let i = 0; i < LAMP_COUNT; i++) {
  const angle = (i / LAMP_COUNT) * Math.PI * 2 + Math.PI / LAMP_COUNT;
  const x = Math.cos(angle) * LAMP_R;
  const z = Math.sin(angle) * LAMP_R;

  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.1, 3.4, 12),
    new THREE.MeshStandardMaterial({ color: 0x1f2430, roughness: 0.7, metalness: 0.3 }),
  );
  post.position.set(x, 1.7, z);
  scene.add(post);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0xffd89a,
      emissive: 0xffb060,
      emissiveIntensity: 0.75,
      roughness: 0.4,
    }),
  );
  head.position.set(x, 3.4, z);
  scene.add(head);
  lampHeads.push(head);

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex,
    color: 0xffc680,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  }));
  halo.scale.set(1.4, 1.4, 1);
  halo.position.set(x, 3.4, z);
  scene.add(halo);

  // Dim, short-range — enough to pool light at each lamp without
  // washing out the moonlit darkness of the hub.
  const light = new THREE.PointLight(0xffb070, 0.55, 7, 2);
  light.position.set(x, 3.3, z);
  scene.add(light);
}

// ------------------------------------------------------------------
// Snow — GPU-driven Points cloud. Each flake's position is derived on
// the GPU from (baseX, baseY, baseZ, fallSpeed, swayPhase, driftPhase)
// plus a single uTime uniform, so the only per-frame CPU cost is a
// uniform write. No JS loop, no buffer upload. Soft circular sprites
// let fewer particles look denser than a larger hard-pixel cloud.
// ------------------------------------------------------------------

const SNOW_COUNT = 4000;
const SNOW_AREA = 72;
const SNOW_TOP = 20;
const snowPositions = new Float32Array(SNOW_COUNT * 3);
const snowData = new Float32Array(SNOW_COUNT * 3); // fallSpeed, swayPhase, driftPhase
for (let i = 0; i < SNOW_COUNT; i++) {
  snowPositions[i * 3]     = (Math.random() - 0.5) * SNOW_AREA;
  snowPositions[i * 3 + 1] = Math.random() * SNOW_TOP;
  snowPositions[i * 3 + 2] = (Math.random() - 0.5) * SNOW_AREA;
  snowData[i * 3]     = 0.55 + Math.random() * 0.55;
  snowData[i * 3 + 1] = Math.random() * Math.PI * 2;
  snowData[i * 3 + 2] = Math.random() * Math.PI * 2;
}
const snowGeom = new THREE.BufferGeometry();
snowGeom.setAttribute('position', new THREE.Float32BufferAttribute(snowPositions, 3));
snowGeom.setAttribute('aData', new THREE.Float32BufferAttribute(snowData, 3));

const snowMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uTop: { value: SNOW_TOP },
    // Viewport-based size factor so the flakes keep the same on-screen
    // size whether the window is tiny or full-res. Updated on resize.
    uPixelScale: { value: innerHeight * renderer.getPixelRatio() * 0.5 },
    uSize: { value: 0.22 },
    uTex: { value: glowTex },
    // 0 = full snow, 1 = full rain. Driven on a slow lerp from JS so
    // weather transitions smoothly crossfade instead of snapping.
    uWeather: { value: 0 },
  },
  vertexShader: /* glsl */ `
    uniform float uTime;
    uniform float uTop;
    uniform float uSize;
    uniform float uPixelScale;
    uniform float uWeather;
    attribute vec3 aData;
    varying float vAlpha;
    void main() {
      float fall = aData.x;
      float swayP = aData.y;
      float driftP = aData.z;
      // Rain falls much faster and (nearly) straight down. Size shrinks
      // too so the points read as streaks against the dark sky.
      float fallMul = mix(1.0, 2.8, uWeather);
      float swayAmp = mix(0.25, 0.02, uWeather);
      float driftAmp = mix(0.25, 0.02, uWeather);
      float sizeMul = mix(1.0, 0.55, uWeather);
      // Wrap vertically via mod so flakes cycle from top back to top
      // without any JS-side respawn logic.
      float y = mod(position.y - fall * fallMul * uTime, uTop);
      float x = position.x + sin(uTime * 0.8 + swayP) * swayAmp;
      float z = position.z + cos(uTime * 0.55 + driftP) * driftAmp;
      vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = uSize * sizeMul * uPixelScale / max(0.1, -mv.z);
      // Fade flakes in near the top (fresh respawn) and out near the
      // ground, so the modulo wrap isn't visible as a pop.
      float topFade = 1.0 - smoothstep(uTop - 2.5, uTop, y);
      float botFade = smoothstep(0.0, 1.2, y);
      vAlpha = topFade * botFade;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D uTex;
    uniform float uWeather;
    varying float vAlpha;
    void main() {
      vec4 tex = texture2D(uTex, gl_PointCoord);
      vec3 col = mix(vec3(1.0), vec3(0.78, 0.86, 0.98), uWeather);
      float baseAlpha = mix(0.85, 0.7, uWeather);
      gl_FragColor = vec4(col, tex.a * vAlpha * baseAlpha);
    }
  `,
  transparent: true,
  depthWrite: false,
});

const snow = new THREE.Points(snowGeom, snowMat);
// Points frustum culling compares the geometry's bounding sphere to
// the camera; since our shader sends each flake cycling through the
// whole volume we need the sphere to cover the full SNOW_AREA/SNOW_TOP
// box, otherwise flakes blink out when the camera looks past origin.
snowGeom.boundingSphere = new THREE.Sphere(
  new THREE.Vector3(0, SNOW_TOP * 0.5, 0),
  Math.sqrt(SNOW_AREA * SNOW_AREA * 0.5 + SNOW_TOP * SNOW_TOP * 0.25),
);
scene.add(snow);

// ------------------------------------------------------------------
// Weather state — most of the time it's snow; every so often the
// lobby shifts into rain for a stretch before going back. weatherMix
// is slewed toward weatherTarget on a slow lerp so transitions are
// gentle (a few seconds to fully cross over).
// ------------------------------------------------------------------

let weatherMix = 0;                       // 0 = snow, 1 = rain
let weatherTarget = 0;
let weatherSwitchAt = 45 + Math.random() * 30; // first switch at 45–75s
const WEATHER_FADE_RATE = 0.35;

function tickWeather(tNow, dt) {
  if (tNow >= weatherSwitchAt) {
    if (weatherTarget === 0) {
      weatherTarget = 1;
      weatherSwitchAt = tNow + 45 + Math.random() * 45;   // rain 45–90s
    } else {
      weatherTarget = 0;
      weatherSwitchAt = tNow + 90 + Math.random() * 120;  // snow 90–210s
    }
  }
  const k = Math.min(1, dt * WEATHER_FADE_RATE);
  weatherMix += (weatherTarget - weatherMix) * k;
  snowMat.uniforms.uWeather.value = weatherMix;
  setRainLevel(weatherMix);
}

// ------------------------------------------------------------------
// Text label helper
// ------------------------------------------------------------------

function textSprite(text, opts = {}) {
  const {
    color = '#2a2f3a',
    bg = 'rgba(255,253,247,0.95)',
    fontSize = 44,
    fontWeight = 700,
    italic = false,
    pad = 26,
    radius = 18,
  } = opts;

  const cvs = document.createElement('canvas');
  const ctx = cvs.getContext('2d');
  const fontStyle = italic ? 'italic' : 'normal';
  const font = `${fontStyle} ${fontWeight} ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = fontSize + pad * 1.3;
  cvs.width = w;
  cvs.height = h;

  ctx.font = font;
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, w, h, radius);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(w / 100, h / 100, 1);
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ------------------------------------------------------------------
// Portals
// ------------------------------------------------------------------

const portals = [];

function makePortal(game, angle) {
  const group = new THREE.Group();
  const R = 14;
  group.position.set(Math.cos(angle) * R, 0, Math.sin(angle) * R);
  group.lookAt(0, 0, 0);

  // Muted palette — shifts hue around the circle but avoids pink.
  const hue = (0.12 + (angle / (Math.PI * 2)) * 0.75) % 1;
  const color = new THREE.Color().setHSL(hue, 0.42, 0.6);

  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(1.4, 0.18, 20, 72),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.9,
      metalness: 0.2,
      roughness: 0.4,
    }),
  );
  torus.position.y = 1.9;
  group.add(torus);

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.25, 48),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
    }),
  );
  disc.position.y = 1.9;
  group.add(disc);

  // depthTest off + low renderOrder so the camera-facing sprite doesn't
  // get clipped by the vertical portal disc — otherwise the sprite plane
  // intersects the disc and leaves a hard half-bright/half-dim line.
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex,
    color,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    depthTest: false,
  }));
  halo.scale.set(4.2, 4.2, 1);
  halo.position.y = 1.9;
  halo.renderOrder = -1;
  group.add(halo);

  const light = new THREE.PointLight(color, 0.85, 8, 2);
  light.position.y = 1.9;
  group.add(light);

  const title = textSprite(game.title, {
    fontSize: 44,
    fontWeight: 700,
  });
  title.position.set(0, 3.9, 0);
  group.add(title);

  if (game.description) {
    const sub = textSprite(game.description, {
      color: '#5a6578',
      bg: 'rgba(248,249,252,0.85)',
      fontSize: 24,
      italic: true,
      fontWeight: 500,
    });
    sub.position.set(0, 3.28, 0);
    group.add(sub);
  }

  group.userData = { game, torus, disc, angle };
  portals.push(group);
  scene.add(group);
}

// ------------------------------------------------------------------
// Return portal — teal; only when arriving from another game
// ------------------------------------------------------------------

let returnPortal = null;
if (incoming.ref) {
  const group = new THREE.Group();
  group.position.set(0, 0, 11);
  group.lookAt(0, 0, 0);

  const color = new THREE.Color(0x4ff0ff);
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(1.4, 0.18, 20, 72),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.75,
      metalness: 0.15,
      roughness: 0.35,
    }),
  );
  torus.position.y = 1.9;
  group.add(torus);

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.25, 48),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    }),
  );
  disc.position.y = 1.9;
  group.add(disc);

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex,
    color,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
    depthTest: false,
  }));
  halo.scale.set(4.2, 4.2, 1);
  halo.position.y = 1.9;
  halo.renderOrder = -1;
  group.add(halo);

  const light = new THREE.PointLight(color, 1.0, 8, 2);
  light.position.y = 1.9;
  group.add(light);

  const title = textSprite('← back', {
    color: '#0b3240',
    bg: 'rgba(220,250,255,0.95)',
    fontSize: 44,
    fontWeight: 700,
  });
  title.position.set(0, 3.9, 0);
  group.add(title);

  const sub = textSprite('return to where you came from', {
    color: '#2f6070',
    bg: 'rgba(235,250,255,0.85)',
    fontSize: 24,
    italic: true,
    fontWeight: 500,
  });
  sub.position.set(0, 3.28, 0);
  group.add(sub);

  returnPortal = { group, torus, disc, target: incoming.ref };
  scene.add(group);
}

// ------------------------------------------------------------------
// Registry fetch — filter out self so the lobby doesn't link to itself
// ------------------------------------------------------------------

(async () => {
  const games = await Portal.fetchJamRegistry();
  const here = window.location.href.split('?')[0];
  const norm = (s) => s.split('?')[0].replace(/\/$/, '');
  const others = (games || []).filter((g) => norm(g.url) !== norm(here));

  if (others.length === 0) {
    makePortal(
      {
        title: 'Jam hub',
        description: 'the jam homepage',
        url: 'https://callumhyoung.github.io/gamejam/',
      },
      0,
    );
    return;
  }
  others.forEach((g, i) => {
    const angle = (i / others.length) * Math.PI * 2;
    makePortal(g, angle);
  });
})();

// ------------------------------------------------------------------
// Drifting motes
// ------------------------------------------------------------------

const motes = [];
const moteGeo = new THREE.PlaneGeometry(0.16, 0.16);
const moteMat = new THREE.MeshBasicMaterial({
  color: 0xf7f2e4,
  transparent: true,
  opacity: 0.55,
  side: THREE.DoubleSide,
});
for (let i = 0; i < 45; i++) {
  const m = new THREE.Mesh(moteGeo, moteMat);
  m.position.set(
    (Math.random() - 0.5) * 40,
    Math.random() * 8 + 1,
    (Math.random() - 0.5) * 40,
  );
  m.userData = {
    vy: -(Math.random() * 0.25 + 0.1),
    vx: (Math.random() - 0.5) * 0.12,
    spin: (Math.random() - 0.5) * 1.4,
  };
  motes.push(m);
  scene.add(m);
}

// ------------------------------------------------------------------
// Traveler particle pool — one shared pool, reassigned when a particle
// dies. Spawn rate, color, size, lifetime and launch velocity all come
// from the active traveler config, giving each pick a distinct trail.
// ------------------------------------------------------------------

const PARTICLE_COUNT = 70;
const particles = [];
for (let i = 0; i < PARTICLE_COUNT; i++) {
  const mat = new THREE.SpriteMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.1, 0.1, 1);
  sprite.visible = false;
  sprite.userData = { alive: false };
  scene.add(sprite);
  particles.push(sprite);
}

function spawnParticle() {
  if (!traveler) return;
  const p = particles.find((sp) => !sp.userData.alive);
  if (!p) return;
  const cfg = traveler.particle;

  p.userData.alive = true;
  p.userData.age = 0;
  p.userData.life = cfg.life;

  const spread = cfg.behavior === 'burst' ? 0.4 : 0.28;
  p.position.set(
    player.position.x + (Math.random() - 0.5) * spread,
    player.position.y + 0.4 + Math.random() * 0.5,
    player.position.z + (Math.random() - 0.5) * spread,
  );

  if (cfg.behavior === 'burst') {
    // Spark: outward cone with gravity, like a small firework.
    const a = Math.random() * Math.PI * 2;
    const r = 1.5 + Math.random() * 1.5;
    p.userData.vx = Math.cos(a) * r;
    p.userData.vy = 1.8 + Math.random() * 1.8;
    p.userData.vz = Math.sin(a) * r;
    p.userData.gy = -5.5;
  } else if (cfg.behavior === 'rise') {
    // Drift: gentle plumes rising with slight sway.
    p.userData.vx = (Math.random() - 0.5) * 0.4;
    p.userData.vy = 0.6 + Math.random() * 0.4;
    p.userData.vz = (Math.random() - 0.5) * 0.4;
    p.userData.gy = 0;
  } else {
    // Wander: slow upward drift, petal-like.
    p.userData.vx = (Math.random() - 0.5) * 0.25;
    p.userData.vy = 0.2 + Math.random() * 0.25;
    p.userData.vz = (Math.random() - 0.5) * 0.25;
    p.userData.gy = 0.08;
  }

  p.scale.set(cfg.size, cfg.size, 1);
  p.material.color.setHex(cfg.color);
  p.material.opacity = 0.9;
  p.visible = true;
}

let particleAccum = 0;

// ------------------------------------------------------------------
// Character — capsule body + sphere head + eyes + tiny arms.
// Built facing -Z (three.js convention), so rotation.y = 0 means the
// character looks along world -Z.
// ------------------------------------------------------------------

function buildCharacter(colorHex) {
  const group = new THREE.Group();
  const color = new THREE.Color('#' + colorHex);
  const bodyMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0,
    roughness: 0.5,
  });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xfff5dc, roughness: 0.7 });
  const eyeMat  = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.4 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.42, 6, 14), bodyMat);
  body.position.y = 0.55;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 20), skinMat);
  head.position.y = 1.2;
  group.add(head);

  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), eyeMat);
  eyeL.position.set(-0.1, 1.24, -0.25);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), eyeMat);
  eyeR.position.set(0.1, 1.24, -0.25);
  group.add(eyeR);

  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.22, 4, 8), bodyMat);
  armL.position.set(-0.34, 0.68, 0);
  armL.rotation.z = 0.22;
  group.add(armL);
  const armR = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.22, 4, 8), bodyMat);
  armR.position.set(0.34, 0.68, 0);
  armR.rotation.z = -0.22;
  group.add(armR);

  // Glow light — intensity driven by the selected traveler.
  const glowLight = new THREE.PointLight(color, 0, 5, 2);
  glowLight.position.y = 0.8;
  group.add(glowLight);

  return { group, bodyMat, body, head, armL, armR, eyeL, eyeR, glowLight };
}

const character = buildCharacter(incoming.color);
const player = character.group;
const spawnZ = incoming.fromPortal && incoming.ref ? 13 : 8;
player.position.set(0, 0, spawnZ);
scene.add(player);

function applyTravelerStyle(choice) {
  const color = new THREE.Color('#' + choice.hex);
  character.bodyMat.color.copy(color);
  character.bodyMat.emissive.copy(color);
  character.bodyMat.emissiveIntensity = choice.emissive;
  character.glowLight.color.copy(color);
  character.glowLight.intensity = choice.glow;
}

// ------------------------------------------------------------------
// Choice screen — player picks a traveler on load. If they arrived
// via a portal we skip the picker and reuse the incoming state.
// ------------------------------------------------------------------

// Each traveler maps to a distinct movement feel, glow strength, and
// particle style. Kept in one place so adding a fourth is trivial.
const CHOICES = {
  spark: {
    key: 'spark', hex: 'e8b64c', name: 'Spark', desc: 'quick on their feet',
    speed: 6.5, accel: 35, bobFreq: 12, bobAmp: 0.08, hover: 0,
    glow: 1.3, emissive: 0.55,
    jumpSpeed: 6.8, gravity: -20,
    particle: { color: 0xffd870, size: 0.1, life: 0.65, rate: 34, behavior: 'burst' },
  },
  drift: {
    key: 'drift', hex: '7fb9ae', name: 'Drift', desc: 'steady, curious',
    speed: 5, accel: 18, bobFreq: 10, bobAmp: 0.06, hover: 0,
    glow: 0.75, emissive: 0.35,
    jumpSpeed: 5.8, gravity: -17,
    particle: { color: 0x8fd6c8, size: 0.14, life: 1.8, rate: 11, behavior: 'rise' },
  },
  wander: {
    key: 'wander', hex: 'a892c6', name: 'Wander', desc: 'takes their time',
    speed: 4.2, accel: 8, bobFreq: 4, bobAmp: 0.1, hover: 0.18,
    glow: 0.55, emissive: 0.3,
    jumpSpeed: 4.8, gravity: -9,
    particle: { color: 0xc3b3e0, size: 0.2, life: 2.6, rate: 6, behavior: 'float' },
  },
};

let traveler = null;
const chooseEl = document.getElementById('choose');
const travelerEl = document.getElementById('traveler');
const nameFieldEl = document.getElementById('name-field');
const nameInputEl = document.getElementById('name-input');

// Show the name prompt on join only for players we don't already have
// a saved name for — returning visitors and portal arrivals with a
// real name skip it.
if (!hasRealName && nameFieldEl) {
  nameFieldEl.hidden = false;
  if (nameInputEl) requestAnimationFrame(() => nameInputEl.focus());
}

if (nameInputEl) {
  // Keep keystrokes contained so they don't leak into the movement
  // keymap. Enter advances focus to the first card, turning the pick
  // into a two-key flow (type name → Enter → Enter).
  nameInputEl.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const firstCard = chooseEl?.querySelector('.card');
      if (firstCard) firstCard.focus();
    }
  });
}

function commitName() {
  if (hasRealName || !nameInputEl) return;
  const entered = nameInputEl.value.trim().slice(0, 24);
  if (!entered) return; // keep the guest-XXXX stub; they'll be reminded next time
  username = entered;
  hasRealName = true;
  try { localStorage.setItem(NAME_KEY, username); } catch {}
  if (usernameEl) usernameEl.textContent = username;
}

function pickTraveler(choice) {
  commitName();
  traveler = choice;
  applyTravelerStyle(choice);
  if (travelerEl) travelerEl.textContent = `traveler: ${choice.name}`;
  // Kick the BGM off the first user gesture we get.
  startBgm();
  ensureSfx();
  if (chooseEl) {
    chooseEl.classList.add('done');
    setTimeout(() => chooseEl.remove(), 500);
  }
}

// Always show the picker on every load. Returning players re-pick —
// it's one extra click, which is less confusing than the overlay
// vanishing before they can read it.
if (chooseEl) {
  for (const btn of chooseEl.querySelectorAll('.card')) {
    btn.addEventListener('click', () => pickTraveler(CHOICES[btn.dataset.key]));
  }
} else {
  pickTraveler(CHOICES.drift);
}

// ------------------------------------------------------------------
// Third-person mouse look. Click the canvas to lock the pointer; mouse
// movement rotates the camera around the player. WASD moves relative
// to the camera yaw.
// ------------------------------------------------------------------

let yaw = 0;        // 0 = camera at +Z side of player, looking -Z
let pitch = 0.45;   // tilt down from horizontal (radians)
let camDist = 10;   // scroll wheel zooms between CAM_DIST_MIN/MAX
// CAM_DIST_MIN drops below the first-person threshold so the user can
// actually scroll into FP rather than the clamp stopping them short.
const CAM_DIST_MIN = 0.6;
const CAM_DIST_MAX = 15;
const CAM_FP_THRESHOLD = 2.0; // below this, switch to first-person
const camTargetHeight = 1.2;
let firstPerson = false;

// Hoisted so the chat module (declared below) can flip it and the
// keyboard / click handlers here can check it without re-wiring.
let chatOpen = false;

canvas.addEventListener('click', () => {
  if (!traveler || chatOpen) return;
  if (document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
  }
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  yaw -= e.movementX * 0.0028;
  // Mouse down should tilt view down: camera rises, so pitch grows.
  pitch += e.movementY * 0.0028;
  // Allow negative pitch so the camera can dip under the target and
  // tilt up into the sky; updateCamera keeps it above the ground.
  pitch = Math.max(-0.45, Math.min(1.15, pitch));
});

canvas.addEventListener('wheel', (e) => {
  if (!traveler || chatOpen) return;
  e.preventDefault();
  camDist += Math.sign(e.deltaY) * 0.7;
  camDist = Math.max(CAM_DIST_MIN, Math.min(CAM_DIST_MAX, camDist));
}, { passive: false });

function updateCamera() {
  const wantFP = camDist < CAM_FP_THRESHOLD;
  if (wantFP !== firstPerson) {
    firstPerson = wantFP;
    // Hide the character's visible bits in FP so the player isn't
    // looking through their own head. Glow light stays on so nearby
    // surfaces still react to the traveler's color.
    const vis = !firstPerson;
    character.body.visible = vis;
    character.head.visible = vis;
    character.eyeL.visible = vis;
    character.eyeR.visible = vis;
    character.armL.visible = vis;
    character.armR.visible = vis;
  }

  const tx = player.position.x;
  const tz = player.position.z;

  if (firstPerson) {
    // Eye-height camera at the player's head, aimed along (yaw, pitch).
    // Same forward-vector convention as the TP orbit so horizontal mouse
    // swings feel continuous across the transition.
    const ex = tx;
    const ey = player.position.y + 1.3;
    const ez = tz;
    const fx = -Math.sin(yaw) * Math.cos(pitch);
    const fy = -Math.sin(pitch);
    const fz = -Math.cos(yaw) * Math.cos(pitch);
    camera.position.set(ex, ey, ez);
    camera.lookAt(ex + fx, ey + fy, ez + fz);
    return;
  }

  const ty = camTargetHeight;
  const cx = tx + Math.sin(yaw) * Math.cos(pitch) * camDist;
  let   cy = ty + Math.sin(pitch) * camDist;
  const cz = tz + Math.cos(yaw) * Math.cos(pitch) * camDist;
  // Don't let the camera sink below the floor — when pitch is small or
  // negative the cam effectively skims the ground, giving an upward
  // look at the character with lots of sky overhead.
  if (cy < 0.35) cy = 0.35;
  camera.position.set(cx, cy, cz);
  camera.lookAt(tx, ty, tz);
}

updateCamera();

// ------------------------------------------------------------------
// Keyboard
// ------------------------------------------------------------------

const keys = {};
addEventListener('keydown', (e) => {
  if (chatOpen) return; // chat input owns keystrokes while open
  const k = e.key;
  if (traveler && (k === 't' || k === 'T' || k === 'Enter')) {
    e.preventDefault();
    openChat();
    return;
  }
  // Don't let Space scroll the page while playing.
  if (traveler && k === ' ') e.preventDefault();
  keys[k.toLowerCase()] = true;
});
addEventListener('keyup', (e) => {
  if (chatOpen) return;
  keys[e.key.toLowerCase()] = false;
});

// ------------------------------------------------------------------
// Multiplayer — Trystero P2P presence + chat with persistent history
// ------------------------------------------------------------------
//
// Rooms: Nostr strategy, room `lobby-main` under the jam-1 appId.
// Actions:
//   state   — per-frame position/yaw/color/name broadcast
//   chat    — a single chat message with a unique id + timestamp
//   reqhist — "please send me your recent chat history"
//   hist    — response payload with an array of recent messages
//
// History persistence has two layers:
//   1. localStorage — your last ~80 messages are saved across reloads
//      so you see your own chat log immediately on refresh.
//   2. Peer replay — on first-joined-peer, we ask for their recent
//      history once, and dedupe by message id so merges don't double.

const MAX_HISTORY = 80;
const BUBBLE_MS = 5000;
const BROADCAST_INTERVAL_MS = 75;
const HISTORY_KEY = 'gamejam1-lobby:chat:v1';

const peers = new Map(); // peerId -> { state, group }
let room = null;
let sendState = null;
let sendChat = null;
let sendHistoryAction = null;
let requestHistoryAction = null;
let historyRequested = false;
let lastBroadcastAt = 0;

const peersEl = document.getElementById('peers');
const chatHistoryEl = document.getElementById('chat-history');
const chatInputEl = document.getElementById('chat-input');

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatChatTime(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(arr) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr.slice(-MAX_HISTORY)));
  } catch {}
}

const chatHistoryArr = loadHistory();
const seenIds = new Set(chatHistoryArr.map((m) => m.id).filter(Boolean));

function renderHistoryLine(msg) {
  if (!chatHistoryEl) return;
  const line = document.createElement('div');
  line.className = 'history-line';
  line.innerHTML =
    `<span class="history-name" style="color:${escapeHtml(msg.color || '#2a2f3a')}">${escapeHtml(msg.name)}:</span>` +
    `<span class="history-text">${escapeHtml(msg.text)}</span>` +
    `<span class="history-time">${formatChatTime(msg.ts || Date.now())}</span>`;
  chatHistoryEl.appendChild(line);
  while (chatHistoryEl.children.length > MAX_HISTORY) {
    chatHistoryEl.removeChild(chatHistoryEl.firstChild);
  }
  const atBottom =
    chatHistoryEl.scrollHeight - chatHistoryEl.scrollTop - chatHistoryEl.clientHeight < 40;
  if (atBottom) chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
}

// Replay persisted history on load so returning players see their log.
for (const msg of chatHistoryArr.slice(-MAX_HISTORY)) renderHistoryLine(msg);
if (chatHistoryEl) {
  requestAnimationFrame(() => {
    chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
  });
}

function commitMessage(msg) {
  if (!msg || !msg.id || seenIds.has(msg.id)) return;
  seenIds.add(msg.id);
  chatHistoryArr.push(msg);
  if (chatHistoryArr.length > MAX_HISTORY) {
    chatHistoryArr.splice(0, chatHistoryArr.length - MAX_HISTORY);
  }
  saveHistory(chatHistoryArr);
  renderHistoryLine(msg);
}

// -------- Speech bubbles above avatars --------

function setBubble(group, text) {
  const ud = group.userData;
  if (ud.bubble) {
    group.remove(ud.bubble);
    ud.bubble.material.map?.dispose();
    ud.bubble.material.dispose();
  }
  const sprite = textSprite(String(text).slice(0, 80), {
    color: '#2a2f3a',
    bg: 'rgba(255,253,247,0.95)',
    fontSize: 28,
    fontWeight: 600,
  });
  sprite.position.set(0, 2.35, 0);
  group.add(sprite);
  ud.bubble = sprite;
  ud.bubbleExpires = performance.now() + BUBBLE_MS;
}

function clearExpiredBubble(group) {
  const ud = group.userData;
  if (ud.bubbleExpires && performance.now() > ud.bubbleExpires) {
    if (ud.bubble) {
      group.remove(ud.bubble);
      ud.bubble.material.map?.dispose();
      ud.bubble.material.dispose();
    }
    ud.bubble = null;
    ud.bubbleExpires = 0;
  }
}

// -------- Peer avatar (body + head + eyes + name tag; emissive and
// glow light are driven by the peer's broadcast travelerKey, so their
// choice reads visually from across the hub). --------

function buildPeerAvatar(colorHex, name, travelerKey) {
  const group = new THREE.Group();
  const color = new THREE.Color('#' + colorHex);
  const bodyMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0,
    roughness: 0.55,
  });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xfff5dc, roughness: 0.7 });
  const eyeMat  = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.4 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.42, 6, 14), bodyMat);
  body.position.y = 0.55;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 20), skinMat);
  head.position.y = 1.2;
  group.add(head);

  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), eyeMat);
  eyeL.position.set(-0.1, 1.24, -0.25);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), eyeMat);
  eyeR.position.set(0.1, 1.24, -0.25);
  group.add(eyeR);

  const glowLight = new THREE.PointLight(color, 0, 5, 2);
  glowLight.position.y = 0.8;
  group.add(glowLight);

  const nameTag = textSprite(String(name || 'guest').slice(0, 24), {
    color: '#2a2f3a',
    bg: 'rgba(255,253,247,0.9)',
    fontSize: 26,
    fontWeight: 600,
  });
  nameTag.position.set(0, 1.85, 0);
  group.add(nameTag);

  group.userData = {
    bodyMat, glowLight, nameTag,
    bubble: null, bubbleExpires: 0,
    displayName: name,
    travelerKey: null,
  };

  applyPeerChoice(group, colorHex, travelerKey);
  return group;
}

function applyPeerChoice(group, colorHex, travelerKey) {
  const ud = group.userData;
  const color = new THREE.Color('#' + (colorHex || '888888'));
  ud.bodyMat.color.copy(color);
  ud.bodyMat.emissive.copy(color);
  const choice = travelerKey && CHOICES[travelerKey];
  if (choice) {
    ud.bodyMat.emissiveIntensity = choice.emissive;
    ud.glowLight.color.copy(color);
    ud.glowLight.intensity = choice.glow;
  } else {
    ud.bodyMat.emissiveIntensity = 0;
    ud.glowLight.intensity = 0;
  }
  ud.travelerKey = travelerKey || null;
}

function updatePeerName(group, newName) {
  const ud = group.userData;
  if (ud.displayName === newName) return;
  ud.displayName = newName;
  group.remove(ud.nameTag);
  ud.nameTag.material.map?.dispose();
  ud.nameTag.material.dispose();
  const sprite = textSprite(String(newName || 'guest').slice(0, 24), {
    color: '#2a2f3a',
    bg: 'rgba(255,253,247,0.9)',
    fontSize: 26,
    fontWeight: 600,
  });
  sprite.position.set(0, 1.85, 0);
  group.add(sprite);
  ud.nameTag = sprite;
}

// -------- Chat input flow --------

function openChat() {
  if (chatOpen || !chatInputEl) return;
  chatOpen = true;
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  for (const k in keys) keys[k] = false;
  chatInputEl.style.display = 'block';
  chatInputEl.value = '';
  requestAnimationFrame(() => chatInputEl.focus());
}

function closeChat(commit) {
  if (!chatOpen || !chatInputEl) return;
  chatOpen = false;
  const text = chatInputEl.value.trim();
  chatInputEl.style.display = 'none';
  chatInputEl.blur();
  if (commit && text) {
    const msg = {
      id: `${username}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name: username,
      color: traveler ? '#' + traveler.hex : '#2a2f3a',
      text: text.slice(0, 200),
      ts: Date.now(),
    };
    commitMessage(msg);
    setBubble(player, msg.text);
    if (sendChat) sendChat(msg);
  }
}

if (chatInputEl) {
  chatInputEl.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); closeChat(true); }
    else if (e.key === 'Escape') { e.preventDefault(); closeChat(false); }
  });
}

// -------- Trystero wiring --------

function broadcastSelf() {
  if (!sendState || !traveler) return;
  sendState({
    x: player.position.x,
    y: player.position.y,
    z: player.position.z,
    yaw: player.rotation.y,
    color: traveler.hex,
    name: username,
    travelerKey: traveler.key,
  });
}

function refreshPeerCount() {
  if (!peersEl) return;
  peersEl.textContent = `${peers.size + 1} online`;
}

async function loadTrystero() {
  const urls = [
    'https://esm.run/trystero@0.23',
    'https://cdn.jsdelivr.net/npm/trystero@0.23/+esm',
    'https://esm.sh/trystero@0.23',
  ];
  let lastErr;
  for (const url of urls) {
    try {
      const mod = await import(url);
      if (mod && typeof mod.joinRoom === 'function') return mod;
      lastErr = new Error(`no joinRoom export from ${url}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('could not load trystero');
}

async function setupMultiplayer() {
  try {
    if (peersEl) peersEl.textContent = 'connecting…';
    const { joinRoom } = await loadTrystero();
    room = joinRoom({ appId: 'ordinary-game-jam-1-lobby' }, 'lobby-main');

    const [sendS, getS] = room.makeAction('state');
    const [sendC, getC] = room.makeAction('chat');
    const [sendH, getH] = room.makeAction('hist');
    const [sendR, getR] = room.makeAction('reqhist');
    sendState = sendS;
    sendChat = sendC;
    sendHistoryAction = sendH;
    requestHistoryAction = sendR;

    getS((data, peerId) => {
      if (!data) return;
      let peer = peers.get(peerId);
      if (!peer) {
        peer = { state: null, group: null };
        peers.set(peerId, peer);
      }
      if (!peer.group) {
        peer.group = buildPeerAvatar(data.color || '888888', data.name || 'guest', data.travelerKey);
        peer.group.position.set(data.x || 0, data.y || 0, data.z || 0);
        scene.add(peer.group);
      } else {
        if (
          peer.state?.color !== data.color ||
          peer.state?.travelerKey !== data.travelerKey
        ) {
          applyPeerChoice(peer.group, data.color || '888888', data.travelerKey);
        }
        if (peer.state?.name !== data.name) {
          updatePeerName(peer.group, data.name || 'guest');
        }
      }
      const prev = peer.state;
      peer.state = {
        x: data.x, y: data.y, z: data.z,
        yaw: data.yaw || 0,
        color: data.color,
        name: data.name,
        travelerKey: data.travelerKey || null,
        renderX: prev?.renderX ?? data.x,
        renderY: prev?.renderY ?? data.y,
        renderZ: prev?.renderZ ?? data.z,
      };
      refreshPeerCount();
    });

    getC((data, peerId) => {
      if (!data || !data.text) return;
      const msg = {
        id: data.id || `${peerId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        name: String(data.name || '?').slice(0, 24),
        color: typeof data.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(data.color) ? data.color : '#2a2f3a',
        text: String(data.text).slice(0, 200),
        ts: Number(data.ts) || Date.now(),
      };
      commitMessage(msg);
      const peer = peers.get(peerId);
      if (peer?.group) setBubble(peer.group, msg.text);
    });

    getR((_, peerId) => {
      if (!sendHistoryAction) return;
      // Reply with our latest ~30 messages so the requester can merge.
      sendHistoryAction({ messages: chatHistoryArr.slice(-30) }, peerId);
    });

    getH((data) => {
      if (!data || !Array.isArray(data.messages)) return;
      // Merge by id; dedup handles everybody replying at once.
      const merged = data.messages
        .filter((m) => m && m.id && !seenIds.has(m.id))
        .sort((a, b) => (a.ts || 0) - (b.ts || 0));
      for (const m of merged) commitMessage(m);
    });

    room.onPeerJoin((id) => {
      if (!peers.has(id)) peers.set(id, { state: null, group: null });
      broadcastSelf();
      refreshPeerCount();
      // Ask the first peer we see for their recent history (once).
      if (!historyRequested && requestHistoryAction) {
        historyRequested = true;
        requestHistoryAction({ want: true }, id);
      }
    });

    room.onPeerLeave((id) => {
      const p = peers.get(id);
      if (p?.group) scene.remove(p.group);
      peers.delete(id);
      refreshPeerCount();
    });

    refreshPeerCount();
    broadcastSelf();
  } catch (err) {
    console.error('[lobby] multiplayer setup failed:', err);
    if (peersEl) peersEl.textContent = 'multiplayer offline';
  }
}

setupMultiplayer();

addEventListener('beforeunload', () => {
  if (room) { try { room.leave(); } catch {} }
});

// ------------------------------------------------------------------
// Main loop
// ------------------------------------------------------------------

let redirecting = false;
let t = 0;
let last = performance.now();

// Smoothed velocity used for acceleration-based movement. Per-traveler
// `accel` controls how quickly this chases the input vector, giving
// Spark a snappy feel and Wander a slow-to-start drift.
const playerVel = { x: 0, z: 0 };

// Jump physics — jumpY is the vertical offset above the hover
// baseline. Gravity integrates jumpVy each frame; landing clamps to 0.
let jumpY = 0;
let jumpVy = 0;

// Footstep cadence — counts down in seconds scaled by movement speed,
// so faster travelers crunch more often. A small random jitter per
// step keeps it from sounding metronomic.
let playerStepTimer = 0;
const STEP_INTERVAL = 0.58;

function loop(now) {
  // Raw (uncapped) frame time for the perf overlay, so we see actual
  // hitches rather than the clamped physics-step version.
  const rawDtMs = now - last;
  const dt = Math.min(0.05, rawDtMs / 1000);
  last = now;
  t += dt;
  perfRecord(now, rawDtMs);

  // Ambient animations always run
  lantern.position.y = 1.55 + Math.sin(t * 1.5) * 0.08;
  lantern.rotation.y += dt * 0.4;

  for (const m of motes) {
    m.position.y += m.userData.vy * dt;
    m.position.x += m.userData.vx * dt;
    m.rotation.z += m.userData.spin * dt;
    if (m.position.y < 0.1) {
      m.position.y = 8 + Math.random() * 2;
      m.position.x = (Math.random() - 0.5) * 40;
      m.position.z = (Math.random() - 0.5) * 40;
    }
  }

  // Snow/rain — fall + sway + drift computed entirely in the vertex
  // shader. tickWeather crossfades between snow and rain parameters
  // and syncs the rain ambience level.
  snowMat.uniforms.uTime.value = t;
  tickWeather(t, dt);

  for (const g of portals) {
    g.userData.torus.rotation.z += dt * 0.9;
    g.userData.disc.material.opacity = 0.3 + Math.sin(t * 2.5 + g.userData.angle) * 0.14;
  }
  if (returnPortal) {
    returnPortal.torus.rotation.z += dt * 0.9;
    returnPortal.disc.material.opacity = 0.32 + Math.sin(t * 2.5) * 0.14;
  }

  // Peer render update — runs regardless of traveler pick so the
  // hub looks alive while the picker is still open.
  for (const peer of peers.values()) {
    if (!peer.state || !peer.group) continue;
    const k = Math.min(1, dt * 12);
    const prevRX = peer.state._prevRX ?? peer.state.renderX;
    const prevRZ = peer.state._prevRZ ?? peer.state.renderZ;
    peer.state.renderX += (peer.state.x - peer.state.renderX) * k;
    peer.state.renderY += (peer.state.y - peer.state.renderY) * k;
    peer.state.renderZ += (peer.state.z - peer.state.renderZ) * k;
    peer.group.position.set(peer.state.renderX, peer.state.renderY, peer.state.renderZ);
    peer.group.rotation.y = peer.state.yaw;
    clearExpiredBubble(peer.group);

    // Peer footstep cadence from render-space velocity. playCrunchAt
    // no-ops when the peer is too far to be audible, so this stays
    // cheap even with many peers.
    const pdx = peer.state.renderX - prevRX;
    const pdz = peer.state.renderZ - prevRZ;
    const pSpeed = Math.hypot(pdx, pdz) / Math.max(0.0001, dt);
    peer.state._prevRX = peer.state.renderX;
    peer.state._prevRZ = peer.state.renderZ;
    if (pSpeed > 0.5 && (peer.state.renderY ?? 0) <= 0.3) {
      peer.state._stepTimer = (peer.state._stepTimer ?? 0) - dt * (pSpeed / 4.5);
      if (peer.state._stepTimer <= 0) {
        peer.state._stepTimer = STEP_INTERVAL + (Math.random() - 0.5) * 0.06;
        playCrunchAt(peer.state.renderX, peer.state.renderZ);
      }
    }
  }

  updatePortalHums();
  clearExpiredBubble(player);

  // Gate input on traveler pick
  if (!traveler) {
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
    return;
  }

  // WASD relative to camera yaw
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw); // forward (away from camera)
  const rx =  Math.cos(yaw), rz = -Math.sin(yaw); // camera-right

  let mx = 0, mz = 0;
  if (keys['w'] || keys['arrowup'])    { mx += fx; mz += fz; }
  if (keys['s'] || keys['arrowdown'])  { mx -= fx; mz -= fz; }
  if (keys['d'] || keys['arrowright']) { mx += rx; mz += rz; }
  if (keys['a'] || keys['arrowleft'])  { mx -= rx; mz -= rz; }
  const inputLen = Math.hypot(mx, mz);
  if (inputLen > 0) { mx /= inputLen; mz /= inputLen; }

  // Acceleration-based velocity — the traveler's `accel` sets how
  // quickly the current velocity chases the input-scaled target.
  const targetVx = mx * traveler.speed;
  const targetVz = mz * traveler.speed;
  const k = Math.min(1, dt * traveler.accel);
  playerVel.x += (targetVx - playerVel.x) * k;
  playerVel.z += (targetVz - playerVel.z) * k;

  player.position.x += playerVel.x * dt;
  player.position.z += playerVel.z * dt;

  const maxR = 30;
  const pd = Math.hypot(player.position.x, player.position.z);
  if (pd > maxR) {
    player.position.x = (player.position.x / pd) * maxR;
    player.position.z = (player.position.z / pd) * maxR;
  }

  const speedSq = playerVel.x * playerVel.x + playerVel.z * playerVel.z;
  const walking = speedSq > 0.25; // ~0.5 units/s threshold

  if (walking) {
    const speed = Math.sqrt(speedSq);
    playerStepTimer -= dt * (speed / 4.5);
    if (playerStepTimer <= 0) {
      playerStepTimer = STEP_INTERVAL + (Math.random() - 0.5) * 0.06;
      // Grounded-only: silence the crunch while airborne.
      if (jumpY <= 0.05) playCrunch(0.9, 0);
    }
  } else if (playerStepTimer > STEP_INTERVAL * 0.5) {
    // Shrink the accumulator when idle so the first step on resumption
    // hits promptly rather than waiting for a leftover long interval.
    playerStepTimer = STEP_INTERVAL * 0.5;
  }

  // Face movement direction (character's local front is -Z).
  if (walking) {
    const target = Math.atan2(-playerVel.x, -playerVel.z);
    let diff = target - player.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    player.rotation.y += diff * Math.min(1, dt * 10);
  }

  // Hover lifts the whole character off the ground. Wander uses this
  // to feel floaty; Spark and Drift stay grounded.
  const hoverY = traveler.hover > 0
    ? traveler.hover + Math.sin(t * 1.6) * 0.06
    : 0;

  // Jump: launch from the hover baseline if grounded and Space is
  // held. Gravity always integrates while airborne; landing clamps.
  const grounded = jumpY === 0 && jumpVy === 0;
  if (grounded && keys[' ']) {
    jumpVy = traveler.jumpSpeed;
  }
  if (!grounded || jumpVy !== 0) {
    jumpVy += traveler.gravity * dt;
    jumpY += jumpVy * dt;
    if (jumpY < 0) { jumpY = 0; jumpVy = 0; }
  }

  player.position.y = hoverY + jumpY;

  // Walk cycle — traveler-driven frequency and amplitude.
  const freq = walking ? traveler.bobFreq : traveler.bobFreq * 0.3;
  const amp  = walking ? traveler.bobAmp  : traveler.bobAmp * 0.3;
  const bob  = Math.sin(t * freq) * amp;
  character.body.position.y = 0.55 + bob;
  character.head.position.y = 1.2 + bob;
  character.eyeL.position.y = 1.24 + bob;
  character.eyeR.position.y = 1.24 + bob;
  const swing = walking ? Math.sin(t * freq) * 0.5 : 0;
  character.armL.rotation.x = swing;
  character.armR.rotation.x = -swing;

  // Traveler particle emission — rate scales up while moving so trails
  // feel like motion, not just an idle aura.
  const rate = traveler.particle.rate * (walking ? 1.8 : 1.0);
  particleAccum += dt * rate;
  while (particleAccum >= 1) {
    particleAccum -= 1;
    spawnParticle();
  }
  for (const p of particles) {
    if (!p.userData.alive) continue;
    p.userData.age += dt;
    if (p.userData.age >= p.userData.life) {
      p.userData.alive = false;
      p.visible = false;
      continue;
    }
    p.position.x += p.userData.vx * dt;
    p.position.y += p.userData.vy * dt;
    p.position.z += p.userData.vz * dt;
    p.userData.vy += p.userData.gy * dt;
    const fade = 1 - (p.userData.age / p.userData.life);
    p.material.opacity = fade * 0.9;
  }

  updateCamera();

  // Throttled state broadcast (peer interp runs above the gate).
  if (now - lastBroadcastAt > BROADCAST_INTERVAL_MS) {
    lastBroadcastAt = now;
    broadcastSelf();
  }

  // Portal collision
  if (!redirecting) {
    for (const g of portals) {
      const dx = player.position.x - g.position.x;
      const dz = player.position.z - g.position.z;
      if (Math.hypot(dx, dz) < 1.35) {
        redirecting = true;
        Portal.sendPlayerThroughPortal(g.userData.game.url, {
          username,
          color: traveler.hex,
          speed: traveler.speed,
        });
        break;
      }
    }
  }

  if (returnPortal && !redirecting) {
    const dx = player.position.x - returnPortal.group.position.x;
    const dz = player.position.z - returnPortal.group.position.z;
    if (Math.hypot(dx, dz) < 1.35) {
      redirecting = true;
      Portal.sendPlayerThroughPortal(returnPortal.target, {
        username,
        color: traveler.hex,
        speed: traveler.speed,
      });
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
