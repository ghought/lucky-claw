import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BOX, CHUTE, CLAW } from '../sim/config';
import type { Machine } from '../sim/machine';
import type { Quality } from './stage';
import {
  backPanelTexture,
  bedTexture,
  deckTexture,
  frontPanelTexture,
  makeDisplay,
  marqueeTexture,
  sidePanelTexture,
  smudgeTexture,
  type Display,
} from './textures';

const OUTER = 0.4;
const GLASS_TOP = 1.76;
const DECK_TILT = Math.atan2(0.055, 0.2);

function glassMaterial(reflections: THREE.Texture, smudge: THREE.Texture) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquation: THREE.AddEquation,
    uniforms: {
      env: { value: reflections },
      smudge: { value: smudge },
      strength: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vUv;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform samplerCube env;
      uniform sampler2D smudge;
      uniform float strength;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vUv;
      void main() {
        vec3 view = normalize(vWorld - cameraPosition);
        vec3 n = normalize(vNormal);
        if (dot(view, n) > 0.0) n = -n;
        float cosT = clamp(-dot(view, n), 0.0, 1.0);
        float fresnel = 0.05 + 0.95 * pow(1.0 - cosT, 5.0);
        vec3 r = reflect(view, n);
        // Biased well down the mip chain: the room should read as soft glow, not shapes.
        vec3 refl = min(textureCube(env, vec3(-r.x, r.yz), 4.5).rgb, vec3(1.6));
        float grime = texture2D(smudge, vUv * 1.3).r;
        vec3 color = refl * (fresnel + grime * 0.05) * strength + vec3(0.9, 1.0, 0.97) * grime * 0.012;
        float alpha = clamp(fresnel * 0.6 + grime * 0.04 + 0.022, 0.0, 1.0);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Everything bolted to the machine: body, glass, lights, gantry, controls. */
export class Cabinet {
  readonly group = new THREE.Group();
  readonly display: Display;
  private bridge = new THREE.Group();
  private carriage = new THREE.Group();
  private stick = new THREE.Group();
  private button!: THREE.Mesh;
  private buttonMat!: THREE.MeshPhysicalMaterial;
  private bulbs!: THREE.InstancedMesh;
  private bulbColor = new THREE.Color();
  private ledMats: THREE.MeshBasicMaterial[] = [];
  private flap!: THREE.Mesh;
  private flapOpen = 0;
  private marqueeMat!: THREE.MeshStandardMaterial;
  private interior!: THREE.SpotLight;
  private rims: THREE.PointLight[] = [];
  private party = 0;
  private buttonDown = 0;
  private time = 0;
  private displayText = '';

  private paint: THREE.MeshPhysicalMaterial;
  private chrome = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 1, roughness: 0.14 });
  private steel = new THREE.MeshStandardMaterial({ color: 0x8c8f96, metalness: 1, roughness: 0.36 });
  private blackPlastic = new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.48 });
  private glass: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, reflections: THREE.Texture, quality: Quality) {
    this.paint = new THREE.MeshPhysicalMaterial({
      color: 0xb80f26,
      roughness: 0.34,
      metalness: 0.15,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    });
    this.glass = glassMaterial(reflections, smudgeTexture());
    this.display = makeDisplay(6);

    this.buildBody();
    this.buildPlayfield();
    this.buildGlass();
    this.buildTop();
    this.buildGantry();
    this.buildDeck();
    this.buildDoors();
    this.buildLights(quality);
    scene.add(this.group);
  }

  private add<T extends THREE.Object3D>(o: T, shadow = true): T {
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        c.castShadow = shadow;
        c.receiveShadow = true;
      }
    });
    this.group.add(o);
    return o;
  }

  private rbox(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, r = 0.012) {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat);
    m.position.set(x, y, z);
    return m;
  }

  private buildBody() {
    const side = new THREE.MeshPhysicalMaterial({
      map: sidePanelTexture(),
      roughness: 0.34,
      metalness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    });
    // Plinth and feet.
    this.add(this.rbox(0.76, 0.06, 0.76, this.blackPlastic, 0, 0.04, 0));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.02, 16), this.steel);
        foot.position.set(sx * 0.33, 0.01, sz * 0.33);
        this.add(foot);
      }
    }
    // Lower body sides and back.
    const h = 0.72;
    const y = 0.06 + h / 2;
    this.add(this.rbox(0.03, h, OUTER * 2, side, -OUTER + 0.015, y, 0));
    this.add(this.rbox(0.03, h, OUTER * 2, side, OUTER - 0.015, y, 0));
    this.add(this.rbox(OUTER * 2, h, 0.03, this.paint, 0, y, -OUTER + 0.015));

    // Front panel, with the delivery opening cut through it.
    const shape = new THREE.Shape();
    const w = OUTER - 0.03;
    shape.moveTo(-w, 0.06);
    shape.lineTo(w, 0.06);
    shape.lineTo(w, 0.78);
    shape.lineTo(-w, 0.78);
    shape.closePath();
    const door = new THREE.Path();
    const [dx0, dx1, dy0, dy1] = [-0.335, -0.115, 0.335, 0.555];
    door.moveTo(dx0, dy0);
    door.lineTo(dx0, dy1);
    door.lineTo(dx1, dy1);
    door.lineTo(dx1, dy0);
    door.closePath();
    shape.holes.push(door);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false });
    // ExtrudeGeometry UVs are in shape units; remap to the panel.
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (pos.getX(i) + w) / (2 * w), (pos.getY(i) - 0.06) / 0.72);
    }
    const front = new THREE.Mesh(
      geo,
      new THREE.MeshPhysicalMaterial({
        map: frontPanelTexture(),
        roughness: 0.32,
        metalness: 0.1,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
      }),
    );
    front.position.z = OUTER - 0.012;
    this.add(front);

    // Chrome trim around the opening.
    const frameW = 0.014;
    const cx = (dx0 + dx1) / 2;
    const cy = (dy0 + dy1) / 2;
    const fw = dx1 - dx0;
    const fh = dy1 - dy0;
    for (const [x, yy, bw, bh] of [
      [cx, dy1 + frameW / 2, fw + frameW * 2, frameW],
      [cx, dy0 - frameW / 2, fw + frameW * 2, frameW],
      [dx0 - frameW / 2, cy, frameW, fh],
      [dx1 + frameW / 2, cy, frameW, fh],
    ] as const) {
      this.add(this.rbox(bw, bh, 0.022, this.chrome, x, yy, OUTER + 0.004, 0.004));
    }

    // Dark inside of the bin and the chute shaft.
    const dark = new THREE.MeshStandardMaterial({ color: 0x0a0a0e, roughness: 0.8, side: THREE.BackSide });
    const shaftW = CHUTE.x1 - CHUTE.x0;
    const shaftD = CHUTE.z1 - CHUTE.z0 + 0.05;
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(shaftW, BOX.floorY - CHUTE.binY, shaftD), dark);
    shaft.position.set((CHUTE.x0 + CHUTE.x1) / 2, (BOX.floorY + CHUTE.binY) / 2, (CHUTE.z0 + CHUTE.z1) / 2 + 0.025);
    this.add(shaft, false);
    const binLight = new THREE.PointLight(0xffc9a0, 0.22, 0.27, 2);
    binLight.position.set(-0.23, 0.47, 0.24);
    this.group.add(binLight);
  }

  private buildPlayfield() {
    const { halfW: w, halfD: d, floorY: f, ceilY } = BOX;
    // Bed: an L-shape around the chute.
    const bed = bedTexture();
    bed.repeat.set(2, 2);
    const bedMat = new THREE.MeshStandardMaterial({ map: bed, roughness: 0.9 });
    const shape = new THREE.Shape();
    shape.moveTo(-w, -d);
    shape.lineTo(w, -d);
    shape.lineTo(w, d);
    shape.lineTo(CHUTE.x1, d);
    shape.lineTo(CHUTE.x1, CHUTE.z0);
    shape.lineTo(-w, CHUTE.z0);
    shape.closePath();
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), bedMat);
    floor.rotation.x = Math.PI / 2;
    floor.scale.y = 1;
    floor.material.side = THREE.DoubleSide;
    floor.position.y = f;
    this.add(floor);

    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 2, ceilY + 0.05 - f),
      new THREE.MeshStandardMaterial({ map: backPanelTexture(), color: 0xa8a8a8, roughness: 0.9, metalness: 0 }),
    );
    back.position.set(0, (ceilY + 0.05 + f) / 2, -d - 0.002);
    this.add(back);

    // Clear lip around the chute, with a yellow rim you can read from the front.
    const lipGlass = this.glass;
    const lipH = CHUTE.lip;
    const lipX = new THREE.Mesh(new THREE.PlaneGeometry(CHUTE.z1 - CHUTE.z0, lipH), lipGlass);
    lipX.rotation.y = Math.PI / 2;
    lipX.position.set(CHUTE.x1, f + lipH / 2, (CHUTE.z0 + CHUTE.z1) / 2);
    this.group.add(lipX);
    const lipZ = new THREE.Mesh(new THREE.PlaneGeometry(CHUTE.x1 - CHUTE.x0, lipH), lipGlass);
    lipZ.position.set((CHUTE.x0 + CHUTE.x1) / 2, f + lipH / 2, CHUTE.z0);
    this.group.add(lipZ);
    const rim = new THREE.MeshStandardMaterial({ color: 0xffc81f, roughness: 0.4, emissive: 0x4a3200 });
    const t = 0.009;
    this.add(this.rbox(t, t, CHUTE.z1 - CHUTE.z0, rim, CHUTE.x1, f + lipH, (CHUTE.z0 + CHUTE.z1) / 2, 0.003));
    this.add(this.rbox(CHUTE.x1 - CHUTE.x0, t, t, rim, (CHUTE.x0 + CHUTE.x1) / 2, f + lipH, CHUTE.z0, 0.003));
  }

  private buildGlass() {
    const { halfW: w, halfD: d, floorY: f } = BOX;
    const h = GLASS_TOP - 0.78;
    const y = 0.78 + h / 2;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w * 2 + 0.02, h), this.glass);
    front.position.set(0, y, d + 0.012);
    front.renderOrder = 10;
    this.group.add(front);
    for (const s of [-1, 1]) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(d * 2 + 0.02, h), this.glass);
      pane.rotation.y = Math.PI / 2;
      pane.position.set(s * (w + 0.012), y, 0);
      pane.renderOrder = 10;
      this.group.add(pane);
    }
    // Corner posts and sills.
    const postH = GLASS_TOP - 0.76;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.add(this.rbox(0.05, postH, 0.05, this.paint, sx * 0.375, 0.76 + postH / 2, sz * 0.375, 0.01));
      }
    }
    const sill = (x: number, z: number, sw: number, sd: number) =>
      this.add(this.rbox(sw, 0.03, sd, this.chrome, x, 0.785, z, 0.006));
    sill(0, 0.375, 0.76, 0.05);
    sill(-0.375, 0, 0.05, 0.76);
    sill(0.375, 0, 0.05, 0.76);
    sill(0, -0.375, 0.76, 0.05);
    void f;
  }

  private buildTop() {
    // Canopy over the glass.
    this.add(this.rbox(0.84, 0.1, 0.84, this.paint, 0, GLASS_TOP + 0.05, 0, 0.02));
    this.add(this.rbox(0.85, 0.018, 0.85, this.chrome, 0, GLASS_TOP + 0.002, 0, 0.006));
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.72),
      new THREE.MeshStandardMaterial({ color: 0x111116, roughness: 0.6, side: THREE.DoubleSide }),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = BOX.ceilY + 0.03;
    this.add(ceiling);

    // Marquee.
    const my = GLASS_TOP + 0.1 + 0.15;
    this.add(this.rbox(0.8, 0.3, 0.34, this.paint, 0, my, 0.2, 0.02));
    const tex = marqueeTexture();
    this.marqueeMat = new THREE.MeshStandardMaterial({
      map: tex,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 0.62,
      roughness: 0.4,
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.24), this.marqueeMat);
    sign.position.set(0, my, 0.2 + 0.171);
    this.group.add(sign);

    // Chaser bulbs around the sign.
    const spots: [number, number][] = [];
    const bw = 0.385;
    const bh = 0.137;
    const nx = 16;
    const ny = 6;
    for (let i = 0; i < nx; i++) spots.push([-bw + (2 * bw * i) / (nx - 1), bh]);
    for (let i = 1; i < ny; i++) spots.push([bw, bh - (2 * bh * i) / ny]);
    for (let i = 0; i < nx; i++) spots.push([bw - (2 * bw * i) / (nx - 1), -bh]);
    for (let i = 1; i < ny; i++) spots.push([-bw, -bh + (2 * bh * i) / ny]);
    this.bulbs = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.0085, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      spots.length,
    );
    const m = new THREE.Matrix4();
    spots.forEach(([x, y], i) => {
      m.makeTranslation(x, my + y, 0.2 + 0.175);
      this.bulbs.setMatrixAt(i, m);
      this.bulbs.setColorAt(i, this.bulbColor.setRGB(1, 0.8, 0.4));
    });
    this.group.add(this.bulbs);
  }

  private buildGantry() {
    const y = CLAW.trolleyY + 0.03;
    // Fixed rails along z.
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.72, 16), this.chrome);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(s * 0.335, y, 0);
      this.add(rail);
      const bracket = this.rbox(0.03, 0.02, 0.72, this.blackPlastic, s * 0.335, y + 0.022, 0, 0.004);
      this.add(bracket);
    }
    // Bridge riding those rails.
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.67, 16), this.chrome);
    bar.rotation.z = Math.PI / 2;
    bar.position.z = -0.016;
    const bar2 = bar.clone();
    bar2.position.z = 0.016;
    this.bridge.add(bar, bar2);
    for (const s of [-1, 1]) {
      this.bridge.add(this.rbox(0.05, 0.03, 0.07, this.blackPlastic, s * 0.335, 0, 0, 0.005));
    }
    this.bridge.position.y = y;
    this.add(this.bridge);

    // Carriage with the winch.
    this.carriage.add(this.rbox(0.09, 0.03, 0.07, this.steel, 0, 0, 0, 0.005));
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.06, 20), this.blackPlastic);
    drum.rotation.z = Math.PI / 2;
    drum.position.y = -0.03;
    this.carriage.add(drum);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.05, 20), this.steel);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(0.062, -0.012, 0);
    this.carriage.add(motor);
    this.carriage.position.y = y;
    this.add(this.carriage);
  }

  private buildDeck() {
    // Wedge profile, extruded across the machine.
    const p = new THREE.Shape();
    p.moveTo(0.38, 0.7);
    p.lineTo(0.6, 0.835);
    p.lineTo(0.6, 0.875);
    p.lineTo(0.385, 0.933);
    p.closePath();
    const wedge = new THREE.ExtrudeGeometry(p, {
      depth: 0.76,
      bevelEnabled: true,
      bevelSize: 0.006,
      bevelThickness: 0.006,
      bevelSegments: 3,
    });
    wedge.rotateY(-Math.PI / 2);
    wedge.translate(0.38, 0, 0);
    this.add(new THREE.Mesh(wedge, this.paint));

    const deck = new THREE.Group();
    deck.position.set(0, 0.9118, 0.4925);
    deck.rotation.x = DECK_TILT;
    this.group.add(deck);

    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(0.74, 0.2),
      new THREE.MeshStandardMaterial({ map: deckTexture(), roughness: 0.5, metalness: 0.3 }),
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.0015;
    top.receiveShadow = true;
    deck.add(top);

    // Joystick: dust washer, shaft, ball top. Pivots at the deck.
    const washer = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.002, 28), this.blackPlastic);
    washer.position.set(-0.214, 0.003, 0);
    deck.add(washer);
    this.stick.position.set(-0.214, 0.002, 0);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.075, 16), this.chrome);
    shaft.position.y = 0.037;
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 28, 20),
      new THREE.MeshPhysicalMaterial({ color: 0xd7102f, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 }),
    );
    ball.position.y = 0.085;
    ball.castShadow = true;
    shaft.castShadow = true;
    this.stick.add(shaft, ball);
    deck.add(this.stick);

    // Lit dome button.
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.006, 12, 36), this.chrome);
    bezel.rotation.x = Math.PI / 2;
    bezel.position.set(0.214, 0.005, 0);
    deck.add(bezel);
    const dome = new THREE.SphereGeometry(0.036, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.45, 1);
    this.buttonMat = new THREE.MeshPhysicalMaterial({
      color: 0xff1a2e,
      roughness: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      emissive: 0xff1a2e,
      emissiveIntensity: 0.3,
    });
    this.button = new THREE.Mesh(dome, this.buttonMat);
    this.button.position.set(0.214, 0.006, 0);
    deck.add(this.button);

    // Seven-segment readout, recessed behind a smoked lens.
    const housing = this.rbox(0.19, 0.012, 0.06, this.blackPlastic, 0, 0.003, 0, 0.004);
    deck.add(housing);
    const lcd = new THREE.Mesh(
      new THREE.PlaneGeometry(0.175, 0.05),
      new THREE.MeshBasicMaterial({ map: this.display.texture, color: new THREE.Color(2.2, 2.2, 2.2) }),
    );
    lcd.rotation.x = -Math.PI / 2;
    lcd.position.y = 0.0095;
    deck.add(lcd);
    this.display.draw('INSErt');
  }

  private buildDoors() {
    // Coin door on the right of the lower panel.
    const plate = this.rbox(0.2, 0.3, 0.016, this.steel, 0.2, 0.42, OUTER + 0.006, 0.006);
    this.add(plate);
    const entryMat = new THREE.MeshStandardMaterial({
      color: 0x330404,
      emissive: 0xff2010,
      emissiveIntensity: 1.6,
      roughness: 0.3,
    });
    for (const x of [0.15, 0.25]) {
      const entry = this.rbox(0.055, 0.075, 0.012, entryMat, x, 0.495, OUTER + 0.016, 0.005);
      this.add(entry);
      const slot = this.rbox(0.004, 0.034, 0.002, this.blackPlastic, x, 0.495, OUTER + 0.0225, 0.001);
      this.add(slot);
      const ret = this.rbox(0.07, 0.04, 0.012, this.chrome, x, 0.345, OUTER + 0.016, 0.004);
      this.add(ret);
    }
    const lock = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 20), this.chrome);
    lock.rotation.x = Math.PI / 2;
    lock.position.set(0.2, 0.42, OUTER + 0.018);
    this.add(lock);

    // Smoked flap over the delivery bin, hinged along the top.
    const hinge = new THREE.Group();
    hinge.position.set(-0.225, 0.555, OUTER + 0.006);
    const flapGeo = new THREE.PlaneGeometry(0.218, 0.218);
    flapGeo.translate(0, -0.109, 0);
    this.flap = new THREE.Mesh(
      flapGeo,
      new THREE.MeshPhysicalMaterial({
        color: 0x08080c,
        roughness: 0.18,
        metalness: 0,
        transparent: true,
        opacity: 0.74,
        side: THREE.DoubleSide,
      }),
    );
    hinge.add(this.flap);
    this.group.add(hinge);
  }

  private buildLights(quality: Quality) {
    // Light strips: emissive bars carry the bloom, real lights do the work.
    const addStrip = (w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.Color) => {
      const mat = new THREE.MeshBasicMaterial({ color: color.clone() });
      this.ledMats.push(mat);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      this.group.add(m);
    };
    const white = new THREE.Color(2.6, 2.4, 2.15);
    const y = BOX.ceilY + 0.022;
    addStrip(0.68, 0.006, 0.014, 0, y, 0.34, white);
    addStrip(0.68, 0.006, 0.014, 0, y, -0.34, white);
    addStrip(0.014, 0.006, 0.68, -0.34, y, 0, white);
    addStrip(0.014, 0.006, 0.68, 0.34, y, 0, white);
    // Colour strips up the front posts.
    const pink = new THREE.Color(2.4, 0.3, 1.2);
    for (const s of [-1, 1]) addStrip(0.006, 0.9, 0.006, s * 0.348, 1.26, 0.349, pink);

    this.interior = new THREE.SpotLight(0xfff0dc, 5.2, 2.4, 0.94, 0.65, 1.1);
    this.interior.position.set(0, BOX.ceilY + 0.2, 0.06);
    this.interior.target.position.set(0, BOX.floorY, 0);
    this.interior.castShadow = true;
    this.interior.shadow.mapSize.setScalar(quality.shadowSize);
    this.interior.shadow.camera.near = 0.15;
    this.interior.shadow.camera.far = 1.6;
    this.interior.shadow.bias = -0.0006;
    this.interior.shadow.normalBias = 0.004;
    this.interior.shadow.radius = 5;
    this.group.add(this.interior, this.interior.target);

    const fill = new THREE.PointLight(0xfff4e8, 0.5, 1.6, 1.6);
    fill.position.set(0, 1.5, 0.3);
    this.group.add(fill);
    const rimA = new THREE.PointLight(0xff4fa8, 0.16, 0.55, 1.6);
    rimA.position.set(-0.2, 1.14, 0.12);
    const rimB = new THREE.PointLight(0x3fd8ff, 0.16, 0.55, 1.6);
    rimB.position.set(0.2, 1.14, -0.1);
    this.rims = [rimA, rimB];
    this.group.add(rimA, rimB);
  }

  celebrate(seconds = 5) {
    this.party = seconds;
  }

  pressButton() {
    this.buttonDown = 0.18;
  }

  openFlap() {
    this.flapOpen = 1;
  }

  setDisplay(text: string) {
    if (text === this.displayText) return;
    this.displayText = text;
    this.display.draw(text);
  }

  update(dt: number, machine: Machine, stick: { x: number; y: number }) {
    this.time += dt;
    const t = this.time;
    this.party = Math.max(0, this.party - dt);
    const partying = this.party > 0;

    this.bridge.position.z = machine.trolley.z;
    this.carriage.position.x = machine.trolley.x;
    this.carriage.position.z = machine.trolley.z;

    this.stick.rotation.z = THREE.MathUtils.lerp(this.stick.rotation.z, -stick.x * 0.32, 1 - Math.exp(-dt * 30));
    this.stick.rotation.x = THREE.MathUtils.lerp(this.stick.rotation.x, -stick.y * 0.32, 1 - Math.exp(-dt * 30));

    this.buttonDown = Math.max(0, this.buttonDown - dt);
    this.button.position.y = 0.006 - (this.buttonDown > 0 ? 0.007 : 0);
    const live = machine.phase === 'play';
    this.buttonMat.emissiveIntensity = live ? 1.1 + Math.sin(t * 7) * 0.8 : 0.2;

    this.flapOpen = Math.max(0, this.flapOpen - dt * 0.7);
    if (this.flap.parent) this.flap.parent.rotation.x = -Math.sin(Math.min(1, this.flapOpen) * Math.PI) * 0.75;

    // Bulbs chase slowly at rest, and riot on a win.
    const n = this.bulbs.count;
    const speed = partying ? 26 : machine.phase === 'idle' ? 7 : 11;
    for (let i = 0; i < n; i++) {
      const on = (i + Math.floor(t * speed)) % 4 < (partying ? 2 : 3);
      if (partying) this.bulbColor.setHSL((i / n + t * 1.3) % 1, 1, on ? 0.72 : 0.08).multiplyScalar(on ? 2 : 1);
      else if (on) this.bulbColor.setRGB(2.1, 1.5, 0.62);
      else this.bulbColor.setRGB(0.24, 0.13, 0.05);
      this.bulbs.setColorAt(i, this.bulbColor);
    }
    if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;

    this.marqueeMat.emissiveIntensity = partying ? 0.75 + Math.sin(t * 22) * 0.3 : 0.62 + Math.sin(t * 1.7) * 0.02;
    this.interior.intensity = partying ? 5.2 + Math.sin(t * 18) * 2 : 5.2;
    if (partying) {
      this.rims[0].color.setHSL((t * 0.9) % 1, 1, 0.6);
      this.rims[1].color.setHSL((t * 0.9 + 0.5) % 1, 1, 0.6);
    } else {
      this.rims[0].color.setHex(0xff4fa8);
      this.rims[1].color.setHex(0x3fd8ff);
    }
  }
}
