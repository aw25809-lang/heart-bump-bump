/**
 * Procedural Web Audio Heartbeat & Haptic Feedback Engine
 * Generates realistic distance-modulated lub-dub heartbeats, contact lock cues,
 * attack whiff/hit audio, and Android navigator.vibrate patterns.
 */
class AudioHapticsEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private muted = false;
  private unlocked = false;

  private heartbeatTimer: number | null = null;
  private isHeartbeatRunning = false;
  private currentDistanceRatio = 1;
  private currentIsTouching = false;
  private onBeatCallback: ((bpm: number, intensity: number) => void) | null = null;

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
    }
  }

  public isUnlocked(): boolean {
    return this.unlocked;
  }

  public supportsVibration(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 1;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public async unlockAndTest(): Promise<boolean> {
    const ctx = this.ensureContext();
    if (!ctx) return false;
    try {
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      this.unlocked = true;
      // Play a clean sample heartbeat + confirmation chime
      this.playLubDub(0.75, 0.7);
      this.vibrate([55, 45, 95]);
      return true;
    } catch {
      return false;
    }
  }

  public vibrate(pattern: number | number[]): void {
    if (this.muted) return;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {
      // Ignore vibration errors on unsupported browsers (e.g. iOS Safari)
    }
  }

  public setBeatListener(cb: ((bpm: number, intensity: number) => void) | null): void {
    this.onBeatCallback = cb;
  }

  public updateTelemetry(distanceRatio: number, isTouching: boolean): void {
    this.currentDistanceRatio = Math.max(0, Math.min(1, distanceRatio));
    this.currentIsTouching = isTouching;
  }

  public startHeartbeat(): void {
    if (this.isHeartbeatRunning) return;
    this.ensureContext();
    this.isHeartbeatRunning = true;
    this.scheduleNextBeat(true);
  }

  public stopHeartbeat(): void {
    this.isHeartbeatRunning = false;
    if (this.heartbeatTimer !== null) {
      window.clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private getBeatMetrics(): { bpm: number; volume: number; cutoff: number; intervalMs: number } {
    const proximity = Math.pow(1 - this.currentDistanceRatio, 1.4);
    const bpm = this.currentIsTouching ? 172 : Math.round(52 + proximity * 116);
    const volume = this.currentIsTouching ? 0.96 : 0.08 + proximity * 0.84;
    const cutoff = this.currentIsTouching ? 680 : 150 + proximity * 480;
    const intervalMs = Math.round(60000 / bpm);
    return { bpm, volume, cutoff, intervalMs };
  }

  private scheduleNextBeat(immediate = false): void {
    if (!this.isHeartbeatRunning) return;
    const { bpm, volume, cutoff, intervalMs } = this.getBeatMetrics();

    if (immediate) {
      this.playLubDub(volume, cutoff / 680);
      this.onBeatCallback?.(bpm, volume);
    }

    this.heartbeatTimer = window.setTimeout(() => {
      if (!this.isHeartbeatRunning) return;
      const latest = this.getBeatMetrics();
      this.playLubDub(latest.volume, latest.cutoff / 680);
      this.onBeatCallback?.(latest.bpm, latest.volume);
      this.scheduleNextBeat(false);
    }, intervalMs);
  }

  private playLubDub(volume: number, brightness: number): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.muted) return;

    const now = ctx.currentTime;
    const cutoffHz = 140 + Math.max(0, Math.min(1, brightness)) * 540;

    // Lub (S1)
    this.triggerHeartThump(ctx, now, 62, 34, 0.13, volume, cutoffHz);
    // Dub (S2) - tightens slightly at high BPM
    const dubDelay = 0.165 - Math.min(0.055, brightness * 0.055);
    this.triggerHeartThump(ctx, now + dubDelay, 50, 29, 0.105, volume * 0.78, cutoffHz * 0.9);
  }

  private triggerHeartThump(
    ctx: AudioContext,
    startTime: number,
    startFreq: number,
    endFreq: number,
    duration: number,
    volume: number,
    cutoffHz: number,
  ): void {
    if (!this.masterGain) return;
    const osc = ctx.createOscillator();
    const subOsc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(startFreq, startTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, startTime + duration);

    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(startFreq * 0.82, startTime);
    subOsc.frequency.exponentialRampToValueAtTime(endFreq * 0.8, startTime + duration);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoffHz, startTime);
    filter.Q.value = 1.4;

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(filter);
    subOsc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(startTime);
    subOsc.start(startTime);
    osc.stop(startTime + duration + 0.02);
    subOsc.stop(startTime + duration + 0.02);
  }

  public triggerContactCue(strong: boolean): void {
    this.vibrate(strong ? [160, 40, 160, 40, 220] : [90, 40, 90]);
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.muted) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(strong ? 920 : 780, now);
    osc.frequency.exponentialRampToValueAtTime(strong ? 1460 : 1140, now + 0.085);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(strong ? 0.28 : 0.16, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  public playWhiff(): void {
    this.vibrate(25);
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.muted) return;

    const now = ctx.currentTime;
    const bufferSize = Math.floor(ctx.sampleRate * 0.16);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1100, now);
    filter.frequency.exponentialRampToValueAtTime(240, now + 0.15);
    filter.Q.value = 1.8;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(now);
  }

  public playHitWin(): void {
    this.vibrate([90, 35, 190]);
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.muted) return;

    const now = ctx.currentTime;
    // Heavy impact thud
    this.triggerHeartThump(ctx, now, 130, 32, 0.22, 0.9, 900);

    // Bright tactical victory triad
    const freqs = [523.25, 659.25, 783.99];
    freqs.forEach((f, idx) => {
      if (!this.masterGain) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + idx * 0.045;
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.38);
    });
  }

  public playHitLose(): void {
    this.vibrate(280);
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.muted) return;

    const now = ctx.currentTime;
    this.triggerHeartThump(ctx, now, 95, 26, 0.28, 0.85, 420);

    const freqs = [330, 247];
    freqs.forEach((f, idx) => {
      if (!this.masterGain) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      const t = now + idx * 0.11;
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.26);
    });
  }

  public playCountdownTick(value: number): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const isGo = value <= 0;
    osc.frequency.setValueAtTime(isGo ? 1046.5 : 659.25, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(isGo ? 0.28 : 0.18, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (isGo ? 0.24 : 0.12));
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + (isGo ? 0.26 : 0.14));
  }
}

export const audioHaptics = new AudioHapticsEngine();
