// All sound is synthesised in code: effects, ambience and a generative plucked-string score.

type Ctx = AudioContext;

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
  ambience: number;
}

export class Audio {
  private ctx: Ctx | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private ksCache = new Map<number, AudioBuffer>();
  private amb: Record<string, { gain: GainNode; target: number }> = {};
  listener = { x: 0, y: 0 };
  vol: Volumes = { master: 0.8, music: 0.55, sfx: 0.8, ambience: 0.7 };
  private nextNote = 0;
  private phrase: number[] = [];
  mood: 'morning' | 'day' | 'evening' | 'night' = 'day';
  private lastPlayed = new Map<string, number>();

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.6, 2.2);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);
    for (const b of [this.musicBus, this.sfxBus, this.ambBus]) b.connect(this.master);
    this.musicBus.connect(this.reverbSend);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startAmbience();
  }

  get running(): boolean {
    return !!this.ctx;
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.5, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.ambBus.gain.setTargetAtTime(this.vol.ambience * 0.6, t, 0.05);
  }

  private impulse(sec: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  // ------------------------------------------------------------------ building blocks

  private env(g: GainNode, t: number, a: number, peak: number, dec: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  private noise(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, out: AudioNode, sweepTo?: number, attack = 0.005): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, attack, peak, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + attack + 0.05);
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, out: AudioNode, attack = 0.004): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, attack, peak, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + attack + 0.05);
  }

  /** Metallic ping: a few inharmonic partials. */
  private ping(t: number, f: number, dur: number, peak: number, out: AudioNode): void {
    for (const [m, a] of [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.93, 0.12]]) this.tone(t, 'sine', f * m, f * m, dur / m ** 0.3, peak * a, out);
  }

  // ------------------------------------------------------------------ effects

  play(name: string, x?: number, y?: number, vol = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // Do not stack the same sound many times in one instant
    const now = ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < 0.03) return;
    this.lastPlayed.set(name, now);
    let v = vol;
    let pan = 0;
    if (x !== undefined && y !== undefined) {
      const dx = x - this.listener.x;
      const dy = y - this.listener.y;
      const d = Math.hypot(dx, dy);
      v *= Math.max(0, 1 - d / 26) ** 1.4;
      pan = Math.max(-0.8, Math.min(0.8, (dx - dy) / 14));
      if (v < 0.01) return;
    }
    const out = ctx.createGain();
    out.gain.value = v;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    out.connect(p).connect(this.sfxBus);
    const t = now + 0.005;
    const wet = (amt: number) => {
      const s = ctx.createGain();
      s.gain.value = amt;
      out.connect(s).connect(this.reverbSend);
    };
    switch (name) {
      case 'step':
        this.noise(t, 0.05, 'lowpass', 700, 0.7, 0.25, out);
        break;
      case 'step_hard':
        this.noise(t, 0.04, 'bandpass', 1800, 1.2, 0.2, out);
        break;
      case 'step_water':
        this.noise(t, 0.12, 'bandpass', 900, 0.8, 0.3, out, 2400);
        break;
      case 'hoe':
        this.tone(t, 'sine', 120, 55, 0.12, 0.5, out);
        this.noise(t, 0.14, 'lowpass', 1200, 0.6, 0.45, out);
        break;
      case 'thud':
        this.tone(t, 'sine', 90, 50, 0.1, 0.35, out);
        break;
      case 'water':
        this.noise(t, 0.35, 'bandpass', 1400, 1.5, 0.3, out, 700, 0.04);
        break;
      case 'refill':
        this.noise(t, 0.5, 'bandpass', 500, 2, 0.35, out, 1500, 0.03);
        this.tone(t + 0.1, 'sine', 300, 600, 0.3, 0.06, out);
        break;
      case 'chop':
        this.tone(t, 'triangle', 220, 140, 0.09, 0.5, out);
        this.noise(t, 0.08, 'bandpass', 1500, 1, 0.4, out);
        wet(0.3);
        break;
      case 'fell':
        this.tone(t, 'sawtooth', 300, 90, 0.5, 0.08, out, 0.05);
        this.tone(t + 0.45, 'sine', 70, 40, 0.35, 0.6, out);
        this.noise(t + 0.45, 0.4, 'lowpass', 600, 0.6, 0.5, out);
        wet(0.4);
        break;
      case 'rock':
        this.ping(t, 900, 0.12, 0.2, out);
        this.noise(t, 0.08, 'highpass', 2000, 0.8, 0.3, out);
        break;
      case 'clank':
        this.ping(t, 640 + Math.random() * 80, 0.35, 0.25, out);
        wet(0.3);
        break;
      case 'break':
        this.noise(t, 0.3, 'lowpass', 1800, 0.6, 0.5, out, 300);
        this.tone(t, 'sine', 80, 40, 0.25, 0.4, out);
        break;
      case 'swish':
      case 'roll':
        this.noise(t, 0.14, 'bandpass', 900, 1.2, 0.25, out, 3500, 0.03);
        break;
      case 'slash_hit':
        this.noise(t, 0.12, 'lowpass', 900, 0.8, 0.6, out);
        this.tone(t, 'sine', 140, 60, 0.12, 0.5, out);
        break;
      case 'shot':
        this.noise(t, 0.25, 'lowpass', 4000, 0.5, 1.0, out, 400, 0.001);
        this.tone(t, 'sine', 160, 40, 0.18, 0.9, out, 0.001);
        wet(0.9);
        break;
      case 'click':
        this.noise(t, 0.02, 'highpass', 3000, 1, 0.3, out);
        break;
      case 'harvest':
        this.tone(t, 'sine', 320, 760, 0.09, 0.25, out);
        this.noise(t, 0.12, 'highpass', 2500, 0.6, 0.15, out);
        break;
      case 'plant':
        this.noise(t, 0.08, 'lowpass', 500, 0.6, 0.3, out);
        break;
      case 'pickup':
        this.tone(t, 'triangle', 660, 660, 0.06, 0.15, out);
        this.tone(t + 0.06, 'triangle', 990, 990, 0.08, 0.13, out);
        break;
      case 'coins':
        for (let i = 0; i < 4; i++) this.ping(t + i * 0.06, 2200 + Math.random() * 600, 0.12, 0.08, out);
        break;
      case 'place':
      case 'drop_crate':
      case 'pickup_obj':
        this.tone(t, 'triangle', 180, 110, 0.1, 0.4, out);
        this.noise(t, 0.06, 'bandpass', 1200, 1, 0.25, out);
        break;
      case 'deny':
        this.tone(t, 'square', 110, 100, 0.12, 0.08, out);
        break;
      case 'hurt':
        this.tone(t, 'sawtooth', 180, 90, 0.18, 0.18, out);
        this.noise(t, 0.12, 'lowpass', 800, 0.8, 0.5, out);
        break;
      case 'down':
        this.tone(t, 'sine', 220, 55, 1.4, 0.3, out, 0.02);
        wet(0.8);
        break;
      case 'husk_far':
        this.moan(t, 0.9, out);
        wet(1.2);
        break;
      case 'husk_growl':
        this.moan(t, 0.5, out, 1.6);
        break;
      case 'husk_swing':
        this.noise(t, 0.18, 'bandpass', 600, 1, 0.3, out, 2000, 0.02);
        break;
      case 'husk_hit':
        this.noise(t, 0.1, 'lowpass', 700, 1, 0.6, out);
        this.tone(t, 'sawtooth', 120, 70, 0.14, 0.12, out);
        break;
      case 'husk_die':
        this.moan(t, 1.1, out, 0.8);
        this.noise(t, 0.3, 'lowpass', 600, 0.6, 0.4, out);
        break;
      case 'spike':
        this.ping(t, 1300, 0.15, 0.15, out);
        this.noise(t, 0.1, 'lowpass', 900, 1, 0.4, out);
        break;
      case 'bash':
        this.tone(t, 'triangle', 140, 80, 0.12, 0.45, out);
        this.noise(t, 0.1, 'lowpass', 1500, 0.8, 0.35, out);
        break;
      case 'truck_arrive':
      case 'truck_leave':
        this.engine(t, 4, out);
        break;
      case 'truck_stop':
        this.tone(t, 'sine', 1900, 1700, 0.4, 0.04, out, 0.05);
        this.noise(t, 0.3, 'lowpass', 400, 0.6, 0.2, out);
        break;
      case 'lantern_on':
        this.noise(t, 0.03, 'highpass', 3000, 1, 0.25, out);
        this.noise(t + 0.03, 0.35, 'bandpass', 700, 3, 0.12, out, 400, 0.05);
        break;
      case 'lantern_off':
        this.noise(t, 0.04, 'highpass', 2500, 1, 0.2, out);
        break;
      case 'eat':
        for (let i = 0; i < 3; i++) this.noise(t + i * 0.11, 0.06, 'bandpass', 1600, 1, 0.3, out);
        break;
      case 'bandage':
      case 'rustle':
        this.noise(t, 0.22, 'highpass', 2000, 0.6, 0.18, out, undefined, 0.04);
        break;
      case 'hire':
      case 'day_end':
        for (const [i, f] of [[0, 392], [1, 494], [2, 587]] as [number, number][]) this.pluck(t + i * 0.09, f, 0.25, out);
        break;
      case 'ui_open':
        this.tone(t, 'triangle', 440, 520, 0.06, 0.08, out);
        break;
      case 'ui_close':
        this.tone(t, 'triangle', 520, 440, 0.06, 0.08, out);
        break;
      case 'ui_click':
        this.noise(t, 0.02, 'bandpass', 2500, 2, 0.15, out);
        break;
    }
  }

  private moan(t: number, dur: number, out: AudioNode, pitch = 1): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const base = (95 + Math.random() * 30) * pitch;
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 0.8, t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5 + Math.random() * 3;
    const lg = ctx.createGain();
    lg.gain.value = base * 0.04;
    lfo.connect(lg).connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    f.Q.value = 6;
    const g = ctx.createGain();
    this.env(g, t, dur * 0.3, 0.12, dur * 0.7);
    o.connect(f).connect(g).connect(out);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.1);
    lfo.stop(t + dur + 0.1);
  }

  private engine(t: number, dur: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(42, t);
    o.frequency.linearRampToValueAtTime(55, t + dur * 0.5);
    o.frequency.linearRampToValueAtTime(38, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 9;
    const lg = ctx.createGain();
    lg.gain.value = 80;
    lfo.connect(lg).connect(f.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.6);
    g.gain.setValueAtTime(0.35, t + dur - 1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(out);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.1);
    lfo.stop(t + dur + 0.1);
  }

  // ------------------------------------------------------------------ plucked strings (Karplus-Strong)

  private ksBuffer(freq: number): AudioBuffer {
    const key = Math.round(freq * 10);
    const hit = this.ksCache.get(key);
    if (hit) return hit;
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 2.4);
    const b = ctx.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    const period = Math.max(2, Math.round(sr / freq));
    const line = new Float32Array(period);
    for (let i = 0; i < period; i++) line[i] = Math.random() * 2 - 1;
    let idx = 0;
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const v = line[idx];
      const next = 0.5 * (v + prev) * 0.996;
      prev = v;
      line[idx] = next;
      d[i] = v * 0.5;
      idx = (idx + 1) % period;
    }
    this.ksCache.set(key, b);
    return b;
  }

  private pluck(t: number, freq: number, peak: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.ksBuffer(freq);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.value = peak;
    src.connect(f).connect(g).connect(out);
    src.start(t);
  }

  /** Called every frame: schedules the next notes of the score. */
  updateMusic(): void {
    const ctx = this.ctx;
    if (!ctx || this.vol.music <= 0) return;
    const now = ctx.currentTime;
    if (now < this.nextNote - 0.2) return;
    if (!this.phrase.length) {
      // A new phrase in D dorian, lower and sparser at night
      const scale = [146.83, 164.81, 174.61, 196.0, 220.0, 246.94, 261.63, 293.66, 329.63, 349.23, 392.0];
      const low = this.mood === 'night' ? 0 : this.mood === 'evening' ? 1 : 3;
      const n = this.mood === 'night' ? 3 + Math.floor(Math.random() * 3) : 4 + Math.floor(Math.random() * 5);
      let i = low + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        i = Math.max(0, Math.min(scale.length - 1, i + [-2, -1, 1, 2, 0][Math.floor(Math.random() * 5)]));
        this.phrase.push(scale[i]);
      }
      // A rest between phrases
      this.nextNote = Math.max(this.nextNote, now) + (this.mood === 'night' ? 6 : 3) + Math.random() * 5;
      // Drone root under the phrase
      this.pluck(this.nextNote, 73.42, 0.22, this.musicBus);
      return;
    }
    const f = this.phrase.shift()!;
    const t = Math.max(this.nextNote, now + 0.05);
    this.pluck(t, f, 0.18 + Math.random() * 0.06, this.musicBus);
    if (Math.random() < 0.25) this.pluck(t + 0.02, f * 1.5, 0.07, this.musicBus);
    const beat = this.mood === 'night' ? 0.9 : 0.55;
    this.nextNote = t + beat * (Math.random() < 0.3 ? 2 : 1);
  }

  // ------------------------------------------------------------------ ambience

  private startAmbience(): void {
    const ctx = this.ctx!;
    const make = (name: string, type: BiquadFilterType, freq: number, q: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.ambBus);
      src.start();
      this.amb[name] = { gain: g, target: 0 };
      return f;
    };
    const wind = make('wind', 'lowpass', 420, 0.7);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 220;
    lfo.connect(lg).connect(wind.frequency);
    lfo.start();
    make('rain', 'highpass', 1200, 0.4);
    make('creek', 'bandpass', 900, 0.6);
    make('fire', 'bandpass', 2600, 0.8);
    // Crickets: a pulsed high tone
    const o = ctx.createOscillator();
    o.frequency.value = 4400;
    const am = ctx.createGain();
    am.gain.value = 0;
    const pulse = ctx.createOscillator();
    pulse.type = 'square';
    pulse.frequency.value = 18;
    const pg = ctx.createGain();
    pg.gain.value = 0.5;
    pulse.connect(pg).connect(am.gain);
    const cg = ctx.createGain();
    cg.gain.value = 0;
    o.connect(am).connect(cg).connect(this.ambBus);
    o.start();
    pulse.start();
    this.amb.crickets = { gain: cg, target: 0 };
  }

  setAmbience(levels: Partial<Record<'wind' | 'rain' | 'creek' | 'fire' | 'crickets', number>>): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const [k, v] of Object.entries(levels)) {
      const a = this.amb[k];
      if (!a) continue;
      const scaled = k === 'crickets' ? v * 0.012 : k === 'fire' ? v * 0.08 : v * 0.25;
      if (Math.abs(a.target - scaled) < 0.001) continue;
      a.target = scaled;
      a.gain.gain.setTargetAtTime(scaled, t, 0.6);
    }
  }
}
