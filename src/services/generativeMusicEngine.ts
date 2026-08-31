import { eegEngine } from './eegEngine';

// ─────────────────────────────────────────────────
// Generative Music Engine — Brain-State-Driven Music
// Three modes inspired by Brainimation (kylemath):
//   1. BrainMelody  — Pentatonic generative melody
//   2. NeuralSynth  — FM synthesis with timbral EEG control
//   3. BrainwaveDrums — Percussive patterns from band powers
// ─────────────────────────────────────────────────

export type GenerativeMusicMode = 'brain-melody' | 'neural-synth' | 'brainwave-drums';

export interface TherapeuticScale {
  id: string;
  name: string;
  notes: number[]; // MIDI note numbers
  description: string;
}

export const THERAPEUTIC_SCALES: TherapeuticScale[] = [
  {
    id: 'c-major-pentatonic',
    name: 'C Major Pentatonic',
    notes: [60, 62, 64, 67, 69, 72, 74, 76, 79, 81],
    description: 'Warm, universally pleasant — ideal for relaxation protocols',
  },
  {
    id: 'db-lydian',
    name: 'D♭ Lydian',
    notes: [61, 63, 65, 68, 69, 70, 72, 73, 75, 77],
    description: 'Debussy-aligned dreamlike quality — deep alpha states',
  },
  {
    id: 'a-minor-pentatonic',
    name: 'A Minor Pentatonic',
    notes: [57, 60, 62, 64, 67, 69, 72, 74, 76, 79],
    description: 'Introspective, contemplative — theta meditation',
  },
  {
    id: 'f-major-pentatonic',
    name: 'F Major Pentatonic',
    notes: [53, 55, 57, 60, 62, 65, 67, 69, 72, 74],
    description: 'Gentle, pastoral — vagal relaxation and HRV training',
  },
];

/** Convert MIDI note number to frequency in Hz. */
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

class GenerativeMusicEngine {
  private ctx: AudioContext | null = null;
  private isInitialized = false;
  private isPlaying = false;

  // Web Audio Graph
  private masterGain: GainNode | null = null;
  private neuroFilter: BiquadFilterNode | null = null;
  private neuroGain: GainNode | null = null;
  private reverbGain: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private convolver: ConvolverNode | null = null;

  // Sequencer
  private sequenceTimeout: ReturnType<typeof setTimeout> | null = null;
  private currentMode: GenerativeMusicMode = 'brain-melody';
  private currentScale: TherapeuticScale = THERAPEUTIC_SCALES[0];

  // Live EEG snapshot (updated by subscription)
  private liveAlpha = 0.5;
  private liveTheta = 0.3;
  private liveBeta = 0.4;
  private liveAttention = 0.5;
  private liveInZone = true;
  private liveZoneScore = 0.7;
  private liveCoherence: number | null = 75;

  // FM Synthesis voices (Neural Synth mode)
  private fmCarrier: OscillatorNode | null = null;
  private fmModulator: OscillatorNode | null = null;
  private fmModGain: GainNode | null = null;
  private fmOutputGain: GainNode | null = null;

  // EEG subscription
  private unsubscribeEEG: (() => void) | null = null;

  // ─── Initialization ─────────────────────────
  public async initialize() {
    if (this.isInitialized) return;

    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    // 1. Master Output Gain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.75;
    this.masterGain.connect(this.ctx.destination);

    // 2. Dry/Wet Reverb Mix
    this.dryGain = this.ctx.createGain();
    this.dryGain.gain.value = 0.7;
    this.dryGain.connect(this.masterGain);

    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.3;
    this.reverbGain.connect(this.masterGain);

    // 3. Procedural Convolution Reverb (synthesized impulse response)
    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this.createReverbIR(2.2, 3.5);
    this.convolver.connect(this.reverbGain);

    // 4. Neurofeedback Lowpass Filter
    this.neuroFilter = this.ctx.createBiquadFilter();
    this.neuroFilter.type = 'lowpass';
    this.neuroFilter.frequency.value = 18000;
    this.neuroFilter.Q.value = 0.8;

    // 5. Neurofeedback Operant Gain
    this.neuroGain = this.ctx.createGain();
    this.neuroGain.gain.value = 1.0;

    // Signal chain: Notes → NeuroFilter → NeuroGain → Dry + Convolver → Master
    this.neuroFilter.connect(this.neuroGain);
    this.neuroGain.connect(this.dryGain);
    this.neuroGain.connect(this.convolver);

    // Subscribe to EEG telemetry
    this.unsubscribeEEG = eegEngine.subscribe((data) => {
      this.liveAlpha = data.bands.alpha;
      this.liveTheta = data.bands.theta;
      this.liveBeta = data.bands.beta;
      this.liveAttention = data.zoneScore;
      this.liveInZone = data.inZone;
      this.liveZoneScore = data.zoneScore;
      this.liveCoherence = data.coherence;
      this.updateNeuroModulation();
    });

    this.isInitialized = true;
  }

  // ─── Procedural Reverb IR ──────────────────
  private createReverbIR(decay: number, duration: number): AudioBuffer {
    const sampleRate = this.ctx!.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const buffer = this.ctx!.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        // Exponentially decaying white noise
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return buffer;
  }

  // ─── Mode & Scale Control ──────────────────
  public setMode(mode: GenerativeMusicMode) {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.stop();

    // Tear down FM synth if leaving neural-synth mode
    if (this.currentMode === 'neural-synth') {
      this.teardownFMSynth();
    }

    this.currentMode = mode;
    if (wasPlaying) this.play();
  }

  public getMode(): GenerativeMusicMode {
    return this.currentMode;
  }

  public setScale(scale: TherapeuticScale) {
    this.currentScale = scale;
  }

  public getScale(): TherapeuticScale {
    return this.currentScale;
  }

  public setMasterVolume(vol: number) {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        Math.max(0, Math.min(1, vol)),
        this.ctx.currentTime,
        0.05,
      );
    }
  }

  // ─── Playback Control ─────────────────────
  public async play() {
    await this.initialize();
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.isPlaying = true;

    if (this.currentMode === 'brain-melody') {
      this.scheduleMelodyNote();
    } else if (this.currentMode === 'neural-synth') {
      this.startFMSynth();
    } else if (this.currentMode === 'brainwave-drums') {
      this.scheduleDrumHit();
    }
  }

  public stop() {
    this.isPlaying = false;
    if (this.sequenceTimeout) {
      clearTimeout(this.sequenceTimeout);
      this.sequenceTimeout = null;
    }
    if (this.currentMode === 'neural-synth') {
      this.teardownFMSynth();
    }
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  // ─── Neurofeedback Modulation ─────────────
  private updateNeuroModulation() {
    if (!this.ctx || !this.neuroFilter || !this.neuroGain) return;
    const now = this.ctx.currentTime;

    // Lowpass: In-zone opens to crystalline clarity; out-of-zone muffles
    const targetCutoff = this.liveInZone
      ? 4500 + this.liveZoneScore * 14500
      : 850 + this.liveZoneScore * 2500;
    this.neuroFilter.frequency.setTargetAtTime(targetCutoff, now, 0.4);

    // Gain: In-zone = full volume; out-of-zone = soft attenuation
    const targetGain = this.liveInZone
      ? 0.85 + this.liveZoneScore * 0.15
      : 0.60 + this.liveZoneScore * 0.15;
    this.neuroGain.gain.setTargetAtTime(targetGain, now, 0.5);

    // Reverb wet/dry: Higher coherence = more reverb "bloom"
    if (this.reverbGain && this.dryGain) {
      const cohNorm = this.liveCoherence != null ? this.liveCoherence / 100 : 0.5;
      const wetTarget = this.liveInZone ? 0.2 + cohNorm * 0.35 : 0.15;
      this.reverbGain.gain.setTargetAtTime(wetTarget, now, 0.8);
      this.dryGain.gain.setTargetAtTime(1 - wetTarget, now, 0.8);
    }
  }

  // ─── MODE 1: Brain Melody (Pentatonic Generative) ─────
  private scheduleMelodyNote() {
    if (!this.isPlaying || this.currentMode !== 'brain-melody' || !this.ctx || !this.neuroFilter) return;

    const notes = this.currentScale.notes;

    // Alpha power selects note from scale (quantized)
    // Normalize alpha: typical alpha range is 1–25 µV, map to 0–1
    const alphaNorm = Math.min(1, Math.max(0, this.liveAlpha / 20));
    const noteIndex = Math.floor(alphaNorm * (notes.length - 1));
    const midiNote = notes[Math.min(noteIndex, notes.length - 1)];
    const freq = midiToFreq(midiNote);

    // Attention controls tempo: high attention = faster (200ms), low = slower (900ms)
    const interNoteMs = 900 - this.liveAttention * 600;

    // Beta controls note duration: higher beta = shorter, crisper notes
    const betaNorm = Math.min(1, Math.max(0, this.liveBeta / 20));
    const durationSec = 0.3 + (1 - betaNorm) * 1.2;

    // Zone score controls velocity (gain)
    const velocity = this.liveInZone
      ? 0.20 + this.liveZoneScore * 0.18
      : 0.08 + this.liveZoneScore * 0.10;

    const now = this.ctx.currentTime;

    // Primary oscillator (sine — warm fundamental)
    const osc1 = this.ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(freq, now);

    // Secondary oscillator (triangle — gentle harmonic richness + chorus detune)
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(freq * 1.002, now);

    // Note gain with ADSR envelope
    const noteGain = this.ctx.createGain();
    noteGain.gain.setValueAtTime(0, now);
    noteGain.gain.linearRampToValueAtTime(velocity, now + 0.035);          // Attack
    noteGain.gain.exponentialRampToValueAtTime(velocity * 0.55, now + durationSec * 0.35); // Decay
    noteGain.gain.exponentialRampToValueAtTime(0.001, now + durationSec * 0.95);           // Release

    osc1.connect(noteGain);
    osc2.connect(noteGain);
    noteGain.connect(this.neuroFilter);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + durationSec);
    osc2.stop(now + durationSec);

    // Coherence adds octave harmonic (beautiful shimmer when brain is coherent)
    if (this.liveCoherence != null && this.liveCoherence > 55 && this.liveInZone) {
      const octaveOsc = this.ctx.createOscillator();
      const octaveGain = this.ctx.createGain();
      octaveOsc.type = 'sine';
      octaveOsc.frequency.setValueAtTime(freq * 2, now);
      octaveGain.gain.setValueAtTime(0, now);
      octaveGain.gain.linearRampToValueAtTime(velocity * 0.12, now + 0.05);
      octaveGain.gain.exponentialRampToValueAtTime(0.001, now + durationSec * 0.7);
      octaveOsc.connect(octaveGain);
      octaveGain.connect(this.neuroFilter);
      octaveOsc.start(now);
      octaveOsc.stop(now + durationSec);
    }

    // Schedule next note
    this.sequenceTimeout = setTimeout(() => {
      this.scheduleMelodyNote();
    }, Math.max(150, interNoteMs));
  }

  // ─── MODE 2: Neural Synthesizer (FM Synthesis) ────────
  private startFMSynth() {
    if (!this.ctx || !this.neuroFilter) return;
    this.teardownFMSynth();

    const now = this.ctx.currentTime;

    // Carrier oscillator
    this.fmCarrier = this.ctx.createOscillator();
    this.fmCarrier.type = 'sine';
    this.fmCarrier.frequency.setValueAtTime(220, now);

    // Modulator oscillator
    this.fmModulator = this.ctx.createOscillator();
    this.fmModulator.type = 'sine';
    this.fmModulator.frequency.setValueAtTime(110, now);

    // Modulation depth gain
    this.fmModGain = this.ctx.createGain();
    this.fmModGain.gain.setValueAtTime(100, now);

    // Output gain (with fade-in)
    this.fmOutputGain = this.ctx.createGain();
    this.fmOutputGain.gain.setValueAtTime(0, now);
    this.fmOutputGain.gain.linearRampToValueAtTime(0.25, now + 1.5);

    // FM Patch: Modulator → ModGain → Carrier.frequency
    this.fmModulator.connect(this.fmModGain);
    this.fmModGain.connect(this.fmCarrier.frequency);

    // Carrier → OutputGain → NeuroFilter pipeline
    this.fmCarrier.connect(this.fmOutputGain);
    this.fmOutputGain.connect(this.neuroFilter);

    this.fmModulator.start(now);
    this.fmCarrier.start(now);

    // Start continuous parameter update loop
    this.scheduleFMUpdate();
  }

  private scheduleFMUpdate() {
    if (!this.isPlaying || this.currentMode !== 'neural-synth' || !this.ctx) return;

    const now = this.ctx.currentTime;

    // Alpha → carrier frequency (110–880 Hz)
    const alphaNorm = Math.min(1, Math.max(0, this.liveAlpha / 20));
    const carrierFreq = 110 + alphaNorm * 770;
    this.fmCarrier?.frequency.setTargetAtTime(carrierFreq, now, 0.15);

    // Theta → modulation depth (0–500)
    const thetaNorm = Math.min(1, Math.max(0, this.liveTheta / 15));
    const modDepth = thetaNorm * 500;
    this.fmModGain?.gain.setTargetAtTime(modDepth, now, 0.2);

    // Beta → modulation frequency (ratio to carrier: 0.5 – 4.0)
    const betaNorm = Math.min(1, Math.max(0, this.liveBeta / 20));
    const modFreq = carrierFreq * (0.5 + betaNorm * 3.5);
    this.fmModulator?.frequency.setTargetAtTime(modFreq, now, 0.2);

    // Zone score → output volume
    const volume = this.liveInZone
      ? 0.15 + this.liveZoneScore * 0.15
      : 0.06 + this.liveZoneScore * 0.08;
    this.fmOutputGain?.gain.setTargetAtTime(volume, now, 0.3);

    this.sequenceTimeout = setTimeout(() => {
      this.scheduleFMUpdate();
    }, 80); // ~12.5 Hz update rate
  }

  private teardownFMSynth() {
    try {
      this.fmCarrier?.stop();
      this.fmCarrier?.disconnect();
    } catch (_) {}
    try {
      this.fmModulator?.stop();
      this.fmModulator?.disconnect();
    } catch (_) {}
    try { this.fmModGain?.disconnect(); } catch (_) {}
    try { this.fmOutputGain?.disconnect(); } catch (_) {}

    this.fmCarrier = null;
    this.fmModulator = null;
    this.fmModGain = null;
    this.fmOutputGain = null;
  }

  // ─── MODE 3: Brainwave Drums (Percussive Synth) ───────
  private scheduleDrumHit() {
    if (!this.isPlaying || this.currentMode !== 'brainwave-drums' || !this.ctx || !this.neuroFilter) return;

    const now = this.ctx.currentTime;
    const alphaNorm = Math.min(1, Math.max(0, this.liveAlpha / 20));
    const betaNorm = Math.min(1, Math.max(0, this.liveBeta / 20));
    const thetaNorm = Math.min(1, Math.max(0, this.liveTheta / 15));

    // Velocity from zone score
    const vel = this.liveInZone
      ? 0.18 + this.liveZoneScore * 0.20
      : 0.05 + this.liveZoneScore * 0.08;

    // Alpha selects which sound: low alpha = kick, mid = snare, high = hi-hat
    if (alphaNorm < 0.35) {
      this.synthKick(now, vel);
    } else if (alphaNorm < 0.65) {
      this.synthSnare(now, vel * 0.7);
    } else {
      this.synthHiHat(now, vel * 0.5);
    }

    // Occasionally layer a secondary sound based on theta (ghost notes)
    if (thetaNorm > 0.5 && this.liveInZone) {
      this.synthHiHat(now + 0.05, vel * 0.15);
    }

    // Attention controls tempo (120–320ms inter-onset)
    const interOnsetMs = 320 - this.liveAttention * 180;
    // Beta adds swing feel (slight timing offset on alternating hits)
    const swing = betaNorm * 30;
    const nextDelay = Math.max(100, interOnsetMs + (Math.random() > 0.5 ? swing : -swing * 0.5));

    this.sequenceTimeout = setTimeout(() => {
      this.scheduleDrumHit();
    }, nextDelay);
  }

  /** Synthesized kick drum: sine wave frequency sweep + click. */
  private synthKick(time: number, vel: number) {
    if (!this.ctx || !this.neuroFilter) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);

    gain.gain.setValueAtTime(vel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);

    osc.connect(gain);
    gain.connect(this.neuroFilter);
    osc.start(time);
    osc.stop(time + 0.4);
  }

  /** Synthesized snare: filtered noise burst. */
  private synthSnare(time: number, vel: number) {
    if (!this.ctx || !this.neuroFilter) return;

    const bufferSize = Math.floor(this.ctx.sampleRate * 0.15);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(3000, time);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

    // Body tone (sine at ~180Hz)
    const body = this.ctx.createOscillator();
    const bodyGain = this.ctx.createGain();
    body.type = 'triangle';
    body.frequency.setValueAtTime(180, time);
    bodyGain.gain.setValueAtTime(vel * 0.5, time);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.neuroFilter);

    body.connect(bodyGain);
    bodyGain.connect(this.neuroFilter);

    noise.start(time);
    noise.stop(time + 0.15);
    body.start(time);
    body.stop(time + 0.1);
  }

  /** Synthesized hi-hat: bandpass-filtered noise, very short. */
  private synthHiHat(time: number, vel: number) {
    if (!this.ctx || !this.neuroFilter) return;

    const bufferSize = Math.floor(this.ctx.sampleRate * 0.06);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(8000, time);
    filter.Q.setValueAtTime(2.0, time);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.neuroFilter);
    noise.start(time);
    noise.stop(time + 0.06);
  }

  // ─── Cleanup ──────────────────────────────
  public cleanup() {
    this.stop();
    this.teardownFMSynth();
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

export const generativeMusicEngine = new GenerativeMusicEngine();
