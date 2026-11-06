const el = <T extends HTMLElement>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
};

export type ActionMode = 'coin' | 'drop' | 'busy' | 'refill';

export interface PrizeRecord {
  name: string;
  label: string;
  photo: string;
}

function photoFile(p: PrizeRecord) {
  const bytes = Uint8Array.from(atob(p.photo.split(',')[1]), (c) => c.charCodeAt(0));
  return new File([bytes], `${p.name.toLowerCase()}-lucky-claw.jpg`, { type: 'image/jpeg' });
}

export interface UiHandlers {
  onAction(): void;
  onView(): void;
  onMute(): void;
}

/** DOM overlay: the on-screen joystick, action button and readouts. */
export class Ui {
  readonly stick = { x: 0, y: 0 };
  private keys = new Set<string>();
  private knob = el('stick-knob');
  private pad = el('stick');
  private action = el<HTMLButtonElement>('action');
  private toastEl = el('toast');
  private toastTimer = 0;
  private padPointer: number | null = null;
  private viewLabel = '';
  private lastWin?: PrizeRecord;
  private padStick = { x: 0, y: 0 };

  constructor(handlers: UiHandlers) {
    this.bindPad();
    this.action.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handlers.onAction();
    });
    el('view').addEventListener('click', handlers.onView);
    el('mute').addEventListener('click', handlers.onMute);
    el('prizes').addEventListener('click', () => {
      el('shelf').hidden = false;
    });
    el('shelf-close').addEventListener('click', () => {
      el('shelf').hidden = true;
    });
    el('win-ok').addEventListener('click', () => {
      el('win').hidden = true;
    });
    el('share').addEventListener('click', () => void this.share());
    el('win-share').addEventListener('click', () => void this.share(this.lastWin));

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === ' ' || k === 'enter') {
        e.preventDefault();
        if (!el('win').hidden) el('win').hidden = true;
        else handlers.onAction();
      } else if (k === 'v') handlers.onView();
      else if (k === 'm') handlers.onMute();
      if (k.startsWith('arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private bindPad() {
    const update = (e: PointerEvent) => {
      const r = this.pad.getBoundingClientRect();
      const radius = r.width / 2 - 26;
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > radius) {
        dx *= radius / d;
        dy *= radius / d;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.padStick.x = dx / radius;
      this.padStick.y = -dy / radius;
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.padPointer) return;
      this.padPointer = null;
      this.padStick.x = this.padStick.y = 0;
      this.knob.style.transform = '';
    };
    this.pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.padPointer = e.pointerId;
      this.pad.setPointerCapture(e.pointerId);
      update(e);
    });
    this.pad.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.padPointer) update(e);
    });
    this.pad.addEventListener('pointerup', end);
    this.pad.addEventListener('pointercancel', end);
  }

  /** Merges touch, keyboard and gamepad into one stick reading. */
  poll() {
    let x = this.padStick.x;
    let y = this.padStick.y;
    const held = (...names: string[]) => names.some((n) => this.keys.has(n));
    if (held('arrowleft', 'a')) x -= 1;
    if (held('arrowright', 'd')) x += 1;
    if (held('arrowup', 'w')) y += 1;
    if (held('arrowdown', 's')) y -= 1;
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      const [ax = 0, ay = 0] = pad.axes;
      if (Math.abs(ax) > 0.18) x += ax;
      if (Math.abs(ay) > 0.18) y -= ay;
      if (pad.buttons[14]?.pressed) x -= 1;
      if (pad.buttons[15]?.pressed) x += 1;
      if (pad.buttons[12]?.pressed) y += 1;
      if (pad.buttons[13]?.pressed) y -= 1;
    }
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    this.stick.x = x;
    this.stick.y = y;
    return this.stick;
  }

  setAction(mode: ActionMode) {
    const labels: Record<ActionMode, string> = {
      coin: 'Insert coin',
      drop: 'Drop!',
      busy: '…',
      refill: 'Free coins',
    };
    this.action.textContent = labels[mode];
    this.action.classList.toggle('coin', mode === 'coin' || mode === 'refill');
    this.action.classList.toggle('busy', mode === 'busy');
  }

  hideHint() {
    el('hint').hidden = true;
  }

  setCoins(n: number) {
    el('coins').textContent = String(n);
  }

  setTimer(seconds: number | null) {
    const box = el('timer-box');
    box.hidden = seconds === null;
    if (seconds === null) return;
    el('timer').textContent = String(Math.ceil(seconds));
    box.classList.toggle('low', seconds <= 5);
  }

  setViewLabel(text: string) {
    if (text === this.viewLabel) return;
    this.viewLabel = text;
    el('view').textContent = text;
  }

  setMuteLabel(muted: boolean) {
    el('mute').textContent = muted ? 'Sound off' : 'Sound on';
  }

  toast(text: string, ms = 1900) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  /** Uses the phone's share sheet where there is one, otherwise copies the link. */
  private async share(prize?: PrizeRecord) {
    const url = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? location.href;
    const text = prize
      ? `I won ${prize.name} the ${prize.label} on Lucky Claw! Can you beat the claw?`
      : 'Can you beat the claw? Try Lucky Claw, a realistic 3D arcade claw machine.';
    const data: ShareData = { title: 'Lucky Claw', text, url };
    const file = prize && photoFile(prize);
    try {
      if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ ...data, files: [file] });
      else if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        this.toast('Link copied. Paste it anywhere to share.');
      }
    } catch (err) {
      // Closing the share sheet isn't a failure.
      if ((err as Error).name !== 'AbortError') this.toast(`Couldn't share. The link is ${url}`, 5000);
    }
  }

  showWin(p: PrizeRecord) {
    this.lastWin = p;
    el<HTMLImageElement>('win-photo').src = p.photo;
    el('win-name').textContent = `${p.name} the ${p.label}`;
    el('win').hidden = false;
  }

  setPrizes(list: PrizeRecord[]) {
    el('prize-count').textContent = String(list.length);
    const grid = el('shelf-grid');
    grid.replaceChildren(
      ...list
        .slice()
        .reverse()
        .map((p) => {
          const fig = document.createElement('figure');
          const img = document.createElement('img');
          img.src = p.photo;
          img.alt = `${p.name} the ${p.label}`;
          const cap = document.createElement('figcaption');
          cap.textContent = p.name;
          fig.append(img, cap);
          return fig;
        }),
    );
    el('shelf-empty').hidden = list.length > 0;
  }

  /** Height the controls cover at the bottom, so the camera can frame above them. */
  get bottomInset() {
    return window.innerHeight > window.innerWidth ? this.pad.getBoundingClientRect().height + 24 : 0;
  }

  ready() {
    el('loading').classList.add('done');
  }
}
