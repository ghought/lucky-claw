import * as THREE from 'three';
import type { Machine, Plush } from '../sim/machine';
import type { SpeciesId, Vec3 } from '../sim/species';
import type { Quality } from './stage';
import { furTexture } from './textures';

const BONE = { root: 0, armR: 1, armL: 2, legR: 3, legL: 4, earR: 5, earL: 6 } as const;
const BONE_COUNT = 7;

interface LimbSpec {
  pivot: Vec3;
  /** Direction the limb points at rest; gravity swings it away from this. */
  dir: Vec3;
  loose: number;
}

interface Palette {
  main: string;
  belly: string;
  accent: string;
}

interface Part {
  c: Vec3;
  r: Vec3;
  color: string;
  bone?: number;
  rot?: Vec3;
  taper?: number;
  seg?: [number, number];
}

class GeoBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  skinI: number[] = [];
  skinW: number[] = [];
  idx: number[] = [];

  ellipsoid(p: Part) {
    const [ws, hs] = p.seg ?? [28, 20];
    const base = this.pos.length / 3;
    const color = new THREE.Color(p.color);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0])));
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let j = 0; j <= hs; j++) {
      const phi = (j / hs) * Math.PI;
      for (let i = 0; i <= ws; i++) {
        const th = (i / ws) * Math.PI * 2;
        const ux = Math.sin(phi) * Math.cos(th);
        const uy = Math.cos(phi);
        const uz = Math.sin(phi) * Math.sin(th);
        const taper = 1 - (p.taper ?? 0) * (0.5 + 0.5 * uy);
        // Stuffing is never perfectly round.
        const lump = 1 + 0.018 * Math.sin(ux * 5.1 + uz * 3.7) * Math.cos(uy * 4.3);
        v.set(ux * p.r[0] * taper * lump, uy * p.r[1] * lump, uz * p.r[2] * taper * lump).applyQuaternion(q);
        n.set(ux / p.r[0], uy / p.r[1], uz / p.r[2]).normalize().applyQuaternion(q);
        this.pos.push(v.x + p.c[0], v.y + p.c[1], v.z + p.c[2]);
        this.nrm.push(n.x, n.y, n.z);
        // Cheap baked occlusion: undersides sit darker.
        const shade = 0.82 + 0.18 * THREE.MathUtils.smoothstep(n.y, -0.9, 0.3);
        this.col.push(color.r * shade, color.g * shade, color.b * shade);
        this.skinI.push(p.bone ?? 0, 0, 0, 0);
        this.skinW.push(1, 0, 0, 0);
      }
    }
    for (let j = 0; j < hs; j++) {
      for (let i = 0; i < ws; i++) {
        const a = base + j * (ws + 1) + i;
        const b = a + ws + 1;
        this.idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }

  tube(points: Vec3[], radius: number, color: string) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    const g = new THREE.TubeGeometry(curve, 16, radius, 6, false);
    const c = new THREE.Color(color);
    const base = this.pos.length / 3;
    const pos = g.attributes.position;
    const nrm = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      this.pos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      this.nrm.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      this.col.push(c.r, c.g, c.b);
      this.skinI.push(0, 0, 0, 0);
      this.skinW.push(1, 0, 0, 0);
    }
    const index = g.index;
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    g.dispose();
  }

  build(skinned: boolean) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (skinned) {
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinI, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinW, 4));
    }
    g.setIndex(this.idx);
    return g;
  }
}

interface Design {
  fur: GeoBuilder;
  trim: GeoBuilder;
  limbs: Partial<Record<number, LimbSpec>>;
  longFur: boolean;
}

const EYE = '#08080b';
const STITCH = '#1a1214';

function eyes(trim: GeoBuilder, x: number, y: number, z: number, r: number) {
  for (const s of [-1, 1]) trim.ellipsoid({ c: [s * x, y, z], r: [r, r, r * 0.62], color: EYE, seg: [16, 12] });
}

function smile(trim: GeoBuilder, y: number, z: number, w: number, color = STITCH) {
  trim.tube([[-w, y + 0.003, z - 0.004], [-w * 0.45, y - 0.002, z], [0, y, z + 0.001]], 0.0011, color);
  trim.tube([[w, y + 0.003, z - 0.004], [w * 0.45, y - 0.002, z], [0, y, z + 0.001]], 0.0011, color);
}

function nameTag(trim: GeoBuilder) {
  trim.ellipsoid({ c: [0.052, -0.04, -0.034], r: [0.002, 0.016, 0.011], color: '#f4f0e6', seg: [6, 6] });
}

function bipedLimbs(d: Design, main: string, pad: string, s = 1) {
  const f = d.fur;
  for (const k of [1, -1]) {
    f.ellipsoid({
      c: [k * 0.066 * s, 0.014 * s, 0.012 * s],
      r: [0.021 * s, 0.034 * s, 0.021 * s],
      color: main,
      bone: k > 0 ? BONE.armR : BONE.armL,
      rot: [0, 0, k * 0.8],
      seg: [16, 12],
    });
    f.ellipsoid({
      c: [k * 0.037 * s, -0.064 * s, 0.03 * s],
      r: [0.025 * s, 0.024 * s, 0.038 * s],
      color: main,
      bone: k > 0 ? BONE.legR : BONE.legL,
      seg: [16, 12],
    });
    f.ellipsoid({
      c: [k * 0.037 * s, -0.064 * s, 0.062 * s],
      r: [0.017 * s, 0.017 * s, 0.009 * s],
      color: pad,
      bone: k > 0 ? BONE.legR : BONE.legL,
      seg: [12, 8],
    });
  }
  d.limbs[BONE.armR] = { pivot: [0.052 * s, 0.03 * s, 0.01 * s], dir: [1, -0.7, 0], loose: 0.7 };
  d.limbs[BONE.armL] = { pivot: [-0.052 * s, 0.03 * s, 0.01 * s], dir: [-1, -0.7, 0], loose: 0.7 };
  d.limbs[BONE.legR] = { pivot: [0.035 * s, -0.05 * s, 0.012 * s], dir: [0.1, -0.3, 1], loose: 0.55 };
  d.limbs[BONE.legL] = { pivot: [-0.035 * s, -0.05 * s, 0.012 * s], dir: [-0.1, -0.3, 1], loose: 0.55 };
}

const DESIGNS: Record<SpeciesId, { palettes: Palette[]; make(d: Design, p: Palette): void }> = {
  bear: {
    palettes: [
      { main: '#a4693a', belly: '#e6c79c', accent: '#2a1a12' },
      { main: '#e5cfa6', belly: '#fff3dc', accent: '#3a2a20' },
      { main: '#6d4426', belly: '#c79a6a', accent: '#1d120c' },
    ],
    make(d, p) {
      const { fur, trim } = d;
      fur.ellipsoid({ c: [0, -0.008, 0], r: [0.059, 0.066, 0.054], color: p.main });
      fur.ellipsoid({ c: [0, -0.012, 0.03], r: [0.04, 0.046, 0.029], color: p.belly });
      fur.ellipsoid({ c: [0, 0.082, 0.006], r: [0.062, 0.055, 0.055], color: p.main });
      fur.ellipsoid({ c: [0, 0.068, 0.05], r: [0.029, 0.022, 0.018], color: p.belly });
      for (const k of [1, -1]) {
        fur.ellipsoid({ c: [k * 0.046, 0.129, 0], r: [0.021, 0.021, 0.011], color: p.main, seg: [14, 10] });
        fur.ellipsoid({ c: [k * 0.046, 0.128, 0.008], r: [0.013, 0.013, 0.006], color: p.belly, seg: [12, 8] });
      }
      bipedLimbs(d, p.main, p.belly);
      eyes(trim, 0.024, 0.095, 0.054, 0.0072);
      trim.ellipsoid({ c: [0, 0.077, 0.068], r: [0.0105, 0.0075, 0.005], color: p.accent, seg: [14, 10] });
      trim.tube([[0, 0.07, 0.068], [0, 0.061, 0.067]], 0.0011, STITCH);
      smile(trim, 0.059, 0.066, 0.012);
      nameTag(trim);
    },
  },
  bunny: {
    palettes: [
      { main: '#f3ece4', belly: '#ffd4e0', accent: '#f08aa8' },
      { main: '#b9b4c4', belly: '#f4e6f0', accent: '#e58aa8' },
      { main: '#ffc2d8', belly: '#fff0f4', accent: '#e05a86' },
    ],
    make(d, p) {
      const { fur, trim } = d;
      const s = 0.96;
      fur.ellipsoid({ c: [0, -0.008 * s, 0], r: [0.056, 0.064, 0.052], color: p.main });
      fur.ellipsoid({ c: [0, -0.012, 0.03], r: [0.036, 0.042, 0.026], color: p.belly });
      fur.ellipsoid({ c: [0, 0.08, 0.006], r: [0.058, 0.052, 0.052], color: p.main });
      fur.ellipsoid({ c: [0, -0.02, -0.056], r: [0.02, 0.02, 0.02], color: '#ffffff', seg: [14, 10] });
      for (const k of [1, -1]) {
        const bone = k > 0 ? BONE.earR : BONE.earL;
        fur.ellipsoid({ c: [k * 0.026, 0.168, -0.004], r: [0.019, 0.058, 0.011], color: p.main, bone, rot: [0, 0, -k * 0.13], taper: 0.28 });
        fur.ellipsoid({ c: [k * 0.026, 0.165, 0.005], r: [0.011, 0.046, 0.006], color: p.belly, bone, rot: [0, 0, -k * 0.13], taper: 0.28, seg: [12, 10] });
      }
      d.limbs[BONE.earR] = { pivot: [0.02, 0.122, -0.004], dir: [0.05, 1, 0], loose: 0.6 };
      d.limbs[BONE.earL] = { pivot: [-0.02, 0.122, -0.004], dir: [-0.05, 1, 0], loose: 0.6 };
      bipedLimbs(d, p.main, p.belly, s);
      eyes(trim, 0.025, 0.09, 0.052, 0.0068);
      trim.ellipsoid({ c: [0, 0.073, 0.0585], r: [0.0062, 0.0046, 0.0035], color: p.accent, seg: [12, 8] });
      smile(trim, 0.062, 0.056, 0.009);
      nameTag(trim);
    },
  },
  cat: {
    palettes: [
      { main: '#f09a3e', belly: '#fff0d8', accent: '#e8748a' },
      { main: '#54565f', belly: '#e9e7e3', accent: '#e8848f' },
      { main: '#f3efe8', belly: '#ffffff', accent: '#f09aae' },
    ],
    make(d, p) {
      const { fur, trim } = d;
      fur.ellipsoid({ c: [0, -0.008, 0], r: [0.056, 0.063, 0.052], color: p.main });
      fur.ellipsoid({ c: [0, -0.012, 0.03], r: [0.036, 0.042, 0.026], color: p.belly });
      fur.ellipsoid({ c: [0, 0.08, 0.006], r: [0.062, 0.054, 0.053], color: p.main });
      fur.ellipsoid({ c: [0, 0.066, 0.045], r: [0.026, 0.017, 0.016], color: p.belly });
      for (const k of [1, -1]) {
        fur.ellipsoid({ c: [k * 0.04, 0.13, 0], r: [0.021, 0.03, 0.011], color: p.main, rot: [0, 0, -k * 0.3], taper: 0.85, seg: [14, 10] });
        fur.ellipsoid({ c: [k * 0.04, 0.127, 0.0065], r: [0.012, 0.018, 0.005], color: p.accent, rot: [0, 0, -k * 0.3], taper: 0.85, seg: [12, 8] });
      }
      // Tail curled round the hip.
      for (let i = 0; i < 6; i++) {
        const a = i / 5;
        fur.ellipsoid({ c: [0.012 + a * 0.05, -0.05 + a * a * 0.05, -0.052 - Math.sin(a * 3) * 0.018], r: [0.014, 0.014, 0.014], color: p.main, seg: [10, 8] });
      }
      bipedLimbs(d, p.main, p.belly, 0.97);
      eyes(trim, 0.026, 0.09, 0.052, 0.0078);
      trim.ellipsoid({ c: [0, 0.072, 0.0605], r: [0.0052, 0.0038, 0.003], color: p.accent, seg: [12, 8] });
      smile(trim, 0.062, 0.0585, 0.01);
      for (const k of [1, -1]) {
        for (const yy of [0.002, -0.005]) {
          trim.tube([[k * 0.022, 0.069 + yy, 0.054], [k * 0.05, 0.072 + yy * 3, 0.05], [k * 0.076, 0.076 + yy * 4, 0.04]], 0.0005, '#f6f2ea');
        }
      }
      nameTag(trim);
    },
  },
  penguin: {
    palettes: [
      { main: '#20242e', belly: '#f4f4f0', accent: '#f39a1e' },
      { main: '#2a4a7c', belly: '#f4f4f0', accent: '#f3b01e' },
      { main: '#6a7078', belly: '#ffffff', accent: '#f39a1e' },
    ],
    make(d, p) {
      const { fur, trim } = d;
      fur.ellipsoid({ c: [0, -0.02, 0], r: [0.068, 0.07, 0.064], color: p.main });
      fur.ellipsoid({ c: [0, 0.062, 0.002], r: [0.055, 0.052, 0.054], color: p.main });
      fur.ellipsoid({ c: [0, -0.022, 0.034], r: [0.05, 0.056, 0.034], color: p.belly });
      fur.ellipsoid({ c: [0.016, 0.066, 0.04], r: [0.018, 0.02, 0.016], color: p.belly, seg: [14, 10] });
      fur.ellipsoid({ c: [-0.016, 0.066, 0.04], r: [0.018, 0.02, 0.016], color: p.belly, seg: [14, 10] });
      for (const k of [1, -1]) {
        const bone = k > 0 ? BONE.armR : BONE.armL;
        fur.ellipsoid({ c: [k * 0.074, -0.012, 0.002], r: [0.012, 0.044, 0.024], color: p.main, bone, rot: [0, 0, k * 0.36], seg: [14, 10] });
        trim.ellipsoid({ c: [k * 0.03, -0.086, 0.046], r: [0.022, 0.007, 0.027], color: p.accent, seg: [14, 8] });
      }
      d.limbs[BONE.armR] = { pivot: [0.058, 0.026, 0], dir: [0.4, -1, 0], loose: 0.8 };
      d.limbs[BONE.armL] = { pivot: [-0.058, 0.026, 0], dir: [-0.4, -1, 0], loose: 0.8 };
      eyes(trim, 0.019, 0.074, 0.05, 0.0062);
      trim.ellipsoid({ c: [0, 0.058, 0.058], r: [0.012, 0.0065, 0.013], color: p.accent, seg: [14, 8], taper: 0.15 });
      nameTag(trim);
    },
  },
  frog: {
    palettes: [
      { main: '#5fb534', belly: '#e9f2b2', accent: '#e9456a' },
      { main: '#1fa58a', belly: '#d8f4dc', accent: '#ffb040' },
      { main: '#a3cc32', belly: '#fbf6c0', accent: '#e9456a' },
    ],
    make(d, p) {
      const { fur, trim } = d;
      fur.ellipsoid({ c: [0, -0.012, 0], r: [0.062, 0.062, 0.056], color: p.main });
      fur.ellipsoid({ c: [0, -0.016, 0.032], r: [0.044, 0.046, 0.03], color: p.belly });
      fur.ellipsoid({ c: [0, 0.066, 0.012], r: [0.07, 0.046, 0.054], color: p.main });
      for (const k of [1, -1]) {
        fur.ellipsoid({ c: [k * 0.032, 0.112, 0.022], r: [0.025, 0.025, 0.024], color: p.main, seg: [18, 14] });
        fur.ellipsoid({ c: [k * 0.05, 0.05, 0.052], r: [0.011, 0.008, 0.005], color: p.accent, seg: [12, 8] });
        trim.ellipsoid({ c: [k * 0.032, 0.116, 0.039], r: [0.0138, 0.0138, 0.0105], color: '#f7f4e8', seg: [16, 12] });
        trim.ellipsoid({ c: [k * 0.032, 0.116, 0.0482], r: [0.0072, 0.0072, 0.0042], color: EYE, seg: [12, 10] });
      }
      trim.tube([[-0.044, 0.056, 0.05], [-0.024, 0.041, 0.063], [0, 0.038, 0.067], [0.024, 0.041, 0.063], [0.044, 0.056, 0.05]], 0.0014, '#203a1a');
      bipedLimbs(d, p.main, p.belly);
      nameTag(trim);
    },
  },
  pig: {
    palettes: [
      { main: '#f7a9b8', belly: '#ffd9e0', accent: '#d9607f' },
      { main: '#f2c9b0', belly: '#ffe9dc', accent: '#c9704f' },
      { main: '#ee86a4', belly: '#fcc2d0', accent: '#b83f64' },
    ],
    make(d, p) {
      const { fur, trim } = d;
      fur.ellipsoid({ c: [0, -0.012, 0], r: [0.066, 0.066, 0.06], color: p.main });
      fur.ellipsoid({ c: [0, 0.074, 0.01], r: [0.06, 0.054, 0.056], color: p.main });
      fur.ellipsoid({ c: [0, 0.066, 0.064], r: [0.024, 0.018, 0.012], color: p.belly, seg: [16, 12] });
      for (const k of [1, -1]) {
        fur.ellipsoid({ c: [k * 0.044, 0.122, 0.006], r: [0.02, 0.026, 0.008], color: p.main, rot: [0.5, 0, -k * 0.5], taper: 0.7, seg: [14, 10] });
        trim.ellipsoid({ c: [k * 0.0085, 0.066, 0.0758], r: [0.0038, 0.0052, 0.0022], color: p.accent, seg: [10, 8] });
      }
      trim.tube([[0.0, -0.01, -0.06], [0.01, 0.006, -0.073], [-0.008, 0.01, -0.078], [-0.006, -0.004, -0.076], [0.008, 0.0, -0.082]], 0.0028, p.accent);
      bipedLimbs(d, p.main, p.accent);
      eyes(trim, 0.03, 0.088, 0.054, 0.0062);
      smile(trim, 0.048, 0.062, 0.012);
      nameTag(trim);
    },
  },
  chick: {
    palettes: [
      { main: '#ffd338', belly: '#fff0a8', accent: '#f58b1f' },
      { main: '#fff0b8', belly: '#ffffff', accent: '#f58b1f' },
      { main: '#ffb338', belly: '#ffe4a0', accent: '#e8591a' },
    ],
    make(d, p) {
      const { fur, trim } = d;
      fur.ellipsoid({ c: [0, -0.016, 0], r: [0.071, 0.07, 0.066], color: p.main });
      fur.ellipsoid({ c: [0, 0.058, 0.004], r: [0.056, 0.052, 0.054], color: p.main });
      fur.ellipsoid({ c: [0, -0.02, 0.036], r: [0.046, 0.05, 0.032], color: p.belly });
      for (const k of [1, -1]) {
        const bone = k > 0 ? BONE.armR : BONE.armL;
        fur.ellipsoid({ c: [k * 0.074, 0.002, 0], r: [0.013, 0.032, 0.024], color: p.main, bone, rot: [0, 0, k * 0.5], seg: [14, 10] });
        trim.ellipsoid({ c: [k * 0.028, -0.082, 0.04], r: [0.016, 0.006, 0.022], color: p.accent, seg: [12, 8] });
      }
      d.limbs[BONE.armR] = { pivot: [0.06, 0.024, 0], dir: [0.6, -1, 0], loose: 0.75 };
      d.limbs[BONE.armL] = { pivot: [-0.06, 0.024, 0], dir: [-0.6, -1, 0], loose: 0.75 };
      for (let i = -1; i <= 1; i++) {
        fur.ellipsoid({ c: [i * 0.008, 0.116, -0.002], r: [0.006, 0.016, 0.006], color: p.main, rot: [0, 0, -i * 0.5], seg: [10, 8] });
      }
      eyes(trim, 0.023, 0.07, 0.052, 0.0066);
      trim.ellipsoid({ c: [0, 0.056, 0.0605], r: [0.0115, 0.0058, 0.0095], color: p.accent, seg: [14, 8] });
      nameTag(trim);
    },
  },
  monster: {
    palettes: [
      { main: '#6a3ee0', belly: '#b9a0ff', accent: '#ffd23f' },
      { main: '#12b5c9', belly: '#a8f0f4', accent: '#ff5a8a' },
      { main: '#e8386e', belly: '#ffb0c6', accent: '#7cff5b' },
    ],
    make(d, p) {
      const { fur, trim } = d;
      d.longFur = true;
      fur.ellipsoid({ c: [0, 0.012, 0], r: [0.08, 0.08, 0.076], color: p.main });
      fur.ellipsoid({ c: [0, -0.024, 0.052], r: [0.044, 0.038, 0.026], color: p.belly });
      bipedLimbs(d, p.main, p.belly, 1.02);
      for (const k of [1, -1]) {
        trim.ellipsoid({ c: [k * 0.05, 0.098, 0], r: [0.012, 0.022, 0.012], color: p.accent, rot: [0, 0, -k * 0.4], taper: 0.75, seg: [12, 10] });
        trim.ellipsoid({ c: [k * 0.029, 0.04, 0.069], r: [0.0185, 0.0185, 0.0125], color: '#f7f4e8', seg: [18, 14] });
        trim.ellipsoid({ c: [k * 0.027, 0.039, 0.081], r: [0.0092, 0.0092, 0.0045], color: EYE, seg: [12, 10] });
      }
      trim.tube([[-0.034, 0.0, 0.07], [-0.016, -0.012, 0.079], [0.016, -0.012, 0.079], [0.034, 0.0, 0.07]], 0.0016, STITCH);
      for (const k of [1, -1]) {
        trim.ellipsoid({ c: [k * 0.012, -0.014, 0.0795], r: [0.0052, 0.0072, 0.002], color: '#fbfaf2', seg: [8, 8] });
      }
      nameTag(trim);
    },
  },
};

interface BuiltDesign {
  base: THREE.BufferGeometry;
  shell: THREE.InstancedBufferGeometry;
  trim: THREE.BufferGeometry;
  limbs: Partial<Record<number, LimbSpec>>;
  longFur: boolean;
}

const cache = new Map<string, BuiltDesign>();

function getDesign(species: SpeciesId, variant: number, shells: number): BuiltDesign {
  const key = `${species}:${variant}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const def = DESIGNS[species];
  const d: Design = { fur: new GeoBuilder(), trim: new GeoBuilder(), limbs: {}, longFur: false };
  def.make(d, def.palettes[variant % def.palettes.length]);
  const base = d.fur.build(true);
  const shell = new THREE.InstancedBufferGeometry();
  shell.index = base.index;
  for (const name of Object.keys(base.attributes)) shell.setAttribute(name, base.attributes[name]);
  shell.instanceCount = shells;
  const built = { base, shell, trim: d.trim.build(false), limbs: d.limbs, longFur: d.longFur };
  cache.set(key, built);
  return built;
}

function furMaterial(tex: THREE.Texture, shells: number, length: number, mobile: boolean) {
  const params = { vertexColors: true, roughness: 0.95, metalness: 0 };
  const m = mobile
    ? new THREE.MeshStandardMaterial(params)
    : new THREE.MeshPhysicalMaterial({ ...params, sheen: 1, sheenRoughness: 0.55, sheenColor: new THREE.Color(0.75, 0.75, 0.75) });
  m.onBeforeCompile = (s) => {
    s.uniforms.uFur = { value: tex };
    s.uniforms.uFurLen = { value: length };
    s.uniforms.uShells = { value: shells };
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uFurLen;
         uniform float uShells;
         varying vec3 vFurPos;
         varying vec3 vFurNrm;
         varying float vShell;`,
      )
      .replace(
        '#include <skinning_vertex>',
        `#include <skinning_vertex>
         vShell = (float(gl_InstanceID) + 1.0) / uShells;
         vFurPos = position;
         vFurNrm = normal;
         transformed += normalize(objectNormal) * uFurLen * vShell;
         transformed.y -= uFurLen * 0.35 * vShell * vShell;`,
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uFur;
         varying vec3 vFurPos;
         varying vec3 vFurNrm;
         varying float vShell;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         vec3 fa = abs(normalize(vFurNrm));
         vec2 fuv = fa.x > fa.y && fa.x > fa.z ? vFurPos.yz : (fa.y > fa.z ? vFurPos.xz : vFurPos.xy);
         vec4 strand = texture2D(uFur, fuv * 16.0);
         vec4 clump = texture2D(uFur, fuv * 3.1 + 0.37);
         float height = strand.r * (0.72 + 0.56 * clump.g);
         if (height < vShell * 0.92 + 0.03) discard;
         diffuseColor.rgb *= mix(${mobile ? '0.8' : '0.56'}, 1.12, vShell) * (0.9 + 0.2 * strand.g);`,
      );
  };
  m.customProgramCacheKey = () => `fur-${mobile}-${length}`;
  return m;
}

interface LimbState {
  bone: THREE.Bone;
  dir: THREE.Vector3;
  loose: number;
  rest: THREE.Vector3;
  tilt: THREE.Vector3;
  vel: THREE.Vector3;
}

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

/** Builds the skinned body, fur shells and trim into a group; returns the bones. */
function assemble(
  group: THREE.Group,
  design: BuiltDesign,
  baseMat: THREE.Material,
  shellMats: [THREE.Material, THREE.Material],
  trimMat: THREE.Material,
) {
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < BONE_COUNT; i++) bones.push(new THREE.Bone());
  for (let i = 1; i < BONE_COUNT; i++) {
    bones[0].add(bones[i]);
    const spec = design.limbs[i];
    if (spec) bones[i].position.set(...spec.pivot);
  }
  const base = new THREE.SkinnedMesh(design.base, baseMat);
  const shell = new THREE.SkinnedMesh(design.shell, shellMats[design.longFur ? 1 : 0]);
  base.add(bones[0]);
  const skeleton = new THREE.Skeleton(bones);
  base.bind(skeleton);
  shell.bind(skeleton, base.bindMatrix);
  base.castShadow = true;
  base.receiveShadow = true;
  shell.receiveShadow = true;
  base.frustumCulled = false;
  shell.frustumCulled = false;
  const trim = new THREE.Mesh(design.trim, trimMat);
  trim.castShadow = true;
  trim.receiveShadow = true;
  group.add(base, shell, trim);
  return bones;
}

class PlushView {
  readonly group = new THREE.Group();
  private limbs: LimbState[] = [];
  private lastVel = new THREE.Vector3();
  private calm = 0;

  constructor(readonly plush: Plush, baseMat: THREE.Material, shellMats: [THREE.Material, THREE.Material], trimMat: THREE.Material, shells: number) {
    const design = getDesign(plush.species, plush.seed % 3, shells);
    const bones = assemble(this.group, design, baseMat, shellMats, trimMat);

    for (let i = 1; i < BONE_COUNT; i++) {
      const spec = design.limbs[i];
      if (!spec) continue;
      const dir = new THREE.Vector3(...spec.dir).normalize();
      this.limbs.push({
        bone: bones[i],
        dir,
        loose: spec.loose,
        rest: dir.clone().cross(DOWN),
        tilt: new THREE.Vector3(),
        vel: new THREE.Vector3(),
      });
    }
  }

  update(dt: number) {
    const body = this.plush.body;
    const t = body.translation();
    const r = body.rotation();
    this.group.position.set(t.x, t.y, t.z);
    this.group.quaternion.set(r.x, r.y, r.z, r.w);

    const lv = body.linvel();
    v1.set(lv.x, lv.y, lv.z);
    const accel = v2.copy(v1).sub(this.lastVel).divideScalar(Math.max(dt, 1e-3));
    this.lastVel.copy(v1);
    // Skip limb maths for prizes that are at rest and already settled.
    if (body.isSleeping() && this.calm > 2) return;
    this.calm = body.isSleeping() ? this.calm + dt : 0;

    // Limbs are spring-limp: they hang toward gravity and lag behind the body.
    q1.set(r.x, r.y, r.z, r.w).invert();
    const effective = accel.multiplyScalar(-1 / 9.81).add(DOWN).clampLength(0, 2.2).applyQuaternion(q1);
    for (const limb of this.limbs) {
      const target = v1.copy(limb.dir).cross(effective).sub(limb.rest).multiplyScalar(limb.loose);
      limb.vel.addScaledVector(target.sub(limb.tilt), 90 * dt);
      limb.vel.multiplyScalar(Math.exp(-9 * dt));
      limb.tilt.addScaledVector(limb.vel, dt);
      const angle = Math.min(limb.tilt.length(), 1.3);
      if (angle > 1e-4) limb.bone.quaternion.setFromAxisAngle(v1.copy(limb.tilt).normalize(), angle);
    }
  }
}

/** Keeps a view for each prize the simulation knows about. */
export class PlushField {
  readonly views = new Map<number, PlushView>();
  private baseMat: THREE.Material;
  private shellMats: [THREE.Material, THREE.Material];
  private trimMat: THREE.Material;
  private shells: number;

  constructor(private scene: THREE.Scene, private machine: Machine, quality: Quality) {
    const tex = furTexture();
    this.shells = quality.furShells;
    this.shellMats = [
      furMaterial(tex, this.shells, 0.0062, quality.mobile),
      furMaterial(tex, this.shells, 0.0125, quality.mobile),
    ];
    // With few shells the undercoat shows between strands, so it must match the fur.
    this.baseMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, color: quality.mobile ? 0xe6e6e6 : 0x9c9c9c });
    this.trimMat = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.22,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
    });
    this.sync();
  }

  /** Reconciles views against the simulation after spawns and wins. */
  sync() {
    const live = new Set(this.machine.plushes.map((p) => p.id));
    for (const [id, view] of this.views) {
      if (!live.has(id)) {
        this.scene.remove(view.group);
        this.views.delete(id);
      }
    }
    for (const p of this.machine.plushes) {
      if (this.views.has(p.id)) continue;
      const view = new PlushView(p, this.baseMat, this.shellMats, this.trimMat, this.shells);
      this.views.set(p.id, view);
      this.scene.add(view.group);
    }
  }

  update(dt: number) {
    for (const view of this.views.values()) view.update(dt);
  }

  /** A posed copy of a prize for the win card. */
  cloneForPortrait(plush: Plush) {
    const g = new THREE.Group();
    assemble(g, getDesign(plush.species, plush.seed % 3, this.shells), this.baseMat, this.shellMats, this.trimMat);
    return g;
  }
}
