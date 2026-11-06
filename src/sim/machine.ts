import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { BOX, CHUTE, CLAW, GRIP, HOME, PHYSICS_HZ, PLAY_SECONDS } from './config';
import { SPECIES, SPECIES_IDS, type SpeciesId } from './species';

export type Phase =
  | 'idle'
  | 'play'
  | 'open'
  | 'drop'
  | 'settle'
  | 'grab'
  | 'lift'
  | 'return'
  | 'release'
  | 'park';

export type MachineEvent =
  | { type: 'coin' }
  | { type: 'start' }
  | { type: 'open' }
  | { type: 'descend' }
  | { type: 'touch' }
  | { type: 'close' }
  | { type: 'lift' }
  | { type: 'slip'; plush: Plush }
  | { type: 'home' }
  | { type: 'release' }
  | { type: 'chute'; plush: Plush }
  | { type: 'win'; plush: Plush }
  | { type: 'lose' }
  | { type: 'thump'; force: number }
  | { type: 'ready' };

export interface Plush {
  id: number;
  species: SpeciesId;
  name: string;
  seed: number;
  body: RAPIER.RigidBody;
  state: 'bed' | 'chute' | 'won';
  chuteTime: number;
}

export interface Finger {
  body: RAPIER.RigidBody;
  joint: RAPIER.RevoluteImpulseJoint;
  axis: Vector3;
  angle: number;
}

const GROUP_STATIC = 1;
const GROUP_PLUSH = 2;
const GROUP_FINGER = 4;
const GROUP_HUB = 8;
const groups = (member: number, filter: number) => (member << 16) | filter;

const FINGER_FRICTION = 0.9;
const DT = 1 / PHYSICS_HZ;
const G = 9.81;
const UP = new Vector3(0, 1, 0);

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MachineOptions {
  seed?: number;
  plushCount?: number;
  /** Overrides the per-play random carry torque; used by the trial harness. */
  fixedCarry?: number;
}

export class Machine {
  static async create(opts: MachineOptions = {}) {
    await RAPIER.init();
    return new Machine(opts);
  }

  readonly world: RAPIER.World;
  readonly events = new RAPIER.EventQueue(true);
  readonly plushes: Plush[] = [];
  readonly fingers: Finger[] = [];
  readonly hub: RAPIER.RigidBody;

  phase: Phase = 'idle';
  phaseTime = 0;
  credits = 0;
  timeLeft = PLAY_SECONDS;
  stick = { x: 0, z: 0 };

  trolley = { x: HOME.x, z: HOME.z, vx: 0, vz: 0 };
  rope: number = CLAW.ropeHome;
  ropeSpeed = 0;
  swing = { x: 0, z: 0, vx: 0, vz: 0 };
  twist = 0;
  twistV = 0;
  hubPos = new Vector3();
  hubQuat = new Quaternion();
  grip = 0;

  private listeners: ((e: MachineEvent) => void)[] = [];
  private rand: () => number;
  private fingerColliders = new Set<number>();
  private plushColliders = new Map<number, Plush>();
  private load = 0;
  private touched = false;
  private slackTime = 0;
  private carry: number = GRIP.carryMin;
  private playsSinceWin = 0;
  private fingerTarget: number = CLAW.restAngle;
  private fingerTorque: number = GRIP.open;
  private heldAtTop: Plush | null = null;
  private wonThisPlay = false;
  private nextId = 1;
  private released = false;
  private speciesBag: SpeciesId[] = [];
  private lastThump = 0;
  private time = 0;

  private constructor(private opts: MachineOptions) {
    this.rand = mulberry32(opts.seed ?? (Math.random() * 2 ** 31) | 0);
    this.world = new RAPIER.World({ x: 0, y: -G, z: 0 });
    this.world.timestep = DT;
    this.world.numSolverIterations = 8;

    this.buildStatics();

    this.hubPos.set(HOME.x, CLAW.trolleyY - this.rope, HOME.z);
    this.hub = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        this.hubPos.x,
        this.hubPos.y,
        this.hubPos.z,
      ),
    );
    const hubCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.04, 0.05)
        .setTranslation(0, -0.03, 0)
        .setCollisionGroups(groups(GROUP_HUB, GROUP_PLUSH))
        .setFriction(0.4)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(0.05),
      this.hub,
    );
    this.fingerColliders.add(hubCollider.handle);
    for (let i = 0; i < 3; i++) this.buildFinger(i);
    this.fillBed(opts.plushCount ?? 26);
  }

  on(fn: (e: MachineEvent) => void) {
    this.listeners.push(fn);
  }

  private emit(e: MachineEvent) {
    for (const fn of this.listeners) fn(e);
  }

  // ---- construction -------------------------------------------------------

  private box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, friction = 0.7) {
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(cx, cy, cz)
        .setFriction(friction)
        .setCollisionGroups(groups(GROUP_STATIC, GROUP_PLUSH | GROUP_FINGER)),
    );
  }

  private buildStatics() {
    const { halfW: w, halfD: d, floorY: f, ceilY: c } = BOX;
    const t = 0.05;
    const midY = (c + CHUTE.binY) / 2;
    const halfY = (c - CHUTE.binY) / 2;
    // Bed, with the chute corner left open.
    const rightW = w - CHUTE.x1;
    this.box(CHUTE.x1 + rightW / 2, f - t, 0, rightW / 2, t, d);
    const leftW = CHUTE.x1 + w;
    const backD = CHUTE.z0 + d;
    this.box(-w + leftW / 2, f - t, -d + backD / 2, leftW / 2, t, backD / 2);
    // Glass walls, carried down around the chute so prizes stay in the shaft.
    this.box(-w - t, midY, 0, t, halfY, d + t, 0.25);
    this.box(w + t, midY, 0, t, halfY, d + t, 0.25);
    this.box(0, midY, -d - t, w + t, halfY, t, 0.25);
    this.box(0, midY, d + t, w + t, halfY, t, 0.25);
    // Clear lip around the chute.
    const lipY = f + CHUTE.lip / 2;
    const lipT = 0.004;
    const zMid = (CHUTE.z0 + CHUTE.z1) / 2;
    const zHalf = (CHUTE.z1 - CHUTE.z0) / 2;
    const xMid = (CHUTE.x0 + CHUTE.x1) / 2;
    const xHalf = (CHUTE.x1 - CHUTE.x0) / 2;
    this.box(CHUTE.x1, lipY, zMid, lipT, CHUTE.lip / 2, zHalf, 0.3);
    this.box(xMid, lipY, CHUTE.z0, xHalf, CHUTE.lip / 2, lipT, 0.3);
    // Shaft below the bed, then the delivery bin.
    const shaftY = (f + CHUTE.binY) / 2;
    const shaftH = (f - CHUTE.binY) / 2;
    this.box(CHUTE.x1 + lipT, shaftY, zMid, lipT, shaftH, zHalf, 0.3);
    this.box(xMid, shaftY, CHUTE.z0 - lipT, xHalf, shaftH, lipT, 0.3);
    this.box(xMid, CHUTE.binY - t, zMid, xHalf + t, t, zHalf + t, 0.8);
  }

  private buildFinger(i: number) {
    const theta = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const rot = new Quaternion().setFromAxisAngle(UP, theta);
    const radial = new Vector3(1, 0, 0).applyQuaternion(rot);
    const axis = new Vector3(0, 0, 1).applyQuaternion(rot);
    const hinge = radial
      .clone()
      .multiplyScalar(CLAW.hingeRadius)
      .add(new Vector3(0, -CLAW.hingeDrop, 0));

    // The body frame stays aligned with the hub so the joint axis is identical
    // on both sides; the finger's own azimuth lives in its collider offsets.
    const start = this.hubPos.clone().add(hinge);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(start.x, start.y, start.z)
        .setCanSleep(false)
        .setAngularDamping(1.5),
    );

    const path = CLAW.fingerPath.map(([r, y]) => radial.clone().multiplyScalar(r).add(new Vector3(0, y, 0)));
    const massPer = CLAW.fingerMass / (path.length - 1);
    for (let s = 0; s + 1 < path.length; s++) {
      const a = path[s];
      const b = path[s + 1];
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const dir = b.clone().sub(a);
      const half = dir.length() / 2;
      const q = new Quaternion().setFromUnitVectors(UP, dir.normalize());
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.capsule(half, CLAW.fingerRadius)
          .setTranslation(mid.x, mid.y, mid.z)
          .setRotation(q)
          .setMass(massPer)
          .setFriction(FINGER_FRICTION)
          .setCollisionGroups(groups(GROUP_FINGER, GROUP_STATIC | GROUP_PLUSH))
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(0.05),
        body,
      );
      this.fingerColliders.add(collider.handle);
    }
    const tip = path[path.length - 1];
    const tipCollider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(CLAW.tipRadius)
        .setTranslation(tip.x, tip.y, tip.z)
        .setMass(0.005)
        .setFriction(FINGER_FRICTION)
        .setCollisionGroups(groups(GROUP_FINGER, GROUP_STATIC | GROUP_PLUSH))
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(0.05),
      body,
    );
    this.fingerColliders.add(tipCollider.handle);

    const data = RAPIER.JointData.revolute(hinge, { x: 0, y: 0, z: 0 }, axis);
    const joint = this.world.createImpulseJoint(data, this.hub, body, true) as RAPIER.RevoluteImpulseJoint;
    joint.setContactsEnabled(false);
    joint.setLimits(-0.03, CLAW.openAngle);
    joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
    this.fingers.push({ body, joint, axis, angle: 0 });
  }

  /** Empties the bed and tumbles a fresh load of prizes in from above. */
  fillBed(count: number) {
    for (const p of this.plushes) this.world.removeRigidBody(p.body);
    this.plushes.length = 0;
    this.plushColliders.clear();
    for (let i = 0; i < count; i++) this.spawnPlush(i, count);
    for (let i = 0; i < PHYSICS_HZ * 3; i++) this.world.step();
    // Anything that bounced into the chute during the fill goes back on the bed.
    for (let pass = 0; pass < 4; pass++) {
      const strays = this.plushes.filter((p) => {
        const t = p.body.translation();
        return t.x < CHUTE.x1 + 0.02 && t.z > CHUTE.z0 - 0.02;
      });
      if (strays.length === 0) break;
      for (const p of strays) {
        p.body.setTranslation({ x: 0.08 + this.rand() * 0.2, y: BOX.floorY + 0.42, z: -0.2 + this.rand() * 0.25 }, true);
        p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
      for (let i = 0; i < PHYSICS_HZ * 1.5; i++) this.world.step();
    }
    for (const p of this.plushes) p.body.sleep();
  }

  /** Drops more prizes in from the top, in full view, like an attendant would. */
  restock(n: number) {
    for (let i = 0; i < n; i++) {
      this.spawnPlush(i, n);
      const p = this.plushes[this.plushes.length - 1];
      p.body.setTranslation(
        { x: 0.02 + this.rand() * 0.26, y: BOX.floorY + 0.46 + i * 0.05, z: -0.26 + this.rand() * 0.42 },
        true,
      );
    }
  }

  private spawnPlush(i: number, count: number) {
    // Deal species from a shuffled bag so every load is a good mix.
    if (this.speciesBag.length === 0) {
      this.speciesBag = [...SPECIES_IDS];
      for (let k = this.speciesBag.length - 1; k > 0; k--) {
        const j = Math.floor(this.rand() * (k + 1));
        [this.speciesBag[k], this.speciesBag[j]] = [this.speciesBag[j], this.speciesBag[k]];
      }
    }
    const species = this.speciesBag.pop() as SpeciesId;
    const spec = SPECIES[species];
    // Layered grid over the bed, skipping the chute corner.
    const perLayer = 16;
    const layer = Math.floor(i / perLayer);
    const cell = i % perLayer;
    let x = ((cell % 4) - 1.5) * 0.165 + (this.rand() - 0.5) * 0.04;
    let z = (Math.floor(cell / 4) - 1.5) * 0.165 + (this.rand() - 0.5) * 0.04;
    if (x < CHUTE.x1 + 0.09 && z > CHUTE.z0 - 0.09) {
      x = 0.05 + this.rand() * 0.25;
      z = -0.28 + this.rand() * 0.3;
    }
    const y = BOX.floorY + 0.14 + layer * 0.17 + (i / count) * 0.03;
    const q = new Quaternion().setFromAxisAngle(
      new Vector3(this.rand() - 0.5, this.rand() * 0.2, this.rand() - 0.5).normalize(),
      (this.rand() - 0.5) * 2.4,
    );
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation(q)
        .setLinearDamping(0.25)
        .setAngularDamping(1.1)
        .setCcdEnabled(false),
    );
    const massPer = spec.mass / spec.balls.length;
    const plush: Plush = {
      id: this.nextId++,
      species,
      name: spec.names[Math.floor(this.rand() * spec.names.length)],
      seed: Math.floor(this.rand() * 1e6),
      body,
      state: 'bed',
      chuteTime: 0,
    };
    for (const ball of spec.balls) {
      const c = this.world.createCollider(
        // Slightly under the visible size, so claws and neighbours press into the fur.
        RAPIER.ColliderDesc.ball(ball.r * 0.93)
          .setTranslation(ball.p[0], ball.p[1], ball.p[2])
          .setMass(massPer)
          .setFriction(0.8)
          .setRestitution(0.02)
          .setCollisionGroups(groups(GROUP_PLUSH, GROUP_STATIC | GROUP_PLUSH | GROUP_FINGER | GROUP_HUB))
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(6),
        body,
      );
      this.plushColliders.set(c.handle, plush);
    }
    this.plushes.push(plush);
  }

  // ---- player commands ----------------------------------------------------

  addCredits(n: number) {
    this.credits += n;
  }

  insertCoin() {
    if (this.phase !== 'idle' || this.credits <= 0) return false;
    this.credits--;
    this.timeLeft = PLAY_SECONDS;
    this.wonThisPlay = false;
    this.heldBefore = null;
    this.heldAtTop = null;
    this.rollCarry();
    this.emit({ type: 'coin' });
    this.setPhase('play');
    this.emit({ type: 'start' });
    return true;
  }

  pressDrop() {
    if (this.phase !== 'play') return false;
    this.stick.x = 0;
    this.stick.z = 0;
    this.setPhase('open');
    this.emit({ type: 'open' });
    return true;
  }

  private rollCarry() {
    if (this.opts.fixedCarry !== undefined) {
      this.carry = this.opts.fixedCarry;
      return;
    }
    // Real cranes rise toward a set payout; so does this one.
    const pity = Math.min(1, this.playsSinceWin / GRIP.pityAfter);
    const roll = Math.max(this.rand(), pity * pity);
    this.carry = GRIP.carryMin + (GRIP.carryMax - GRIP.carryMin) * roll;
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseTime = 0;
  }

  // ---- simulation ---------------------------------------------------------

  /** Advances exactly one fixed physics tick. */
  tick() {
    this.time += DT;
    this.phaseTime += DT;
    this.updatePhase();
    this.moveTrolley();
    this.updateSwing();
    this.driveHub();
    this.driveFingers();
    this.world.step(this.events);
    this.readContacts();
    this.updatePrizes();
  }

  private updatePhase() {
    switch (this.phase) {
      case 'idle':
        this.fingerTarget = CLAW.restAngle;
        this.fingerTorque = GRIP.open;
        break;
      case 'play':
        this.timeLeft -= DT;
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          this.pressDrop();
        }
        break;
      case 'open':
        this.fingerTarget = CLAW.openAngle;
        this.fingerTorque = GRIP.open;
        if (this.phaseTime > 0.4) {
          this.slackTime = 0;
          this.touched = false;
          this.load = 0;
          this.setPhase('drop');
          this.emit({ type: 'descend' });
        }
        break;
      case 'drop': {
        if (!this.touched && this.load > 1) {
          this.touched = true;
          this.emit({ type: 'touch' });
        }
        const slack = this.load > CLAW.slackForce;
        this.slackTime = slack ? this.slackTime + DT : Math.max(0, this.slackTime - DT * 0.5);
        // The head keeps sinking under its own weight until the line goes slack.
        const speed = CLAW.dropSpeed * (this.touched ? 0.45 : 1);
        this.rope += speed * DT;
        if (this.rope >= CLAW.ropeMax || this.slackTime > 0.05) {
          this.rope = Math.min(this.rope, CLAW.ropeMax);
          this.setPhase('settle');
        }
        break;
      }
      case 'settle':
        if (this.phaseTime > 0.3) {
          this.setPhase('grab');
          this.emit({ type: 'close' });
        }
        break;
      case 'grab': {
        const t = Math.min(1, this.phaseTime / CLAW.closeTime);
        this.fingerTarget = CLAW.openAngle * (1 - t);
        this.fingerTorque = GRIP.close;
        if (this.phaseTime > CLAW.closeTime + 0.35) {
          this.fingerTarget = -0.03;
          this.setPhase('lift');
          this.emit({ type: 'lift' });
        }
        break;
      }
      case 'lift': {
        this.fingerTarget = -0.03;
        // Strength bleeds away on the way up, as on a real voltage-stepped claw.
        const t = Math.min(1, this.phaseTime / 1.2);
        this.fingerTorque = GRIP.close + (this.carry - GRIP.close) * t;
        this.rope -= CLAW.liftSpeed * DT;
        if (this.rope <= CLAW.ropeHome) {
          this.rope = CLAW.ropeHome;
          this.heldAtTop = this.heldPlush();
          this.setPhase('return');
        }
        break;
      }
      case 'return': {
        this.fingerTarget = -0.03;
        this.fingerTorque = this.carry;
        const atHome =
          Math.hypot(this.trolley.x - HOME.x, this.trolley.z - HOME.z) < 0.002 &&
          Math.hypot(this.trolley.vx, this.trolley.vz) < 0.01;
        if (atHome) {
          this.emit({ type: 'home' });
          this.setPhase('release');
        }
        break;
      }
      case 'release':
        if (this.phaseTime > 0.45) {
          if (!this.released) {
            this.released = true;
            this.fingerTorque = GRIP.open;
            this.setFingerFriction(0.03);
            this.emit({ type: 'release' });
          }
          // Spring-return fingers ease open, letting the prize slide down between them.
          const t = Math.min(1, (this.phaseTime - 0.45) / CLAW.releaseTime);
          this.fingerTarget = CLAW.releaseAngle * t;
        }
        if (this.phaseTime > 2.0) {
          this.setFingerFriction(FINGER_FRICTION);
          this.released = false;
          this.setPhase('park');
        }
        break;
      case 'park':
        this.fingerTarget = CLAW.restAngle;
        this.fingerTorque = GRIP.open;
        if (this.phaseTime > 0.6) this.finishPlay();
        break;
    }
  }

  /** Slick fingers on release, so a prize drops instead of riding a tip out over the lip. */
  private setFingerFriction(friction: number) {
    for (const handle of this.fingerColliders) this.world.getCollider(handle).setFriction(friction);
  }

  private finishPlay() {
    if (this.wonThisPlay) {
      this.playsSinceWin = 0;
    } else {
      this.playsSinceWin++;
      this.emit({ type: 'lose' });
    }
    this.setPhase('idle');
    this.emit({ type: 'ready' });
  }

  private moveTrolley() {
    const t = this.trolley;
    let wantX = 0;
    let wantZ = 0;
    if (this.phase === 'play') {
      wantX = this.stick.x * CLAW.maxSpeed;
      wantZ = this.stick.z * CLAW.maxSpeed;
    } else if (this.phase === 'return') {
      const dx = HOME.x - t.x;
      const dz = HOME.z - t.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-4) {
        // Brake so the gantry arrives at rest.
        const speed = Math.min(CLAW.returnSpeed, Math.sqrt(2 * CLAW.returnAccel * 0.8 * dist));
        wantX = (dx / dist) * speed;
        wantZ = (dz / dist) * speed;
      }
    }
    const maxDv = (this.phase === 'return' ? CLAW.returnAccel : CLAW.accel) * DT;
    const dvx = wantX - t.vx;
    const dvz = wantZ - t.vz;
    const dv = Math.hypot(dvx, dvz);
    const k = dv > maxDv ? maxDv / dv : 1;
    const ax = (dvx * k) / DT;
    const az = (dvz * k) / DT;
    t.vx += dvx * k;
    t.vz += dvz * k;
    t.x += t.vx * DT;
    t.z += t.vz * DT;
    if (Math.abs(t.x) > CLAW.limit) {
      t.x = Math.sign(t.x) * CLAW.limit;
      t.vx = 0;
    }
    if (Math.abs(t.z) > CLAW.limit) {
      t.z = Math.sign(t.z) * CLAW.limit;
      t.vz = 0;
    }
    this.swing.vx -= ax * DT;
    this.swing.vz -= az * DT;
  }

  private updateSwing() {
    const s = this.swing;
    const len = Math.max(0.12, this.rope + 0.1);
    const w2 = G / len;
    s.vx += (-w2 * s.x - CLAW.swingDamping * s.vx) * DT;
    s.vz += (-w2 * s.z - CLAW.swingDamping * s.vz) * DT;
    s.x += s.vx * DT;
    s.z += s.vz * DT;
    const max = len * 0.3;
    const mag = Math.hypot(s.x, s.z);
    if (mag > max) {
      s.x *= max / mag;
      s.z *= max / mag;
    }
    // The cable winds up slightly as it pays out.
    this.twistV += (-30 * this.twist - 1.2 * this.twistV) * DT;
    this.twist += this.twistV * DT;
  }

  private driveHub() {
    const s = this.swing;
    const len = this.rope;
    const y = Math.sqrt(Math.max(1e-6, len * len - s.x * s.x - s.z * s.z));
    this.hubPos.set(this.trolley.x + s.x, CLAW.trolleyY - y, this.trolley.z + s.z);
    const down = new Vector3(s.x, -y, s.z).normalize().negate();
    this.hubQuat.setFromUnitVectors(UP, down);
    this.hubQuat.multiply(new Quaternion().setFromAxisAngle(UP, this.twist));
    this.hub.setNextKinematicTranslation(this.hubPos);
    this.hub.setNextKinematicRotation(this.hubQuat);
  }

  private driveFingers() {
    const inv = this.hubQuat.clone().invert();
    const q = new Quaternion();
    for (const f of this.fingers) {
      f.joint.configureMotorPosition(this.fingerTarget, 3.5, 0.12);
      f.joint.setMotorMaxForce(this.fingerTorque);
      const r = f.body.rotation();
      q.set(r.x, r.y, r.z, r.w).premultiply(inv);
      f.angle = 2 * Math.atan2(q.x * f.axis.x + q.y * f.axis.y + q.z * f.axis.z, q.w);
    }
    this.grip = this.fingerTorque;
  }

  private readContacts() {
    let vertical = 0;
    let thump = 0;
    this.events.drainContactForceEvents((e) => {
      const a = e.collider1();
      const b = e.collider2();
      if (this.fingerColliders.has(a) || this.fingerColliders.has(b)) {
        // Only load that holds the claw up slackens the cable; the glass doesn't.
        vertical += Math.abs(e.totalForce().y);
      } else if (this.plushColliders.has(a) || this.plushColliders.has(b)) {
        thump = Math.max(thump, e.totalForceMagnitude());
      }
    });
    this.load += (Math.min(vertical, 80) - this.load) * 0.2;
    if (thump > 0 && this.time - this.lastThump > 0.09) {
      this.lastThump = this.time;
      this.emit({ type: 'thump', force: thump });
    }
  }

  private updatePrizes() {
    for (const p of this.plushes) {
      if (p.state === 'won') continue;
      const t = p.body.translation();
      if (p.state === 'bed') {
        const inChute = t.x < CHUTE.x1 && t.z > CHUTE.z0;
        if (inChute && t.y < BOX.floorY - 0.02) {
          p.state = 'chute';
          this.wonThisPlay = true;
          this.emit({ type: 'chute', plush: p });
        }
      } else {
        p.chuteTime += DT;
        if (p.chuteTime > 1.1) {
          p.state = 'won';
          this.emit({ type: 'win', plush: p });
          for (const [handle, owner] of this.plushColliders) {
            if (owner === p) this.plushColliders.delete(handle);
          }
          this.world.removeRigidBody(p.body);
        }
      }
    }
    for (let i = this.plushes.length - 1; i >= 0; i--) {
      if (this.plushes[i].state === 'won') this.plushes.splice(i, 1);
    }
    if (this.phase === 'lift' && this.heldBefore) {
      if (!this.isHeld(this.heldBefore)) {
        this.emit({ type: 'slip', plush: this.heldBefore });
        this.heldBefore = null;
      }
    } else if (this.phase === 'lift' && this.phaseTime > 0.5) {
      this.heldBefore = this.heldPlush();
    } else if (this.phase === 'return' && this.heldAtTop && !this.isHeld(this.heldAtTop)) {
      this.emit({ type: 'slip', plush: this.heldAtTop });
      this.heldAtTop = null;
    }
  }

  private heldBefore: Plush | null = null;

  private isHeld(p: Plush) {
    if (p.state !== 'bed') return false;
    const t = p.body.translation();
    return Math.hypot(t.x - this.hubPos.x, t.z - this.hubPos.z) < 0.14 && this.hubPos.y - t.y < 0.34;
  }

  /** The prize currently hanging in the claw, if any. */
  heldPlush(): Plush | null {
    for (const p of this.plushes) {
      if (p.state === 'bed' && p.body.translation().y > BOX.floorY + 0.24 && this.isHeld(p)) return p;
    }
    return null;
  }

  get remaining() {
    return this.plushes.filter((p) => p.state === 'bed').length;
  }
}
