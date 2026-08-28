import { eegEngine } from './eegEngine';

export interface ClassicalTrack {
  id: string;
  title: string;
  composer: string;
  key: string;
  indication: string;
  targetState: string;
  bpm: number;
  notes: Array<{ pitch: number; dur: number; octave?: number }>;
}

export const CLASSICAL_PLAYLIST: ClassicalTrack[] = [
  {
    id: 'debussy-clair-de-lune',
    title: 'Clair de Lune (L. 75)',
    composer: 'Claude Debussy',
    key: 'D♭ Major',
    indication: 'Deep Alpha Calm & Serenity',
    targetState: 'Alpha (8-12 Hz)',
    bpm: 54,
    notes: [
      { pitch: 65, dur: 1.5 }, { pitch: 68, dur: 1.5 }, { pitch: 72, dur: 1.5 },
      { pitch: 77, dur: 3.0 }, { pitch: 75, dur: 1.5 }, { pitch: 72, dur: 1.5 },
      { pitch: 70, dur: 3.0 }, { pitch: 68, dur: 1.5 }, { pitch: 65, dur: 3.0 },
      { pitch: 61, dur: 1.5 }, { pitch: 65, dur: 3.0 }, { pitch: 68, dur: 1.5 },
      { pitch: 72, dur: 4.5 }, { pitch: 70, dur: 1.5 }, { pitch: 68, dur: 3.0 },
    ],
  },
  {
    id: 'bach-air-on-g-string',
    title: 'Air on the G String (BWV 1068)',
    composer: 'Johann Sebastian Bach',
    key: 'D Major',
    indication: 'SMR Focus & Motor Stillness',
    targetState: 'SMR (12-15 Hz)',
    bpm: 48,
    notes: [
      { pitch: 62, dur: 4.0 }, { pitch: 74, dur: 3.0 }, { pitch: 73, dur: 1.0 },
      { pitch: 71, dur: 2.0 }, { pitch: 69, dur: 2.0 }, { pitch: 67, dur: 4.0 },
      { pitch: 66, dur: 2.0 }, { pitch: 64, dur: 2.0 }, { pitch: 62, dur: 4.0 },
      { pitch: 69, dur: 3.0 }, { pitch: 67, dur: 1.0 }, { pitch: 66, dur: 4.0 },
    ],
  },
  {
    id: 'satie-gymnopedie-1',
    title: 'Gymnopédie No. 1',
    composer: 'Erik Satie',
    key: 'D Major',
    indication: 'Parasympathetic Reset & Vagal Tone',
    targetState: 'Vagal Relaxation',
    bpm: 60,
    notes: [
      { pitch: 71, dur: 3.0 }, { pitch: 69, dur: 3.0 }, { pitch: 66, dur: 3.0 },
      { pitch: 64, dur: 3.0 }, { pitch: 66, dur: 3.0 }, { pitch: 67, dur: 3.0 },
      { pitch: 66, dur: 6.0 }, { pitch: 71, dur: 3.0 }, { pitch: 69, dur: 3.0 },
      { pitch: 66, dur: 3.0 }, { pitch: 64, dur: 3.0 }, { pitch: 62, dur: 6.0 },
    ],
  },
  {
    id: 'chopin-nocturne-op9',
    title: 'Nocturne in E♭ Major (Op. 9 No. 2)',
    composer: 'Frédéric Chopin',
    key: 'E♭ Major',
    indication: 'Emotional Equilibrium & Flow',
    targetState: 'Theta-Alpha Crossover',
    bpm: 64,
    notes: [
      { pitch: 71, dur: 1.0 }, { pitch: 70, dur: 0.5 }, { pitch: 71, dur: 1.5 },
      { pitch: 68, dur: 1.0 }, { pitch: 63, dur: 2.0 }, { pitch: 75, dur: 2.0 },
      { pitch: 73, dur: 1.0 }, { pitch: 71, dur: 1.0 }, { pitch: 70, dur: 2.0 },
      { pitch: 68, dur: 2.0 }, { pitch: 66, dur: 1.0 }, { pitch: 68, dur: 3.0 },
    ],
  },
  {
    id: 'beethoven-moonlight',
    title: 'Moonlight Sonata (Adagio sostenuto)',
    composer: 'Ludwig van Beethoven',
    key: 'C♯ Minor',
    indication: 'Deep Meditation & Theta Waves',
    targetState: 'Theta Meditation',
    bpm: 50,
    notes: [
      { pitch: 61, dur: 1.0 }, { pitch: 64, dur: 1.0 }, { pitch: 68, dur: 1.0 },
      { pitch: 61, dur: 1.0 }, { pitch: 64, dur: 1.0 }, { pitch: 68, dur: 1.0 },
      { pitch: 60, dur: 1.0 }, { pitch: 63, dur: 1.0 }, { pitch: 68, dur: 1.0 },
      { pitch: 68, dur: 3.0 }, { pitch: 67, dur: 1.0 }, { pitch: 68, dur: 2.0 },
    ],
  },
  {
    id: 'vivaldi-winter-largo',
    title: 'The Four Seasons: Winter (Largo)',
    composer: 'Antonio Vivaldi',
    key: 'E♭ Major',
    indication: 'Neural Coherence & Harmony',
    targetState: 'High Coherence',
    bpm: 52,
    notes: [
      { pitch: 67, dur: 2.0 }, { pitch: 70, dur: 1.0 }, { pitch: 72, dur: 1.0 },
      { pitch: 74, dur: 3.0 }, { pitch: 72, dur: 1.0 }, { pitch: 70, dur: 2.0 },
      { pitch: 68, dur: 2.0 }, { pitch: 67, dur: 4.0 }, { pitch: 65, dur: 2.0 },
      { pitch: 67, dur: 4.0 },
    ],
  },
];

class NeuroMusicEngine {
  private ctx: AudioContext | null = null;
  private isInitialized = false;
  private isPlaying = false;

  // Web Audio Graph
  private masterGain: GainNode | null = null;
  private neuroFilter: BiquadFilterNode | null = null;
  private neuroGain: GainNode | null = null;
  private stereoPanner: StereoPannerNode | null = null;
  private binauralOsc: OscillatorNode | null = null;
  private binauralGain: GainNode | null = null;

  // Custom Audio File Node
  private customAudioEl: HTMLAudioElement | null = null;
  private customMediaSource: MediaElementAudioSourceNode | null = null;

  // Synth Sequencing
  private currentTrack: ClassicalTrack = CLASSICAL_PLAYLIST[0];
  private sequenceTimeout: ReturnType<typeof setTimeout> | null = null;
  private currentNoteIndex = 0;
  private isCustomAudio = false;

  // Subscriptions
  private unsubscribeEEG: (() => void) | null = null;

  public async initialize() {
    if (this.isInitialized) return;

    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    // 1. Master Output Gain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.85;
    this.masterGain.connect(this.ctx.destination);

    // 2. Dynamic Neurofeedback Biquad Lowpass Filter
    this.neuroFilter = this.ctx.createBiquadFilter();
    this.neuroFilter.type = 'lowpass';
    this.neuroFilter.frequency.value = 18000; // Starts full spectrum
    this.neuroFilter.Q.value = 1.0;

    // 3. Dynamic Neurofeedback Operant Gain
    this.neuroGain = this.ctx.createGain();
    this.neuroGain.gain.value = 1.0;

    // 4. Stereo Panner / Spatial Width
    this.stereoPanner = this.ctx.createStereoPanner();
    this.stereoPanner.pan.value = 0.0;

    // Connect Audio Pipeline: Input ➔ NeuroFilter ➔ NeuroGain ➔ StereoPanner ➔ MasterGain
    this.neuroFilter.connect(this.neuroGain);
    this.neuroGain.connect(this.stereoPanner);
    this.stereoPanner.connect(this.masterGain);

    // 5. Subtle Alpha Binaural Resonance Sine Overlay
    this.binauralOsc = this.ctx.createOscillator();
    this.binauralGain = this.ctx.createGain();
    this.binauralOsc.type = 'sine';
    this.binauralOsc.frequency.value = 10.0; // 10 Hz Alpha
    this.binauralGain.gain.value = 0.0;
    this.binauralOsc.connect(this.binauralGain);
    this.binauralGain.connect(this.masterGain);
    this.binauralOsc.start();

    // Subscribe to real-time EEG engine
    this.unsubscribeEEG = eegEngine.subscribe((data) => {
      this.updateNeuroModulation(data.inZone, data.zoneScore, data.coherence, data.bands.alpha);
    });

    this.isInitialized = true;
  }

  public setTrack(track: ClassicalTrack) {
    this.currentTrack = track;
    this.isCustomAudio = false;
    this.currentNoteIndex = 0;
    if (this.customAudioEl) {
      this.customAudioEl.pause();
    }
  }

  public async loadCustomAudioFile(file: File): Promise<string> {
    await this.initialize();
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    if (this.sequenceTimeout) {
      clearTimeout(this.sequenceTimeout);
    }

    const objectUrl = URL.createObjectURL(file);
    if (!this.customAudioEl) {
      this.customAudioEl = new Audio();
      this.customAudioEl.crossOrigin = 'anonymous';
      this.customMediaSource = this.ctx!.createMediaElementSource(this.customAudioEl);
      this.customMediaSource.connect(this.neuroFilter!);
    }

    this.customAudioEl.src = objectUrl;
    this.customAudioEl.loop = true;
    this.isCustomAudio = true;
    return file.name;
  }

  public async play() {
    await this.initialize();
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.isPlaying = true;

    if (this.isCustomAudio && this.customAudioEl) {
      this.customAudioEl.play().catch(e => console.error("Audio playback notice:", e));
    } else {
      this.playNextSynthNote();
    }
  }

  public pause() {
    this.isPlaying = false;
    if (this.sequenceTimeout) {
      clearTimeout(this.sequenceTimeout);
      this.sequenceTimeout = null;
    }
    if (this.customAudioEl) {
      this.customAudioEl.pause();
    }
  }

  public setMasterVolume(vol: number) {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(Math.max(0, Math.min(1, vol)), this.ctx.currentTime, 0.05);
    }
  }

  // Real-Time Neurofeedback Modulator
  private updateNeuroModulation(inZone: boolean, zoneScore: number, coherence: number, alphaPower: number) {
    if (!this.ctx || !this.neuroFilter || !this.neuroGain) return;
    const now = this.ctx.currentTime;

    // 1. Lowpass Filter Cutoff Modulation:
    // In-zone (high zoneScore): Opens up to 18,000 - 20,000 Hz (crystalline clarity)
    // Out-of-zone: Sweeps down to 900 - 2,200 Hz (soft muffled acoustic warmth)
    const targetCutoff = inZone
      ? 4500 + zoneScore * 14500
      : 850 + zoneScore * 2500;

    this.neuroFilter.frequency.setTargetAtTime(targetCutoff, now, 0.4);

    // 2. Operant Gain (Volume):
    // In-zone: Full 100% volume
    // Out-of-zone: Softly attenuates to 68%
    const targetGain = inZone ? 0.85 + zoneScore * 0.15 : 0.65 + zoneScore * 0.15;
    this.neuroGain.gain.setTargetAtTime(targetGain, now, 0.5);

    // 3. Binaural Resonance & Harmonic Coherence:
    if (this.binauralGain) {
      const binauralVol = inZone && coherence > 50 ? ((coherence - 40) / 100) * 0.04 : 0;
      this.binauralGain.gain.setTargetAtTime(binauralVol, now, 0.8);
    }
  }

  // Synthesize rich classical piano & chamber instrument tones
  private playNextSynthNote() {
    if (!this.isPlaying || this.isCustomAudio || !this.ctx || !this.neuroFilter) return;

    const notes = this.currentTrack.notes;
    const note = notes[this.currentNoteIndex];
    const freq = 440 * Math.pow(2, (note.pitch - 69) / 12);
    const now = this.ctx.currentTime;
    const duration = (note.dur * 60) / this.currentTrack.bpm;

    // Harmonic Piano / Warm Cello Physical Oscillator Pair
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const noteGain = this.ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'triangle';

    osc1.frequency.setValueAtTime(freq, now);
    osc2.frequency.setValueAtTime(freq * 1.002, now); // Gentle chorusing

    // Natural acoustic ADSR envelope
    noteGain.gain.setValueAtTime(0, now);
    noteGain.gain.linearRampToValueAtTime(0.35, now + 0.04);
    noteGain.gain.exponentialRampToValueAtTime(0.18, now + duration * 0.4);
    noteGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.98);

    osc1.connect(noteGain);
    osc2.connect(noteGain);
    noteGain.connect(this.neuroFilter);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + duration);
    osc2.stop(now + duration);

    // Advance sequence
    this.currentNoteIndex = (this.currentNoteIndex + 1) % notes.length;
    this.sequenceTimeout = setTimeout(() => {
      this.playNextSynthNote();
    }, duration * 1000 * 0.95);
  }

  public cleanup() {
    this.pause();
    if (this.unsubscribeEEG) {
      this.unsubscribeEEG();
      this.unsubscribeEEG = null;
    }
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
      this.isInitialized = false;
    }
  }
}

export const neuroMusicEngine = new NeuroMusicEngine();
