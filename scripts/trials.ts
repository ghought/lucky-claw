// Headless play-through: aims at real prizes and reports how the claw does.
import { Machine } from '../src/sim/machine';
import { BOX, CLAW, PHYSICS_HZ } from '../src/sim/config';

if (process.env.SLACK) CLAW.slackForce = Number(process.env.SLACK);

const trials = Number(process.argv[2] ?? 30);
const carry = process.argv[3] ? Number(process.argv[3]) : undefined;

async function play(seed: number, aimError: number) {
  const m = await Machine.create({ seed, fixedCarry: carry });
  m.addCredits(1);
  const stats = { lifted: false, topHeld: false, won: false, slips: 0, touched: false, maxSpeed: 0, rope: 0 };
  m.on((e) => {
    if (e.type === 'slip') stats.slips++;
    if (e.type === 'chute') stats.won = true;
    if (e.type === 'touch') stats.touched = true;
  });
  // Pick the highest prize that isn't jammed against a wall.
  const reachable = m.plushes
    .filter((p) => {
      const t = p.body.translation();
      return Math.abs(t.x) < CLAW.limit && Math.abs(t.z) < CLAW.limit;
    })
    .sort((a, b) => b.body.translation().y - a.body.translation().y);
  const target = reachable[0].body.translation();
  const ang = seed * 2.4;
  const tx = target.x + Math.cos(ang) * aimError;
  const tz = target.z + Math.sin(ang) * aimError;

  m.insertCoin();
  const t0 = performance.now();
  let ticks = 0;
  while (m.phase !== 'idle' && ticks < PHYSICS_HZ * 60) {
    if (m.phase === 'play') {
      const dx = tx - m.trolley.x;
      const dz = tz - m.trolley.z;
      const d = Math.hypot(dx, dz);
      const k = Math.min(1, d * 8);
      m.stick.x = d > 1e-4 ? (dx / d) * k : 0;
      m.stick.z = d > 1e-4 ? (dz / d) * k : 0;
      const settled = Math.hypot(m.swing.x, m.swing.z) < 0.002;
      if (d < 0.003 && settled) m.pressDrop();
    }
    m.tick();
    ticks++;
    if (m.phase === 'lift' && m.rope < CLAW.ropeHome + 0.15) stats.lifted ||= m.heldPlush() !== null;
    if (m.phase === 'return') stats.topHeld ||= m.heldPlush() !== null;
    if (m.phase === 'settle') stats.rope = m.rope;
    for (const f of m.fingers) {
      const v = f.body.linvel();
      stats.maxSpeed = Math.max(stats.maxSpeed, Math.hypot(v.x, v.y, v.z));
    }
  }
  for (let i = 0; i < PHYSICS_HZ * 2; i++) m.tick();
  const ms = (performance.now() - t0) / ticks;
  const escaped = m.plushes.filter((p) => {
    if (p.state !== 'bed') return false;
    const t = p.body.translation();
    return t.y < BOX.floorY - 0.2 || t.y > 2 || !Number.isFinite(t.x);
  }).length;
  return { ...stats, ms, escaped, ticks };
}

for (const err of [0, 0.015, 0.03, 0.06]) {
  let lifted = 0, top = 0, won = 0, slips = 0, ms = 0, touched = 0, escaped = 0, maxV = 0, rope = 0;
  for (let i = 0; i < trials; i++) {
    const r = await play(1000 + i * 7, err);
    lifted += +r.lifted; top += +r.topHeld; won += +r.won; slips += r.slips; ms += r.ms;
    touched += +r.touched; escaped += r.escaped; maxV = Math.max(maxV, r.maxSpeed); rope += r.rope;
  }
  console.log(
    `aim±${(err * 100).toFixed(1)}cm  touched ${touched}/${trials}  lifted ${lifted}  atTop ${top}  won ${won}  slips ${slips}` +
    `  escaped ${escaped}  fingerVmax ${maxV.toFixed(2)}  rope ${(rope / trials).toFixed(3)}  ${(ms / trials).toFixed(3)}ms/tick`,
  );
}
