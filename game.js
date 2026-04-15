// Minimal top-down game that demonstrates the portal protocol end-to-end.
// Rip this apart, replace with your own game — just keep the Portal.* calls.

(async () => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  const incoming = Portal.readPortalParams();
  document.getElementById('username').textContent = incoming.username;

  const nextTarget = await Portal.pickPortalTarget();

  const player = {
    x: W / 2,
    y: H / 2,
    r: 16,
    speed: incoming.speed || 5,
    color: '#' + incoming.color,
  };

  const exitPortal = {
    x: W - 120,
    y: H / 2,
    r: 44,
    color: '#c64bff',
    label: nextTarget ? `→ ${nextTarget.title}` : 'no destinations yet',
    target: nextTarget?.url || null,
    pulse: 0,
  };

  const returnPortal = incoming.ref ? {
    x: 120,
    y: H / 2,
    r: 44,
    color: '#4ff0ff',
    label: '← back',
    target: incoming.ref,
    pulse: 0,
  } : null;

  if (incoming.fromPortal && returnPortal) {
    player.x = returnPortal.x + returnPortal.r + 30;
    player.y = returnPortal.y;
  }

  const stars = Array.from({ length: 80 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    s: Math.random() * 1.5 + 0.3,
    t: Math.random() * Math.PI * 2,
  }));

  const keys = {};
  addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
  addEventListener('keyup',   e => { keys[e.key.toLowerCase()] = false; });

  let redirecting = false;

  function attemptPortal(portal) {
    if (redirecting || !portal || !portal.target) return;
    const dx = player.x - portal.x;
    const dy = player.y - portal.y;
    if (Math.hypot(dx, dy) < portal.r + player.r - 4) {
      redirecting = true;
      Portal.sendPlayerThroughPortal(portal.target, {
        username: incoming.username,
        color: incoming.color,
        speed: player.speed,
      });
    }
  }

  function update(dt) {
    const v = player.speed;
    if (keys['w'] || keys['arrowup'])    player.y -= v;
    if (keys['s'] || keys['arrowdown'])  player.y += v;
    if (keys['a'] || keys['arrowleft'])  player.x -= v;
    if (keys['d'] || keys['arrowright']) player.x += v;
    player.x = Math.max(player.r, Math.min(W - player.r, player.x));
    player.y = Math.max(player.r, Math.min(H - player.r, player.y));

    exitPortal.pulse += dt * 3;
    if (returnPortal) returnPortal.pulse += dt * 3;

    attemptPortal(exitPortal);
    if (returnPortal) attemptPortal(returnPortal);
  }

  function drawStars(t) {
    for (const s of stars) {
      const a = 0.5 + 0.5 * Math.sin(t * 2 + s.t);
      ctx.fillStyle = `rgba(255,255,255,${a * 0.8})`;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
  }

  function drawPortal(p) {
    const glow = 18 + Math.sin(p.pulse) * 6;
    ctx.save();
    ctx.shadowColor = p.color;
    ctx.shadowBlur = glow;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r - 10 + Math.sin(p.pulse) * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#fff';
    ctx.font = '600 14px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.label, p.x, p.y - p.r - 12);
  }

  function drawPlayer() {
    ctx.save();
    ctx.shadowColor = player.color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function render(t) {
    ctx.fillStyle = '#120826';
    ctx.fillRect(0, 0, W, H);
    drawStars(t);
    drawPortal(exitPortal);
    if (returnPortal) drawPortal(returnPortal);
    drawPlayer();
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render(now / 1000);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
