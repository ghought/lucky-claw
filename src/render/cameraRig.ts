import * as THREE from 'three';

const TAU = Math.PI * 2;

export interface Framing {
  halfW: number;
  yMin: number;
  yMax: number;
  depth: number;
}

const WHOLE: Framing = { halfW: 0.6, yMin: -0.02, yMax: 2.2, depth: 0.62 };
const PLAY: Framing = { halfW: 0.47, yMin: 0.74, yMax: 1.84, depth: 0.62 };

/** The player's head: stands at the machine, steps round the side to judge depth. */
export class CameraRig {
  yaw = 0;
  private yawGoal = 0;
  private dragYaw = 0;
  private dragPitch = 0;
  private pitch = 0.17;
  private focus = 0;
  private focusGoal = 0;
  private lookY = 1.1;
  private dist = 4;
  private parallax = { x: 0, y: 0 };
  private shake = 0;
  private drag: { id: number; x: number; y: number } | null = null;

  constructor(private camera: THREE.PerspectiveCamera, canvas: HTMLElement) {
    canvas.addEventListener('pointerdown', (e) => {
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        this.parallax.x = (e.clientX / window.innerWidth - 0.5) * 2;
        this.parallax.y = (e.clientY / window.innerHeight - 0.5) * 2;
      }
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.yawGoal -= (e.clientX - this.drag.x) * 0.006;
      this.dragPitch += (e.clientY - this.drag.y) * 0.003;
      this.yawGoal = THREE.MathUtils.clamp(this.yawGoal, -1.75, 1.75);
      this.dragPitch = THREE.MathUtils.clamp(this.dragPitch, -0.14, 0.5);
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    });
    const end = (e: PointerEvent) => {
      if (this.drag?.id === e.pointerId) this.drag = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  setPlaying(on: boolean) {
    this.focusGoal = on ? 1 : 0;
  }

  /** Flips between standing in front and peering in from the right. */
  toggleSide() {
    const atFront = Math.abs(this.yawGoal) < Math.PI / 4;
    this.yawGoal = atFront ? Math.PI / 2 : 0;
    this.dragPitch = 0;
    return atFront;
  }

  get isSide() {
    return Math.abs(this.yawGoal) >= Math.PI / 4;
  }

  bump(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  /** Stick input in machine axes, rotated so "right" is always screen-right. */
  stickToMachine(x: number, y: number) {
    // Snap to the nearest side so the axes stay square while the view drifts.
    const snap = Math.round(this.yaw / (Math.PI / 2)) * (Math.PI / 2);
    const c = Math.cos(snap);
    const s = Math.sin(snap);
    return { x: c * x - s * y, z: -s * x - c * y };
  }

  private fit(f: Framing, aspect: number) {
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const halfH = (f.yMax - f.yMin) / 2;
    return Math.max(halfH / t, f.halfW / (t * aspect)) + f.depth;
  }

  update(dt: number, insetPx: number) {
    const k = 1 - Math.exp(-dt * 4.5);
    this.yaw += (this.yawGoal - this.yaw) * k;
    this.focus += (this.focusGoal - this.focus) * (1 - Math.exp(-dt * 2.2));
    this.dragYaw += (this.parallax.x * 0.05 - this.dragYaw) * (1 - Math.exp(-dt * 3));
    this.shake *= Math.exp(-dt * 7);

    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / Math.max(1, h - insetPx);
    const dist = THREE.MathUtils.lerp(this.fit(WHOLE, aspect), this.fit(PLAY, aspect), this.focus);
    this.dist += (dist - this.dist) * (1 - Math.exp(-dt * 6));
    const look = THREE.MathUtils.lerp((WHOLE.yMin + WHOLE.yMax) / 2, (PLAY.yMin + PLAY.yMax) / 2 - 0.02, this.focus);
    this.lookY += (look - this.lookY) * (1 - Math.exp(-dt * 6));

    const pitch = this.pitch * this.focus + 0.05 + this.dragPitch + this.parallax.y * 0.012;
    const yaw = (this.yaw + this.dragYaw) % TAU;
    const cp = Math.cos(pitch);
    this.camera.position.set(
      Math.sin(yaw) * cp * this.dist,
      this.lookY + Math.sin(pitch) * this.dist,
      Math.cos(yaw) * cp * this.dist,
    );
    this.camera.lookAt(0, this.lookY, 0);
    if (this.shake > 1e-4) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
    }
    if (insetPx > 0) this.camera.setViewOffset(w, h, 0, insetPx / 2, w, h);
    else this.camera.clearViewOffset();
  }
}
