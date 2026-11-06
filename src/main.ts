import '@fontsource/bungee/latin-400.css';
import * as THREE from 'three';
import './style.css';
import { Sound } from './audio';
import { Cabinet } from './render/cabinet';
import { CameraRig } from './render/cameraRig';
import { ClawModel } from './render/clawModel';
import { PlushField } from './render/plush';
import { pickQuality, Stage } from './render/stage';
import { PHYSICS_HZ } from './sim/config';
import { Machine, type Plush } from './sim/machine';
import { SPECIES } from './sim/species';
import { Ui, type ActionMode, type PrizeRecord } from './ui';

const SAVE_KEY = 'lucky-claw-v1';
const START_COINS = 10;
const RESTOCK_BELOW = 14;

interface Save {
  coins: number;
  prizes: PrizeRecord[];
  muted: boolean;
}

function loadSave(): Save {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return { coins: START_COINS, prizes: [], muted: false, ...JSON.parse(raw) };
  } catch {
    // Private mode or blocked storage: play without saving.
  }
  return { coins: START_COINS, prizes: [], muted: false };
}

function writeSave(s: Save) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    // Quota or blocked storage: progress just won't persist.
  }
}

/** Renders a prize on its own, straight to the canvas, and grabs the pixels. */
function takePortrait(stage: Stage, field: PlushField, plush: Plush) {
  const scene = new THREE.Scene();
  scene.environment = stage.scene.environment;
  scene.environmentIntensity = 0.5;
  scene.background = new THREE.Color(0x2a1548);
  const key = new THREE.DirectionalLight(0xfff0e0, 2.4);
  key.position.set(0.6, 1, 1.4);
  scene.add(key, new THREE.AmbientLight(0xffffff, 0.5));
  const model = field.cloneForPortrait(plush);
  model.rotation.y = -0.3;
  model.updateMatrixWorld(true);
  scene.add(model);
  const camera = new THREE.PerspectiveCamera(24, 1, 0.05, 5);
  camera.position.set(0, 0.06, 0.62);
  camera.lookAt(0, 0.035, 0);
  const canvas = stage.renderer.domElement;
  const size = Math.min(canvas.width, canvas.height);
  stage.renderer.setRenderTarget(null);
  stage.renderer.setViewport(0, 0, size / stage.renderer.getPixelRatio(), size / stage.renderer.getPixelRatio());
  stage.renderer.render(scene, camera);
  const out = document.createElement('canvas');
  out.width = out.height = 160;
  out.getContext('2d')?.drawImage(canvas, 0, canvas.height - size, size, size, 0, 0, 160, 160);
  stage.renderer.setViewport(0, 0, canvas.width / stage.renderer.getPixelRatio(), canvas.height / stage.renderer.getPixelRatio());
  return out.toDataURL('image/jpeg', 0.82);
}

async function boot() {
  await Promise.all([document.fonts.load('40px Bungee'), document.fonts.ready]).catch(() => undefined);

  const quality = pickQuality();
  const save = loadSave();
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const stage = new Stage(canvas, quality);
  const machine = await Machine.create({ plushCount: quality.mobile ? 22 : 26 });
  machine.addCredits(save.coins);

  const cabinet = new Cabinet(stage.scene, stage.reflections, quality);
  const claw = new ClawModel(stage.scene, machine);
  const field = new PlushField(stage.scene, machine, quality);
  const rig = new CameraRig(stage.camera, canvas);
  const sound = new Sound();
  sound.muted = save.muted;

  let cardPending = false;

  // iOS only starts audio from a completed tap, not from pointerdown.
  for (const type of ['pointerup', 'touchend', 'click', 'keydown']) {
    window.addEventListener(type, () => sound.unlock(), { passive: true });
  }

  const persist = () => {
    save.coins = machine.credits;
    writeSave(save);
  };

  const ui = new Ui({
    onAction() {
      sound.unlock();
      if (cardPending) return;
      if (machine.phase === 'idle') {
        if (machine.credits > 0) {
          machine.insertCoin();
          persist();
        } else {
          machine.addCredits(START_COINS);
          sound.coin();
          persist();
          ui.toast('The attendant slides you ten more coins');
        }
      } else if (machine.pressDrop()) {
        sound.button();
        cabinet.pressButton();
      }
    },
    onView() {
      sound.unlock();
      rig.toggleSide();
    },
    onMute() {
      sound.unlock();
      sound.setMuted(!sound.muted);
      save.muted = sound.muted;
      ui.setMuteLabel(sound.muted);
      persist();
    },
  });
  ui.setMuteLabel(sound.muted);
  ui.setPrizes(save.prizes);

  machine.on((e) => {
    switch (e.type) {
      case 'coin':
        sound.coin();
        break;
      case 'start':
        rig.setPlaying(true);
        ui.hideHint();
        ui.toast('Line it up. Peek from the side to judge depth.', 2600);
        break;
      case 'open':
        sound.solenoid(false);
        break;
      case 'touch':
        sound.touch();
        break;
      case 'close':
        sound.solenoid(true);
        break;
      case 'home':
        sound.clack();
        rig.bump(0.003);
        break;
      case 'release':
        sound.solenoid(false);
        break;
      case 'slip':
        sound.slip();
        ui.toast(`${e.plush.name} slipped!`);
        break;
      case 'chute':
        sound.prizeDrop();
        cabinet.openFlap();
        rig.bump(0.008);
        break;
      case 'win': {
        const record: PrizeRecord = {
          name: e.plush.name,
          label: SPECIES[e.plush.species].label,
          photo: takePortrait(stage, field, e.plush),
        };
        save.prizes.push(record);
        persist();
        sound.win();
        cabinet.celebrate(5.5);
        ui.setPrizes(save.prizes);
        navigator.vibrate?.([40, 50, 40, 50, 120]);
        // Let the lights and fanfare land before the card covers them.
        cardPending = true;
        window.setTimeout(() => {
          cardPending = false;
          ui.showWin(record);
        }, 1500);
        break;
      }
      case 'lose':
        sound.lose();
        ui.toast('So close! Try again');
        break;
      case 'thump':
        sound.thump(e.force);
        break;
      case 'ready':
        if (machine.remaining < RESTOCK_BELOW) {
          machine.restock(10);
          field.sync();
          ui.toast('The attendant restocks the machine');
        }
        break;
    }
  });

  const STEP = 1 / PHYSICS_HZ;
  let acc = 0;
  let last = performance.now();
  let lastStickDir = 0;
  let lastRope = machine.rope;
  let lastMode: ActionMode | null = null;
  let lastCoins = -1;
  let lastTimerShown = -1;
  let framesDrawn = 0;

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const raw = (now - last) / 1000;
    last = now;
    const dt = Math.min(raw, 0.05);

    const stick = ui.poll();
    const move = rig.stickToMachine(stick.x, stick.y);
    machine.stick.x = machine.phase === 'play' ? move.x : 0;
    machine.stick.z = machine.phase === 'play' ? move.z : 0;

    // Microswitch click when the stick leaves or changes direction.
    const dir = Math.hypot(stick.x, stick.y) > 0.3 ? 1 + Math.round(Math.atan2(stick.y, stick.x) / (Math.PI / 4)) : 0;
    if (dir !== lastStickDir) {
      lastStickDir = dir;
      if (machine.phase === 'play') sound.stickClick();
    }

    acc += dt;
    while (acc >= STEP) {
      machine.tick();
      acc -= STEP;
    }
    field.sync();
    field.update(dt);
    claw.update();

    const gantry = Math.hypot(machine.trolley.vx, machine.trolley.vz);
    const winch = dt > 0 ? (machine.rope - lastRope) / dt : 0;
    lastRope = machine.rope;
    const playing = machine.phase !== 'idle';
    sound.update(dt, gantry, winch, playing);

    cabinet.update(dt, machine, stick);
    rig.update(dt, ui.bottomInset);
    ui.setViewLabel(rig.isSide ? 'Front view' : 'Side view');

    const mode: ActionMode =
      machine.phase === 'idle' ? (machine.credits > 0 ? 'coin' : 'refill') : machine.phase === 'play' ? 'drop' : 'busy';
    if (mode !== lastMode) {
      lastMode = mode;
      ui.setAction(mode);
    }
    if (machine.credits !== lastCoins) {
      lastCoins = machine.credits;
      ui.setCoins(machine.credits);
    }
    const shown = machine.phase === 'play' ? Math.ceil(machine.timeLeft) : -1;
    if (shown !== lastTimerShown) {
      lastTimerShown = shown;
      ui.setTimer(shown < 0 ? null : machine.timeLeft);
      if (shown >= 0 && shown <= 5) sound.stickClick();
    }
    cabinet.setDisplay(
      machine.phase === 'idle'
        ? machine.credits > 0
          ? 'PLAY'
          : 'COIN'
        : machine.phase === 'play'
          ? String(shown).padStart(2, '0')
          : '------',
    );

    stage.render();
    stage.adaptResolution(raw);
    // Shaders compile on the first frame; keep the curtain up until that's done.
    if (++framesDrawn === 2) ui.ready();
  };
  requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', () => {
    last = performance.now();
    sound.setSuspended(document.hidden);
  });

  if (import.meta.env.DEV) {
    Object.assign(window, { __claw: { machine, stage, rig, field, ui, cabinet } });
  }
}

boot().catch((err) => {
  console.error(err);
  const note = document.querySelector('.loading-note');
  if (note) note.textContent = 'This device could not start the game. WebGL2 is required.';
});
