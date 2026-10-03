class AudioEngine {
  private ctx: AudioContext | null = null;
  private isMuted = false;
  private masterGain: GainNode | null = null;
  private filterNode: BiquadFilterNode | null = null;

  private initContext() {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      this.ctx = new AudioContextClass();
      
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.35, this.ctx.currentTime);

      this.filterNode = this.ctx.createBiquadFilter();
      this.filterNode.type = 'lowpass';
      this.filterNode.frequency.setValueAtTime(2500, this.ctx.currentTime);
      this.filterNode.Q.setValueAtTime(1.0, this.ctx.currentTime);

      this.filterNode.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.35, this.ctx.currentTime, 0.1);
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  // Play a soft milestone achievement chime
  public playChime(type: 'success' | 'complete' | 'breath-in' | 'breath-out') {
    this.initContext();
    if (!this.ctx || this.isMuted) return;

    const now = this.ctx.currentTime;
    const chimeGain = this.ctx.createGain();
    chimeGain.connect(this.ctx.destination);

    if (type === 'success' || type === 'complete') {
      const freqs = type === 'complete' ? [261.63, 329.63, 392.00, 523.25] : [392.00, 523.25, 659.25];
      freqs.forEach((f, idx) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const noteGain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, now + idx * 0.1);

        noteGain.gain.setValueAtTime(0, now + idx * 0.1);
        noteGain.gain.linearRampToValueAtTime(0.12, now + idx * 0.1 + 0.05);
        noteGain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.1 + 1.2);

        osc.connect(noteGain);
        noteGain.connect(chimeGain);
        osc.start(now + idx * 0.1);
        osc.stop(now + idx * 0.1 + 1.3);
      });
    } else if (type === 'breath-in') {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 3.0);
      
      chimeGain.gain.setValueAtTime(0.001, now);
      chimeGain.gain.linearRampToValueAtTime(0.06, now + 1.5);
      chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 3.5);

      osc.connect(chimeGain);
      osc.start(now);
      osc.stop(now + 3.6);
    }
  }

  // Play a short tactile blip or knock tone (e.g. chess piece move, button click, haptic chime)
  public playBlip(freq = 440) {
    this.initContext();
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  // Play a rich, soothing meditative Tibetan singing bowl chime (432Hz solfeggio harmonic)
  public playMeditativeIntroChime() {
    this.initContext();
    if (!this.ctx || this.isMuted) return;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    const now = this.ctx.currentTime;
    const masterChimeGain = this.ctx.createGain();
    masterChimeGain.gain.setValueAtTime(0.3, now);
    masterChimeGain.connect(this.ctx.destination);

    // Warm multi-harmonic singing bowl spectrum (Root: 432Hz + Solfeggio harmonics)
    const partials = [
      { freq: 108.00, gain: 0.18, decay: 6.5, detune: 0 },    // Deep grounding sub-drone
      { freq: 216.00, gain: 0.28, decay: 5.8, detune: -1.2 }, // Lower octave warmth
      { freq: 432.00, gain: 0.35, decay: 5.2, detune: 0 },    // 432Hz Solfeggio fundamental
      { freq: 433.20, gain: 0.22, decay: 4.8, detune: 2.1 },  // Acoustic chorus beat shimmer
      { freq: 864.00, gain: 0.14, decay: 3.8, detune: -1.5 }, // 2nd harmonic
      { freq: 1296.0, gain: 0.08, decay: 2.9, detune: 1.0 },  // 3rd harmonic
      { freq: 1728.0, gain: 0.03, decay: 2.1, detune: 0.5 },  // Delicate crystal overtone
    ];

    partials.forEach(p => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(p.freq, now);
      osc.detune.setValueAtTime(p.detune, now);

      // Smooth strike envelope (no pop, soft organic mallet bloom)
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(p.gain, now + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.00001, now + p.decay);

      osc.connect(gain);
      gain.connect(masterChimeGain);

      osc.start(now);
      osc.stop(now + p.decay + 0.1);
    });
  }
}

export const audioEngine = new AudioEngine();
