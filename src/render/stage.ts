import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { backdropTexture, carpetTexture, radialGlowTexture } from './textures';

export interface Quality {
  mobile: boolean;
  maxPixelRatio: number;
  shadowSize: number;
  furShells: number;
  bloom: boolean;
}

export function pickQuality(): Quality {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 820;
  const mobile = coarse && small;
  return mobile
    ? { mobile, maxPixelRatio: 2, shadowSize: 1024, furShells: 8, bloom: true }
    : { mobile, maxPixelRatio: 2, shadowSize: 2048, furShells: 14, bloom: true };
}

/** A neon-lit room for reflections; the claw's chrome lives or dies on this. */
function buildEnvironment(renderer: THREE.WebGLRenderer) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x05050a);
  const panel = (w: number, h: number, color: number, power: number, x: number, y: number, z: number) => {
    const c = new THREE.Color(color).multiplyScalar(power);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(20, 10, 20),
    new THREE.MeshBasicMaterial({ color: 0x0c0a16, side: THREE.BackSide }),
  );
  env.add(shell);
  // Ceiling troffers.
  for (const x of [-5, 0, 5]) {
    for (const z of [-5, 0, 5]) panel(2.4, 0.9, 0xfff1dc, 4.5, x, 4.8, z);
  }
  // Neighbouring machines and wall neon.
  panel(2.5, 2.5, 0xff2e8b, 5, -8, 1, 3);
  panel(2.5, 2.5, 0x26e0ff, 5, 8, 1, 2);
  panel(5, 0.3, 0xffb040, 9, 0, 2.6, 9);
  panel(3, 2, 0x8a5bff, 3, -4, 0.8, -8);
  panel(3, 2, 0x35ff9b, 2.5, 5, 0.8, -8);
  panel(0.5, 4, 0xffffff, 3.5, 7.5, 1, 7);
  panel(0.5, 4, 0xffffff, 3.5, -7.5, 1, 7);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: 0x120c1e }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2;
  env.add(floor);

  const cubeTarget = new THREE.WebGLCubeRenderTarget(256, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const cube = new THREE.CubeCamera(0.1, 50, cubeTarget);
  cube.update(renderer, env);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const map = pmrem.fromCubemap(cubeTarget.texture).texture;
  pmrem.dispose();
  return { map, cube: cubeTarget.texture };
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.05, 40);
  readonly reflections: THREE.Texture;
  private composer: EffectComposer;
  private bloom?: UnrealBloomPass;
  private pixelRatio: number;
  private slowFrames = 0;
  private fastFrames = 0;

  constructor(canvas: HTMLCanvasElement, readonly quality: Quality) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.pixelRatio = Math.min(window.devicePixelRatio, quality.maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);

    const env = buildEnvironment(this.renderer);
    this.scene.environment = env.map;
    this.scene.environmentIntensity = 0.55;
    this.reflections = env.cube;
    this.scene.background = new THREE.Color(0x05040b);
    this.scene.fog = new THREE.Fog(0x0e0b1c, 4.6, 9.5);

    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: quality.mobile ? 2 : 4,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (quality.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.2, 0.5, 1.15);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());

    this.buildRoom();
    this.resize();
    // Catches rotation, mobile URL bars and pages loaded in a hidden tab.
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  private buildRoom() {
    // Room light so the carpet carries on into the gloom instead of stopping.
    this.scene.add(new THREE.HemisphereLight(0xcdb8ff, 0x1a1030, 0.75));
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(7.02, 48),
      new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 0.95, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(7, 7, 5, 48, 1, true),
      new THREE.MeshBasicMaterial({ map: backdropTexture(), side: THREE.BackSide, color: 0xffffff, fog: false }),
    );
    wall.position.y = 2.5;
    this.scene.add(wall);

    // Baked contact shadow and the pool of light the machine throws on the carpet.
    const glow = radialGlowTexture();
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(2.3, 2.3),
      new THREE.MeshBasicMaterial({ map: glow, color: 0x000000, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.004;
    this.scene.add(contact);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 2.2),
      new THREE.MeshBasicMaterial({
        map: glow,
        color: new THREE.Color(0.5, 0.2, 0.22),
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.006, 1.0);
    this.scene.add(pool);

    const key = new THREE.SpotLight(0xffe7cc, 7, 7, 0.72, 0.9, 1.5);
    key.position.set(0.8, 3.6, 2.7);
    key.target.position.set(0, 0.8, 0.2);
    this.scene.add(key, key.target);
  }

  resize() {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    if (this.bloom) this.bloom.resolution.set(w * 0.5, h * 0.5);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Trades resolution for frame rate so slow phones stay playable. */
  adaptResolution(frameSeconds: number) {
    if (frameSeconds > 1 / 40) {
      this.slowFrames++;
      this.fastFrames = 0;
    } else if (frameSeconds < 1 / 58) {
      this.fastFrames++;
      this.slowFrames = Math.max(0, this.slowFrames - 1);
    }
    const ceiling = Math.min(window.devicePixelRatio, this.quality.maxPixelRatio);
    if (this.slowFrames > 45 && this.pixelRatio > 0.75) {
      this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.25);
      this.slowFrames = 0;
      this.resize();
    } else if (this.fastFrames > 600 && this.pixelRatio < ceiling) {
      this.pixelRatio = Math.min(ceiling, this.pixelRatio + 0.25);
      this.fastFrames = 0;
      this.resize();
    }
  }

  render() {
    if (this.renderer.domElement.width === 0) return;
    this.composer.render();
  }
}
