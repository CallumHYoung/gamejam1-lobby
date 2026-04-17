// Ordinary Game Jam #1 — Lobby
//
// A 3D hub that reads jam1.json and spawns a portal per submission.
// On load the player picks a traveler (the jam's "choices" mechanic);
// mouse-look is third-person orbit via pointer lock.

import * as THREE from 'three';

const incoming = Portal.readPortalParams();
document.getElementById('username').textContent = incoming.username;

// ------------------------------------------------------------------
// Scene, renderer, camera
// ------------------------------------------------------------------

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfd8e3);
scene.fog = new THREE.Fog(0xcfd8e3, 30, 72);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------
// Lighting
// ------------------------------------------------------------------

scene.add(new THREE.HemisphereLight(0xffeecc, 0x647ea0, 1.0));
const sun = new THREE.DirectionalLight(0xfff1cf, 0.85);
sun.position.set(12, 22, 8);
scene.add(sun);

// ------------------------------------------------------------------
// Ground + rings + center lantern
// ------------------------------------------------------------------

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(32, 72),
  new THREE.MeshStandardMaterial({ color: 0xe9e2cc, roughness: 0.95 }),
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
      emissiveIntensity: 0.6,
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

  const light = new THREE.PointLight(color, 0.55, 6, 2);
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

  const light = new THREE.PointLight(color, 0.7, 6, 2);
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
// Character — capsule body + sphere head + eyes + tiny arms.
// Built facing -Z (three.js convention), so rotation.y = 0 means the
// character looks along world -Z.
// ------------------------------------------------------------------

function buildCharacter(colorHex) {
  const group = new THREE.Group();
  const color = new THREE.Color('#' + colorHex);
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
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

  return { group, bodyMat, body, head, armL, armR, eyeL, eyeR };
}

const character = buildCharacter(incoming.color);
const player = character.group;
const spawnZ = incoming.fromPortal && incoming.ref ? 13 : 8;
player.position.set(0, 0, spawnZ);
scene.add(player);

function setCharacterColor(hex) {
  character.bodyMat.color.set('#' + hex);
}

// ------------------------------------------------------------------
// Choice screen — player picks a traveler on load. If they arrived
// via a portal we skip the picker and reuse the incoming state.
// ------------------------------------------------------------------

const CHOICES = {
  spark:  { key: 'spark',  hex: 'e8b64c', name: 'Spark',  speed: 6,   desc: 'quick on their feet' },
  drift:  { key: 'drift',  hex: '7fb9ae', name: 'Drift',  speed: 5,   desc: 'steady, curious' },
  wander: { key: 'wander', hex: 'a892c6', name: 'Wander', speed: 4.2, desc: 'takes their time' },
};

let traveler = null;
const chooseEl = document.getElementById('choose');
const travelerEl = document.getElementById('traveler');

function pickTraveler(choice) {
  traveler = choice;
  setCharacterColor(choice.hex);
  travelerEl.textContent = `traveler: ${choice.name}`;
  chooseEl.classList.add('done');
  setTimeout(() => chooseEl.remove(), 500);
}

if (incoming.fromPortal) {
  pickTraveler({
    key: 'return',
    hex: incoming.color,
    name: 'returning',
    speed: incoming.speed || 5,
    desc: 'welcome back',
  });
} else {
  for (const btn of chooseEl.querySelectorAll('.card')) {
    btn.addEventListener('click', () => pickTraveler(CHOICES[btn.dataset.key]));
  }
}

// ------------------------------------------------------------------
// Third-person mouse look. Click the canvas to lock the pointer; mouse
// movement rotates the camera around the player. WASD moves relative
// to the camera yaw.
// ------------------------------------------------------------------

let yaw = 0;        // 0 = camera at +Z side of player, looking -Z
let pitch = 0.45;   // tilt down from horizontal (radians)
const camDist = 10;
const camTargetHeight = 1.2;

canvas.addEventListener('click', () => {
  if (!traveler) return;
  if (document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
  }
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  yaw -= e.movementX * 0.0028;
  pitch -= e.movementY * 0.0028;
  pitch = Math.max(0.08, Math.min(1.1, pitch));
});

function updateCamera() {
  const tx = player.position.x;
  const ty = camTargetHeight;
  const tz = player.position.z;
  const cx = tx + Math.sin(yaw) * Math.cos(pitch) * camDist;
  const cy = ty + Math.sin(pitch) * camDist;
  const cz = tz + Math.cos(yaw) * Math.cos(pitch) * camDist;
  camera.position.set(cx, cy, cz);
  camera.lookAt(tx, ty, tz);
}

updateCamera();

// ------------------------------------------------------------------
// Keyboard
// ------------------------------------------------------------------

const keys = {};
addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
addEventListener('keyup',   (e) => { keys[e.key.toLowerCase()] = false; });

// ------------------------------------------------------------------
// Main loop
// ------------------------------------------------------------------

let redirecting = false;
let t = 0;
let last = performance.now();

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;

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

  for (const g of portals) {
    g.userData.torus.rotation.z += dt * 0.9;
    g.userData.disc.material.opacity = 0.3 + Math.sin(t * 2.5 + g.userData.angle) * 0.14;
  }
  if (returnPortal) {
    returnPortal.torus.rotation.z += dt * 0.9;
    returnPortal.disc.material.opacity = 0.32 + Math.sin(t * 2.5) * 0.14;
  }

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
  const len = Math.hypot(mx, mz);
  if (len > 0) { mx /= len; mz /= len; }

  const baseSpeed = traveler.speed || 5;
  player.position.x += mx * baseSpeed * dt;
  player.position.z += mz * baseSpeed * dt;

  const maxR = 30;
  const pd = Math.hypot(player.position.x, player.position.z);
  if (pd > maxR) {
    player.position.x = (player.position.x / pd) * maxR;
    player.position.z = (player.position.z / pd) * maxR;
  }

  // Face movement direction (character's local front is -Z).
  if (len > 0) {
    const target = Math.atan2(-mx, -mz);
    let diff = target - player.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    player.rotation.y += diff * Math.min(1, dt * 10);
  }

  // Walk cycle — bob body/head, swing arms
  const walking = len > 0;
  const bob = Math.sin(t * (walking ? 10 : 2)) * (walking ? 0.08 : 0.02);
  character.body.position.y = 0.55 + bob;
  character.head.position.y = 1.2 + bob;
  character.eyeL.position.y = 1.24 + bob;
  character.eyeR.position.y = 1.24 + bob;
  character.armL.rotation.x = walking ? Math.sin(t * 10) * 0.5 : 0;
  character.armR.rotation.x = walking ? -Math.sin(t * 10) * 0.5 : 0;

  updateCamera();

  // Portal collision
  if (!redirecting) {
    for (const g of portals) {
      const dx = player.position.x - g.position.x;
      const dz = player.position.z - g.position.z;
      if (Math.hypot(dx, dz) < 1.35) {
        redirecting = true;
        Portal.sendPlayerThroughPortal(g.userData.game.url, {
          username: incoming.username,
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
        username: incoming.username,
        color: traveler.hex,
        speed: traveler.speed,
      });
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
