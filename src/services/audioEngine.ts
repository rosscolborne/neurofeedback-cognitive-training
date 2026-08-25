class AudioEngine {
  private ctx: AudioContext | null = null;
  private isMuted = false;
  private masterGain: GainNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  private activeVoices: OscillatorNode[] = [];
  private noiseNode: AudioNode | null = null;
  private isPlaying = false;
  private currentMode: 'soundscape' | 'binaural' | 'chords' | 'silent' = 'silent';

  private initContext() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
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
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
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

  // Modulate sound clarity based on EEG target state
  public updateNeuroFeedback(inZone: boolean, intensity = 1.0) {
    if (!this.ctx || !this.filterNode || !this.masterGain || this.isMuted) return;

    const now = this.ctx.currentTime;
    if (inZone) {
      // Clear, warm, open sound
      const targetFreq = 1800 + intensity * 2400;
      this.filterNode.frequency.setTargetAtTime(targetFreq, now, 0.8);
      this.masterGain.gain.setTargetAtTime(0.38, now, 0.5);
    } else {
      // Gently filtered, dimmed sound (1.5s smooth crossfade)
      this.filterNode.frequency.setTargetAtTime(650, now, 1.2);
      this.masterGain.gain.setTargetAtTime(0.18, now, 1.5);
    }
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

  // Generative Harmonic Pad (Pentatonic)
  public startHarmonicPads(rootFreq = 130.81) { // C3
    this.initContext();
    this.stopAll();
    if (!this.ctx || !this.filterNode) return;

    this.isPlaying = true;
    this.currentMode = 'chords';

    // Pentatonic scale multipliers: 1, 9/8, 5/4, 3/2, 5/3, 2
    const ratios = [1, 1.25, 1.5, 1.875, 2];
    ratios.forEach((ratio, i) => {
      if (!this.ctx || !this.filterNode) return;
      const osc = this.ctx.createOscillator();
      const voiceGain = this.ctx.createGain();
      
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(rootFreq * ratio, this.ctx.currentTime);
      
      // Subtle detune for lush warmth
      osc.detune.setValueAtTime((Math.random() - 0.5) * 8, this.ctx.currentTime);

      voiceGain.gain.setValueAtTime(0.08 / ratios.length, this.ctx.currentTime);

      osc.connect(voiceGain);
      voiceGain.connect(this.filterNode);
      osc.start();
      this.activeVoices.push(osc);
    });
  }

  // Procedural Ocean Waves & Nature Ambiance
  public startNatureSoundscape(type: 'ocean' | 'rain' | 'forest' | 'night' = 'ocean') {
    this.initContext();
    this.stopAll();
    if (!this.ctx || !this.filterNode) return;

    this.isPlaying = true;
    this.currentMode = 'soundscape';

    // Synthesize Brown/Pink noise via buffer
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = output[i];
      output[i] *= 3.5; // Gain compensation
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    // Ocean swell LFO
    const lfo = this.ctx.createOscillator();
    lfo.frequency.setValueAtTime(type === 'ocean' ? 0.12 : 0.25, this.ctx.currentTime); // ~8s swell

    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(500, this.ctx.currentTime);

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(type === 'rain' ? 800 : 400, this.ctx.currentTime);
    noiseFilter.Q.setValueAtTime(2.0, this.ctx.currentTime);

    lfo.connect(lfoGain);
    lfoGain.connect(noiseFilter.frequency);

    whiteNoise.connect(noiseFilter);
    noiseFilter.connect(this.filterNode);

    whiteNoise.start();
    lfo.start();
    this.noiseNode = whiteNoise;
  }

  // Binaural Beat Entrainment
  public startBinauralBeat(carrier = 216, entrainFreq = 10) { // 10Hz Alpha
    this.initContext();
    this.stopAll();
    if (!this.ctx || !this.filterNode) return;

    this.isPlaying = true;
    this.currentMode = 'binaural';

    // Left Ear
    const oscL = this.ctx.createOscillator();
    const panL = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    oscL.type = 'sine';
    oscL.frequency.setValueAtTime(carrier, this.ctx.currentTime);

    // Right Ear
    const oscR = this.ctx.createOscillator();
    const panR = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    oscR.type = 'sine';
    oscR.frequency.setValueAtTime(carrier + entrainFreq, this.ctx.currentTime);

    if (panL && panR) {
      panL.pan.setValueAtTime(-1, this.ctx.currentTime);
      panR.pan.setValueAtTime(1, this.ctx.currentTime);
      oscL.connect(panL);
      oscR.connect(panR);
      panL.connect(this.filterNode);
      panR.connect(this.filterNode);
    } else {
      oscL.connect(this.filterNode);
      oscR.connect(this.filterNode);
    }

    oscL.start();
    oscR.start();
    this.activeVoices.push(oscL, oscR);
  }

  public stopAll() {
    this.activeVoices.forEach(v => {
      try {
        v.stop();
        v.disconnect();
      } catch (e) {}
    });
    this.activeVoices = [];

    if (this.noiseNode) {
      try {
        (this.noiseNode as any).stop?.();
        this.noiseNode.disconnect();
      } catch (e) {}
      this.noiseNode = null;
    }
    this.isPlaying = false;
    this.currentMode = 'silent';
  }
}

export const audioEngine = new AudioEngine();
