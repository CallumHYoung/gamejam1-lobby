// Ordinary Game Jam #1 — Lobby
//
// A 3D hub that reads jam1.json and spawns a portal for each submission.
// Theme: "double meaning" + mechanic: "choices" (roguelike-style).
//
// Read lightly:
//   - Every sign has two readings: the game title, then the short pitch
//     underneath — one place, two meanings.
//   - Three gift pedestals in the center offer roguelike-style choices.
//     Every gift is kind — no punishments, just different flavors of
//     encouragement. Each gift's name has a second reading printed below.
//   - Whatever gift you're carrying travels with you through the portal
//     (color + speed ride along via the Portal Protocol).

import * as THREE from 'three';

const incoming = Portal.readPortalParams();
document.getElementById('username').textContent = incoming.username;

// ------------------------------------------------------------------
// Scene, camera, renderer
// ------------------------------------------------------------------

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf6d5e8);
scene.fog = new THREE.Fog(0xf6d5e8, 28, 70);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 12, 20);
camera.lookAt(0, 1, 0);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------
// Lighting
// ------------------------------------------------------------------

scene.add(new THREE.HemisphereLight(0xffe4f1, 0xd1a6c8, 1.2));
const sun = new THREE.DirectionalLight(0xfff2d6, 0.85);
sun.position.set(12, 22, 8);
scene.add(sun);

// ------------------------------------------------------------------
// Ground + inner wishing ring
// ------------------------------------------------------------------

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(32, 72),
  new THREE.MeshStandardMaterial({ color: 0xfbe0ec, roughness: 0.95 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const innerRing = new THREE.Mesh(
  new THREE.RingGeometry(3.2, 3.5, 72),
  new THREE.MeshStandardMaterial({
    color: 0xfff0c4,
    emissive: 0xffd49a,
    emissiveIntensity: 0.5,
    side: THREE.DoubleSide,
  }),
);
innerRing.rotation.x = -Math.PI / 2;
innerRing.position.y = 0.01;
scene.add(innerRing);

// Outer path ring, just a soft visual guide
const outerRing = new THREE.Mesh(
  new THREE.RingGeometry(13.6, 14.4, 96),
  new THREE.MeshStandardMaterial({
    color: 0xffdfee,
    emissive: 0xffc2dd,
    emissiveIntensity: 0.25,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.5,
  }),
);
outerRing.rotation.x = -Math.PI / 2;
outerRing.position.y = 0.02;
scene.add(outerRing);

// ------------------------------------------------------------------
// Text label helper — builds a CanvasTexture sprite that always faces
// the camera. Sprites are cheap and readable from any angle.
// ------------------------------------------------------------------

function textSprite(text, opts = {}) {
  const {
    color = '#3a1a3e',
    bg = 'rgba(255,255,255,0.92)',
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
  const metrics = ctx.measureText(text);
  const w = Math.ceil(metrics.width) + pad * 2;
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
  // scale to world units — ~100px per world unit
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
// Center welcome sign
// ------------------------------------------------------------------

const welcome = textSprite('a lobby, read two ways', {
  color: '#4a1f57',
  bg: 'rgba(255,255,255,0.85)',
  fontSize: 34,
  fontWeight: 500,
  italic: true,
});
welcome.position.set(0, 5.2, 0);
scene.add(welcome);

// ------------------------------------------------------------------
// Blessing pedestals — the "choices" mechanic.
// Each gift has a primary name and a second reading underneath. They
// are purely positive; the "choice" is about flavor, not tradeoff.
// ------------------------------------------------------------------

const BLESSINGS = [
  { key: 'sunshine',  name: 'Sunshine',  aka: 'also: a bright heart',   hex: 'fcd34d', speed: 5 },
  { key: 'softness',  name: 'Softness',  aka: 'also: a gentle step',    hex: 'f9a8d4', speed: 5 },
  { key: 'starlight', name: 'Starlight', aka: 'also: a curious soul',   hex: '93c5fd', speed: 6 },
];

const pedestals = [];

BLESSINGS.forEach((b, i) => {
  const angle = (i / BLESSINGS.length) * Math.PI * 2 + Math.PI / 2;
  const r = 2.6;
  const group = new THREE.Group();
  group.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.75, 0.35, 28),
    new THREE.MeshStandardMaterial({ color: 0xfff8e7, roughness: 0.6 }),
  );
  base.position.y = 0.175;
  group.add(base);

  const colorNum = parseInt(b.hex, 16);
  const orb = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.42, 2),
    new THREE.MeshStandardMaterial({
      color: colorNum,
      emissive: colorNum,
      emissiveIntensity: 0.6,
      roughness: 0.25,
    }),
  );
  orb.position.y = 1.1;
  group.add(orb);

  const orbLight = new THREE.PointLight(colorNum, 0.9, 4, 2);
  orbLight.position.y = 1.1;
  group.add(orbLight);

  const nameLabel = textSprite(b.name, {
    color: '#3a1a3e',
    bg: 'rgba(255,255,255,0.94)',
    fontSize: 38,
    fontWeight: 700,
  });
  nameLabel.position.set(0, 2.15, 0);
  group.add(nameLabel);

  const akaLabel = textSprite(b.aka, {
    color: '#6d466f',
    bg: 'rgba(255,240,248,0.85)',
    fontSize: 24,
    italic: true,
    fontWeight: 500,
  });
  akaLabel.position.set(0, 1.62, 0);
  group.add(akaLabel);

  group.userData = { blessing: b, orb, baseAngle: angle };
  pedestals.push(group);
  scene.add(group);
});

// ------------------------------------------------------------------
// Portals — one per registry game, arranged around the outer ring.
// Each portal shows its title on top and the short pitch underneath;
// two readings of the same doorway.
// ------------------------------------------------------------------

const portals = [];

function makePortal(game, angle) {
  const group = new THREE.Group();
  const R = 14;
  group.position.set(Math.cos(angle) * R, 0, Math.sin(angle) * R);
  // Orient the whole group so its local -Z faces the hub center; the
  // torus/disc are added as children with their default axes and
  // inherit this orientation, which places their visible faces radial
  // to the circle without any extra math.
  group.lookAt(0, 0, 0);

  // Hue cycles gently around the circle so colors don't clash.
  const hue = ((angle / (Math.PI * 2)) + 0.85) % 1;
  const color = new THREE.Color().setHSL(hue, 0.55, 0.68);

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
      opacity: 0.38,
      side: THREE.DoubleSide,
    }),
  );
  disc.position.y = 1.9;
  group.add(disc);

  const portalLight = new THREE.PointLight(color, 0.6, 6, 2);
  portalLight.position.y = 1.9;
  group.add(portalLight);

  const title = textSprite(game.title, {
    color: '#3a1a3e',
    bg: 'rgba(255,255,255,0.95)',
    fontSize: 44,
    fontWeight: 700,
  });
  title.position.set(0, 3.9, 0);
  group.add(title);

  const sub = textSprite(game.description || 'also: somewhere to visit', {
    color: '#6d466f',
    bg: 'rgba(255,240,248,0.85)',
    fontSize: 24,
    italic: true,
    fontWeight: 500,
  });
  sub.position.set(0, 3.28, 0);
  group.add(sub);

  group.userData = { game, torus, disc, angle };
  portals.push(group);
  scene.add(group);
}

// ------------------------------------------------------------------
// Drifting kindness petals — quiet ambient flair.
// ------------------------------------------------------------------

const petals = [];
const petalGeo = new THREE.PlaneGeometry(0.18, 0.18);
const petalMat = new THREE.MeshBasicMaterial({
  color: 0xffc2dd,
  transparent: true,
  opacity: 0.75,
  side: THREE.DoubleSide,
});
for (let i = 0; i < 40; i++) {
  const m = new THREE.Mesh(petalGeo, petalMat);
  m.position.set(
    (Math.random() - 0.5) * 40,
    Math.random() * 8 + 1,
    (Math.random() - 0.5) * 40,
  );
  m.userData = {
    vy: -(Math.random() * 0.3 + 0.15),
    vx: (Math.random() - 0.5) * 0.15,
    spin: (Math.random() - 0.5) * 1.5,
  };
  petals.push(m);
  scene.add(m);
}

// ------------------------------------------------------------------
// Player avatar
// ------------------------------------------------------------------

const player = new THREE.Group();
// Default spawn is just outside the wishing circle. If the player
// arrived via a portal, spawn them past the return portal (further
// out) so they aren't immediately sucked back through it.
const spawnZ = incoming.fromPortal && incoming.ref ? 13 : 8;
player.position.set(0, 0, spawnZ);
scene.add(player);

const initialColor = new THREE.Color('#' + incoming.color);
const bodyMat = new THREE.MeshStandardMaterial({
  color: initialColor,
  emissive: initialColor,
  emissiveIntensity: 0.3,
  roughness: 0.35,
});
const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 28, 28), bodyMat);
body.position.y = 0.5;
player.add(body);

// Little halo to hint at "blessing"
const halo = new THREE.Mesh(
  new THREE.TorusGeometry(0.55, 0.04, 12, 32),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }),
);
halo.position.y = 1.0;
halo.rotation.x = Math.PI / 2;
player.add(halo);

let currentBlessing = null;
const blessingEl = document.getElementById('blessing');

function applyBlessing(b) {
  if (currentBlessing?.key === b.key) return;
  currentBlessing = b;
  const c = new THREE.Color('#' + b.hex);
  bodyMat.color.copy(c);
  bodyMat.emissive.copy(c);
  halo.material.color.copy(c);
  halo.material.opacity = 0.85;
  blessingEl.textContent = `blessing: ${b.name} — ${b.aka.replace(/^also: /, '')}`;
}

// ------------------------------------------------------------------
// Return portal — shown only when the player arrived from another
// game. Placed between spawn and the outer ring so it's easy to find
// but out of the way of the main portal circle and the pedestals.
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
      emissiveIntensity: 0.8,
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
// Registry fetch + portal spawn. We filter out any entry whose URL
// matches this page, otherwise the lobby would spawn a portal
// pointing back at itself.
// ------------------------------------------------------------------

(async () => {
  const games = await Portal.fetchJamRegistry();
  const here = window.location.href.split('?')[0];
  const norm = (s) => s.split('?')[0].replace(/\/$/, '');
  const others = (games || []).filter((g) => norm(g.url) !== norm(here));

  if (others.length === 0) {
    // No other games in the registry — keep the lobby friendly with a
    // single portal back to the jam homepage so visitors aren't
    // stranded.
    makePortal(
      {
        title: 'Jam hub',
        description: 'also: the front door',
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
// Input
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

  // Movement
  const baseSpeed = currentBlessing?.speed || incoming.speed || 5;
  const v = baseSpeed * dt;
  let mx = 0, mz = 0;
  if (keys['w'] || keys['arrowup'])    mz -= 1;
  if (keys['s'] || keys['arrowdown'])  mz += 1;
  if (keys['a'] || keys['arrowleft'])  mx -= 1;
  if (keys['d'] || keys['arrowright']) mx += 1;
  const len = Math.hypot(mx, mz);
  if (len > 0) { mx /= len; mz /= len; }
  player.position.x += mx * v;
  player.position.z += mz * v;

  // Soft clamp to the floor disc
  const maxR = 30;
  const pd = Math.hypot(player.position.x, player.position.z);
  if (pd > maxR) {
    player.position.x = (player.position.x / pd) * maxR;
    player.position.z = (player.position.z / pd) * maxR;
  }

  body.position.y = 0.5 + Math.sin(t * 4 + player.position.x) * 0.04;
  halo.rotation.z += dt * 1.2;

  // Camera follows gently from behind-above
  const camTargetX = player.position.x * 0.35;
  const camTargetZ = player.position.z * 0.35 + 18;
  camera.position.x += (camTargetX - camera.position.x) * 0.06;
  camera.position.z += (camTargetZ - camera.position.z) * 0.06;
  camera.lookAt(player.position.x, 1, player.position.z);

  // Portal animation + collision
  for (const g of portals) {
    g.userData.torus.rotation.z += dt * 0.9;
    g.userData.disc.material.opacity = 0.3 + Math.sin(t * 2.5 + g.userData.angle) * 0.14;

    if (!redirecting) {
      const dx = player.position.x - g.position.x;
      const dz = player.position.z - g.position.z;
      if (Math.hypot(dx, dz) < 1.35) {
        redirecting = true;
        const colorHex = currentBlessing ? currentBlessing.hex : incoming.color;
        const speed = currentBlessing?.speed || incoming.speed || 5;
        Portal.sendPlayerThroughPortal(g.userData.game.url, {
          username: incoming.username,
          color: colorHex,
          speed,
        });
      }
    }
  }

  // Return portal animation + collision
  if (returnPortal) {
    returnPortal.torus.rotation.z += dt * 0.9;
    returnPortal.disc.material.opacity = 0.32 + Math.sin(t * 2.5) * 0.14;
    if (!redirecting) {
      const dx = player.position.x - returnPortal.group.position.x;
      const dz = player.position.z - returnPortal.group.position.z;
      if (Math.hypot(dx, dz) < 1.35) {
        redirecting = true;
        const colorHex = currentBlessing ? currentBlessing.hex : incoming.color;
        const speed = currentBlessing?.speed || incoming.speed || 5;
        Portal.sendPlayerThroughPortal(returnPortal.target, {
          username: incoming.username,
          color: colorHex,
          speed,
        });
      }
    }
  }

  // Pedestal orbs: bob, spin, pick up on proximity
  for (const p of pedestals) {
    p.userData.orb.position.y = 1.1 + Math.sin(t * 2 + p.userData.baseAngle * 3) * 0.1;
    p.userData.orb.rotation.y += dt * 0.55;
    const dx = player.position.x - p.position.x;
    const dz = player.position.z - p.position.z;
    if (Math.hypot(dx, dz) < 1.0) applyBlessing(p.userData.blessing);
  }

  // Petals
  for (const m of petals) {
    m.position.y += m.userData.vy * dt;
    m.position.x += m.userData.vx * dt;
    m.rotation.z += m.userData.spin * dt;
    if (m.position.y < 0.1) {
      m.position.y = 8 + Math.random() * 2;
      m.position.x = (Math.random() - 0.5) * 40;
      m.position.z = (Math.random() - 0.5) * 40;
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
