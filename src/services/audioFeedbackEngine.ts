import { eegEngine } from './eegEngine';

class AudioFeedbackEngine {
  private ctx: AudioContext | null = null;
  private isInitialized = false;

  // Nodes
  private masterGain: GainNode | null = null;
  private noiseNode: AudioBufferSourceNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  private pannerNode: StereoPannerNode | null = null;
  private droneOsc: OscillatorNode | null = null;
  private droneGain: GainNode | null = null;

  private unsubscribe: (() => void) | null = null;

  public async initialize() {
    if (this.isInitialized) return;

    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
    
    // Create an atmospheric noise buffer (Pink Noise approximation for Ocean/Rain)
    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = output[i];
      output[i] *= 3.5; // Compensate for gain
    }

    this.noiseNode = this.ctx.createBufferSource();
    this.noiseNode.buffer = noiseBuffer;
    this.noiseNode.loop = true;

    // Filter node (Lowpass to muffle when out of zone)
    this.filterNode = this.ctx.createBiquadFilter();
    this.filterNode.type = 'lowpass';
    this.filterNode.frequency.value = 400; // Start muffled

    // Panner for spatial expansion
    this.pannerNode = this.ctx.createStereoPanner();
    this.pannerNode.pan.value = 0;

    this.noiseNode.connect(this.filterNode);
    this.filterNode.connect(this.pannerNode);
    this.pannerNode.connect(this.masterGain);

    // Binaural Drone (Ambient layer)
    this.droneOsc = this.ctx.createOscillator();
    this.droneOsc.type = 'sine';
    this.droneOsc.frequency.value = 110; // A2
    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.value = 0; // Starts silent
    this.droneOsc.connect(this.droneGain);
    this.droneGain.connect(this.masterGain);

    this.noiseNode.start();
    this.droneOsc.start();

    this.isInitialized = true;

    // Subscribe to EEG Engine telemetry
    this.unsubscribe = eegEngine.subscribe((data) => {
      this.updateParameters(data.inZone, data.coherence);
    });
  }

  private updateParameters(inZone: boolean, coherence: number) {
    if (!this.ctx || !this.filterNode || !this.droneGain) return;

    const now = this.ctx.currentTime;
    
    // Guardrail: Use setTargetAtTime to prevent audio clicks/pops from telemetry jitter
    const targetFreq = inZone ? 8000 : 400; // Open up filter when in zone
    this.filterNode.frequency.setTargetAtTime(targetFreq, now, 0.25);

    // Fade in drone based on coherence
    const targetDroneVol = inZone ? 0.05 + (coherence / 100) * 0.1 : 0.0;
    this.droneGain.gain.setTargetAtTime(targetDroneVol, now, 0.5);
  }

  public suspend() {
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend();
    }
  }

  public resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public cleanup() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.noiseNode) this.noiseNode.stop();
    if (this.droneOsc) this.droneOsc.stop();
    if (this.ctx) this.ctx.close();
    this.isInitialized = false;
  }
}

// Global variable for pseudo-pink noise generation
let lastOut = 0;

export const audioFeedbackEngine = new AudioFeedbackEngine();
