import * as THREE from 'three';

const FONT = 'Bungee, "Arial Black", Impact, sans-serif';

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return { c, ctx };
}

function toTexture(c: HTMLCanvasElement, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Tileable strand map: R is strand height, G is per-strand tone. */
export function furTexture() {
  const size = 256;
  const cells = 52;
  const rand = rng(11);
  const px: number[] = [];
  const py: number[] = [];
  const ph: number[] = [];
  const pt: number[] = [];
  for (let i = 0; i < cells * cells; i++) {
    px.push(rand());
    py.push(rand());
    ph.push(0.45 + rand() * 0.55);
    pt.push(rand());
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * cells;
      const v = (y / size) * cells;
      const cu = Math.floor(u);
      const cv = Math.floor(v);
      let best = 9;
      let height = 0;
      let tone = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const gx = (cu + i + cells) % cells;
          const gy = (cv + j + cells) % cells;
          const id = gy * cells + gx;
          const dx = cu + i + px[id] - u;
          const dy = cv + j + py[id] - v;
          const d = dx * dx + dy * dy;
          if (d < best) {
            best = d;
            height = ph[id];
            tone = pt[id];
          }
        }
      }
      const falloff = Math.max(0, 1 - Math.sqrt(best) / 0.75);
      const o = (y * size + x) * 4;
      data[o] = Math.round(255 * falloff * height);
      data[o + 1] = Math.round(255 * tone);
      data[o + 2] = 0;
      data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** The loud neon-confetti carpet every arcade seems to buy. */
export function carpetTexture() {
  const s = 1024;
  const { c, ctx } = makeCanvas(s, s);
  ctx.fillStyle = '#0b0a1f';
  ctx.fillRect(0, 0, s, s);
  const rand = rng(5);
  for (let i = 0; i < 22000; i++) {
    ctx.fillStyle = `rgba(${40 + rand() * 40},${30 + rand() * 40},${80 + rand() * 80},0.25)`;
    ctx.fillRect(rand() * s, rand() * s, 2, 2);
  }
  const colors = ['#ff2e8b', '#26e0ff', '#ffd23f', '#7cff5b', '#9a5bff'];
  const drawAt = (fn: () => void, x: number, y: number, rot: number) => {
    for (const ox of [-s, 0, s]) {
      for (const oy of [-s, 0, s]) {
        ctx.save();
        ctx.translate(x + ox, y + oy);
        ctx.rotate(rot);
        fn();
        ctx.restore();
      }
    }
  };
  for (let i = 0; i < 95; i++) {
    const col = colors[Math.floor(rand() * colors.length)];
    const size = 16 + rand() * 30;
    const kind = Math.floor(rand() * 4);
    drawAt(
      () => {
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        if (kind === 0) {
          ctx.moveTo(-size, 0);
          ctx.bezierCurveTo(-size / 2, -size, size / 2, size, size, 0);
          ctx.stroke();
        } else if (kind === 1) {
          ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2);
          ctx.stroke();
        } else if (kind === 2) {
          ctx.moveTo(0, -size * 0.6);
          ctx.lineTo(size * 0.55, size * 0.4);
          ctx.lineTo(-size * 0.55, size * 0.4);
          ctx.closePath();
          ctx.stroke();
        } else {
          ctx.arc(0, 0, size * 0.18, 0, Math.PI * 2);
          ctx.fill();
        }
      },
      rand() * s,
      rand() * s,
      rand() * Math.PI * 2,
    );
  }
  const t = toTexture(c, true, true);
  t.repeat.set(5, 5);
  return t;
}

/** Pre-blurred arcade behind the machine: cheap depth of field. */
export function backdropTexture() {
  const w = 2048;
  const h = 512;
  const { c, ctx } = makeCanvas(w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#07060f');
  g.addColorStop(0.6, '#14102a');
  g.addColorStop(1, '#1d1636');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rand = rng(21);
  const hues = ['255,46,139', '38,224,255', '255,190,70', '150,90,255', '90,255,140', '255,90,70'];
  ctx.globalCompositeOperation = 'lighter';
  const blob = (x: number, y: number, rx: number, ry: number, col: string, a: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    const r = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    r.addColorStop(0, `rgba(${col},${a})`);
    r.addColorStop(0.55, `rgba(${col},${a * 0.45})`);
    r.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = r;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  // Distant cabinets: a glowing screen with a marquee over it.
  for (let i = 0; i < 16; i++) {
    const x = (i + 0.5) * (w / 16) + (rand() - 0.5) * 50;
    const col = hues[Math.floor(rand() * hues.length)];
    const col2 = hues[Math.floor(rand() * hues.length)];
    blob(x, h * 0.52, 42, 68, col, 0.5);
    blob(x, h * 0.3, 50, 18, col2, 0.75);
    blob(x, h * 0.72, 80, 26, col, 0.14);
  }
  // Bokeh discs from out-of-focus bulbs.
  for (let i = 0; i < 90; i++) {
    const col = hues[Math.floor(rand() * hues.length)];
    const r = 7 + rand() * 18;
    const x = rand() * w;
    const y = h * (0.12 + rand() * 0.55);
    blob(x, y, r, r, col, 0.1 + rand() * 0.2);
  }
  // Ceiling troffers.
  for (let i = 0; i < 9; i++) blob((i + 0.5) * (w / 9), h * 0.06, 120, 12, '255,235,210', 0.55);
  const t = toTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Printed panel behind the prizes. */
export function backPanelTexture() {
  const s = 1024;
  const { c, ctx } = makeCanvas(s, s);
  const g = ctx.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0, '#1b2fd6');
  g.addColorStop(0.55, '#7a2be0');
  g.addColorStop(1, '#ff3d9a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.save();
  ctx.translate(s / 2, s * 0.6);
  for (let i = 0; i < 24; i++) {
    ctx.rotate((Math.PI * 2) / 24);
    if (i % 2) continue;
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-90, -s);
    ctx.lineTo(90, -s);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  const rand = rng(8);
  for (let i = 0; i < 70; i++) {
    star(ctx, rand() * s, rand() * s * 0.75, 4 + rand() * 12, `rgba(255,240,180,${0.3 + rand() * 0.6})`);
  }
  ctx.textAlign = 'center';
  ctx.font = `150px ${FONT}`;
  ctx.fillStyle = '#fff3c4';
  ctx.shadowColor = '#ff2e8b';
  ctx.shadowBlur = 24;
  ctx.fillText('WIN', s / 2, s * 0.3);
  ctx.font = `76px ${FONT}`;
  ctx.fillText('A FRIEND!', s / 2, s * 0.4);
  return toTexture(c);
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.42 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

/** Quilted felt on the bed; mostly hidden under the prizes. */
export function bedTexture() {
  const s = 512;
  const { c, ctx } = makeCanvas(s, s);
  ctx.fillStyle = '#26114f';
  ctx.fillRect(0, 0, s, s);
  const rand = rng(3);
  for (let i = 0; i < 26000; i++) {
    ctx.fillStyle = `rgba(${90 + rand() * 80},${50 + rand() * 60},${160 + rand() * 90},0.16)`;
    ctx.fillRect(rand() * s, rand() * s, 1.5, 1.5);
  }
  for (let i = 0; i < 40; i++) star(ctx, rand() * s, rand() * s, 7 + rand() * 7, 'rgba(255,214,90,0.5)');
  return toTexture(c, true, true);
}

export function marqueeTexture() {
  const w = 1024;
  const h = 320;
  const { c, ctx } = makeCanvas(w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#ffcf3f');
  g.addColorStop(0.5, '#ff7a1a');
  g.addColorStop(1, '#e8123d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h * 1.05);
  for (let i = 0; i < 30; i++) {
    ctx.rotate(Math.PI / 15);
    if (i % 2) continue;
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-70, -900);
    ctx.lineTo(70, -900);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `148px ${FONT}`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 26;
  ctx.strokeStyle = '#5a0a2a';
  ctx.strokeText('LUCKY CLAW', w / 2, h * 0.47);
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText('LUCKY CLAW', w / 2, h * 0.47);
  ctx.fillStyle = '#ff1f6b';
  ctx.fillText('LUCKY CLAW', w / 2, h * 0.47);
  ctx.font = `34px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.fillText('★ EVERY PLAY A WINNER (ALMOST) ★', w / 2, h * 0.86);
  return toTexture(c);
}

/** Lower-cabinet livery with room for the prize door. */
export function frontPanelTexture() {
  const s = 1024;
  const { c, ctx } = makeCanvas(s, s);
  const g = ctx.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0, '#c9102a');
  g.addColorStop(1, '#7c0a22');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.save();
  ctx.translate(s * 0.25, s * 0.55);
  for (let i = 0; i < 26; i++) {
    ctx.rotate((Math.PI * 2) / 26);
    if (i % 2) continue;
    ctx.fillStyle = 'rgba(255,190,70,0.13)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-100, -1400);
    ctx.lineTo(100, -1400);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  const rand = rng(14);
  for (let i = 0; i < 26; i++) star(ctx, rand() * s, rand() * s, 6 + rand() * 12, 'rgba(255,225,130,0.55)');
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(0, s * 0.92, s, 18);
  ctx.fillStyle = '#fff3d0';
  ctx.fillRect(0, s * 0.945, s, 7);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe9a8';
  ctx.font = `58px ${FONT}`;
  ctx.fillText('PRIZES', s * 0.23, s * 0.19);
  return toTexture(c);
}

export function sidePanelTexture() {
  const s = 1024;
  const { c, ctx } = makeCanvas(s, s);
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, '#c9102a');
  g.addColorStop(1, '#6e0a20');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(0, s * 0.8, s, 16);
  ctx.fillStyle = '#fff3d0';
  ctx.fillRect(0, s * 0.83, s, 7);
  const rand = rng(31);
  for (let i = 0; i < 18; i++) star(ctx, rand() * s, rand() * s * 0.75, 8 + rand() * 18, 'rgba(255,225,130,0.5)');
  return toTexture(c);
}

/** Silk-screened control deck. */
export function deckTexture() {
  const w = 1024;
  const h = 300;
  const { c, ctx } = makeCanvas(w, h);
  ctx.fillStyle = '#17171d';
  ctx.fillRect(0, 0, w, h);
  const rand = rng(77);
  for (let i = 0; i < 30000; i++) {
    const v = 30 + rand() * 30;
    ctx.fillStyle = `rgba(${v},${v},${v + 5},0.4)`;
    ctx.fillRect(rand() * w, rand() * h, 1.2, 1.2);
  }
  ctx.strokeStyle = '#ffd23f';
  ctx.lineWidth = 6;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  ctx.fillStyle = '#ffd23f';
  ctx.textAlign = 'center';
  ctx.font = `30px ${FONT}`;
  ctx.fillText('MOVE', 215, h - 34);
  ctx.fillText('DROP', w - 212, h - 34);
  // Joystick direction arrows.
  ctx.save();
  ctx.translate(215, h / 2 - 8);
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -100);
    ctx.lineTo(16, -80);
    ctx.lineTo(-16, -80);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  return toTexture(c);
}

export interface Display {
  texture: THREE.CanvasTexture;
  draw(text: string): void;
}

const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
  '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
  '-': 'g', ' ': '',
  C: 'afed', O: 'abcdef', I: 'bc', N: 'ceg', P: 'abefg', L: 'fed', A: 'abcefg',
  Y: 'fgbcd', G: 'afedc', W: 'cdeb', E: 'afged', S: 'afgcd', U: 'fedcb',
};

/** Red seven-segment readout with the dim ghost segments real ones show. */
export function makeDisplay(digits = 6): Display {
  const dw = 60;
  const h = 112;
  const { c, ctx } = makeCanvas(dw * digits + 20, h);
  const texture = toTexture(c);
  const seg = (x: number, y: number, id: string, on: boolean) => {
    const L = 34;
    const T = 7;
    const spots: Record<string, [number, number, boolean]> = {
      a: [x + 6, y, true], g: [x + 6, y + L + 3, true], d: [x + 6, y + 2 * L + 6, true],
      f: [x, y + 4, false], b: [x + L + 8, y + 4, false], e: [x, y + L + 7, false], c: [x + L + 8, y + L + 7, false],
    };
    const [sx, sy, horiz] = spots[id];
    ctx.fillStyle = on ? '#ff3020' : '#2a0a08';
    ctx.beginPath();
    if (horiz) {
      ctx.moveTo(sx, sy + T / 2);
      ctx.lineTo(sx + T / 2, sy);
      ctx.lineTo(sx + L - T / 2, sy);
      ctx.lineTo(sx + L, sy + T / 2);
      ctx.lineTo(sx + L - T / 2, sy + T);
      ctx.lineTo(sx + T / 2, sy + T);
    } else {
      ctx.moveTo(sx + T / 2, sy);
      ctx.lineTo(sx + T, sy + T / 2);
      ctx.lineTo(sx + T, sy + L - T / 2);
      ctx.lineTo(sx + T / 2, sy + L);
      ctx.lineTo(sx, sy + L - T / 2);
      ctx.lineTo(sx, sy + T / 2);
    }
    ctx.closePath();
    ctx.fill();
  };
  return {
    texture,
    draw(text: string) {
      ctx.fillStyle = '#0a0303';
      ctx.fillRect(0, 0, c.width, c.height);
      const padded = text.toUpperCase().padStart(digits, ' ').slice(-digits);
      for (let i = 0; i < digits; i++) {
        const lit = SEGMENTS[padded[i]] ?? '';
        for (const id of 'abcdefg') seg(14 + i * dw, 15, id, lit.includes(id));
      }
      texture.needsUpdate = true;
    },
  };
}

/** Faint smears so the glass reads as glass rather than nothing. */
export function smudgeTexture() {
  const s = 512;
  const { c, ctx } = makeCanvas(s, s);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, s, s);
  const rand = rng(44);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 70; i++) {
    const x = rand() * s;
    const y = rand() * s;
    const r = 18 + rand() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.04 + rand() * 0.1})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return toTexture(c, false, true);
}

export function radialGlowTexture() {
  const s = 256;
  const { c, ctx } = makeCanvas(s, s);
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return toTexture(c);
}
