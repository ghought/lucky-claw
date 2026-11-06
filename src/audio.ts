/** Every sound here is synthesised; there are no audio files to load. */
export class Sound {
  private ctx?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private motor?: { osc: OscillatorNode; osc2: OscillatorNode; filter: BiquadFilterNode; gain: GainNode };
  private winch?: { osc: OscillatorNode; gain: GainNode };
  private melodyTimer = 0;
  private melodyStep = 0;
  private playing = false;
  muted = false;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.startMotor();
    this.startWinch();
    this.startRoomTone();
  }

  /** Silences the room tone and motors while the tab is in the background. */
  setSuspended(hidden: boolean) {
    if (!this.ctx) return;
    void (hidden ? this.ctx.suspend() : this.ctx.resume());
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.02);
  }

  private startRoomTone() {
    const { ctx, master, noise } = this;
    if (!ctx || !master || !noise) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.022;
    src.connect(low).connect(g).connect(master);
    src.start();
  }

  private startMotor() {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 90;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 181;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 520;
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(master);
    osc.start();
    osc2.start();
    this.motor = { osc, osc2, filter, gain };
  }

  private startWinch() {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 150;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(master);
    osc.start();
    this.winch = { osc, gain };
  }

  /** Called each frame with gantry and winch speeds in m/s. */
  update(dt: number, gantry: number, winch: number, playing: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (this.motor) {
      const s = Math.min(1, gantry / 0.27);
      this.motor.gain.gain.setTargetAtTime(s * 0.05, t, 0.04);
      this.motor.osc.frequency.setTargetAtTime(70 + s * 70, t, 0.05);
      this.motor.osc2.frequency.setTargetAtTime(141 + s * 140, t, 0.05);
    }
    if (this.winch) {
      const s = Math.min(1, Math.abs(winch) / 0.3);
      this.winch.gain.gain.setTargetAtTime(s * 0.06, t, 0.05);
      this.winch.osc.frequency.setTargetAtTime((winch > 0 ? 120 : 170) + s * 60, t, 0.06);
    }
    this.playing = playing;
    this.melodyTimer -= dt;
    if (this.playing && this.melodyTimer <= 0) {
      this.melodyTimer = 0.16;
      this.melodyNote();
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number) {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, freq: number, q: number, vol: number, delay = 0) {
    const { ctx, master, noise } = this;
    if (!ctx || !master || !noise) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.02);
  }

  /** Original eight-bar loop in C major pentatonic, kept quiet like a real cabinet. */
  private melodyNote() {
    const song = [
      523, 0, 659, 784, 0, 659, 880, 0, 784, 659, 0, 587, 523, 0, 587, 659,
      784, 0, 880, 1047, 0, 880, 784, 0, 659, 784, 0, 659, 587, 0, 523, 0,
    ];
    const bass = [131, 0, 0, 0, 196, 0, 0, 0, 175, 0, 0, 0, 196, 0, 0, 0];
    const n = song[this.melodyStep % song.length];
    const b = bass[this.melodyStep % bass.length];
    if (n) this.tone(n, 0.14, 'square', 0.014);
    if (b) this.tone(b, 0.3, 'triangle', 0.035);
    this.melodyStep++;
  }

  coin() {
    this.tone(2350, 0.09, 'triangle', 0.09);
    this.tone(3520, 0.32, 'sine', 0.06, 0.05);
    this.burst(0.05, 5200, 3, 0.05, 0.11);
    this.burst(0.05, 4300, 3, 0.04, 0.2);
    this.tone(1760, 0.1, 'triangle', 0.05, 0.24);
  }

  stickClick() {
    this.burst(0.018, 2600, 1.5, 0.05);
  }

  button() {
    this.burst(0.03, 1300, 1, 0.13);
    this.tone(180, 0.05, 'square', 0.04);
  }

  solenoid(closing: boolean) {
    this.burst(0.05, closing ? 700 : 1100, 1.2, 0.2);
    this.tone(closing ? 95 : 130, 0.09, 'square', 0.07);
  }

  touch() {
    this.burst(0.09, 320, 0.8, 0.09);
  }

  thump(force: number) {
    const v = Math.min(1, force / 40);
    this.burst(0.09, 200 + v * 120, 0.7, 0.03 + v * 0.1);
  }

  /** Stop at the top of the travel: the hard limit-switch clack. */
  clack() {
    this.burst(0.03, 1800, 1.5, 0.1);
  }

  slip() {
    this.tone(520, 0.34, 'triangle', 0.05, 0, 240);
  }

  lose() {
    this.tone(392, 0.2, 'square', 0.025);
    this.tone(330, 0.2, 'square', 0.025, 0.18);
    this.tone(262, 0.42, 'square', 0.025, 0.36);
  }

  prizeDrop() {
    this.burst(0.16, 240, 0.8, 0.16);
    this.burst(0.1, 420, 0.8, 0.08, 0.24);
  }

  win() {
    const line = [523, 659, 784, 1047, 784, 1047, 1319, 1568];
    line.forEach((f, i) => {
      this.tone(f, 0.17, 'square', 0.05, i * 0.095);
      this.tone(f / 2, 0.17, 'triangle', 0.06, i * 0.095);
    });
    for (let i = 0; i < 14; i++) this.tone(2000 + Math.random() * 2000, 0.05, 'sine', 0.018, 0.8 + i * 0.07);
  }
}
