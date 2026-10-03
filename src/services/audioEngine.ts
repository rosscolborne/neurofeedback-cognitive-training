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
