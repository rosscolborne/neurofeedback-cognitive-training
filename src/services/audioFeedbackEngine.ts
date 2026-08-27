import { eegEngine } from './eegEngine';

class AudioFeedbackEngine {
  private ctx: AudioContext | null = null;
  private isInitialized = false;

  private masterGain: GainNode | null = null;
  
  // Harmonic Drones
  private voices: { osc: OscillatorNode, panner: PannerNode, gain: GainNode, angle: number, speed: number }[] = [];
  
  private unsubscribe: (() => void) | null = null;
  private orbitInterval: NodeJS.Timeout | null = null;

  public async initialize() {
    if (this.isInitialized) return;

    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.5;
    this.masterGain.connect(this.ctx.destination);

    // Setup 3 harmonic voices (e.g., A2, E3, A3 - Root, Fifth, Octave)
    const frequencies = [110, 164.81, 220]; 
    const speeds = [0.2, 0.35, 0.5]; // Orbit speeds
    const angles = [0, Math.PI * (2/3), Math.PI * (4/3)]; // Starting angles

    frequencies.forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const panner = this.ctx!.createPanner();
      const gain = this.ctx!.createGain();

      osc.type = i === 0 ? 'sine' : 'triangle'; // Richer harmonics
      osc.frequency.value = freq;

      // True Spatial 3D Panner
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.maxDistance = 10000;
      panner.rolloffFactor = 1;
      panner.setPosition(Math.cos(angles[i]) * 2, 0, Math.sin(angles[i]) * 2);

      gain.gain.value = 0; // Starts silent

      osc.connect(panner);
      panner.connect(gain);
      gain.connect(this.masterGain!);

      osc.start();

      this.voices.push({ osc, panner, gain, angle: angles[i], speed: speeds[i] });
    });

    this.isInitialized = true;

    // Start Orbital Math Loop
    this.orbitInterval = setInterval(() => this.updateOrbits(), 1000 / 30); // 30 FPS for audio positional updates

    // Subscribe to EEG Engine telemetry
    this.unsubscribe = eegEngine.subscribe((data) => {
      this.updateParameters(data.inZone, data.coherence);
    });
  }

  private updateOrbits() {
    if (!this.ctx) return;
    
    this.voices.forEach(voice => {
      voice.angle += voice.speed * 0.05;
      const x = Math.cos(voice.angle) * 3; // Orbit radius of 3
      const z = Math.sin(voice.angle) * 3;
      
      // Update spatial position
      if (voice.panner.positionX) {
        // Modern Web Audio API
        voice.panner.positionX.setTargetAtTime(x, this.ctx!.currentTime, 0.1);
        voice.panner.positionY.setTargetAtTime(0, this.ctx!.currentTime, 0.1);
        voice.panner.positionZ.setTargetAtTime(z, this.ctx!.currentTime, 0.1);
      } else {
        // Legacy fallback
        voice.panner.setPosition(x, 0, z);
      }
    });
  }

  private updateParameters(inZone: boolean, coherence: number) {
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    
    // Fade in voices based on state and coherence
    this.voices.forEach((voice, i) => {
      // Voice 0 (Root) is always present if inZone
      // Voices 1 and 2 (Harmonics) require higher coherence
      let targetVol = 0;
      if (inZone) {
        if (i === 0) targetVol = 0.2 + (coherence / 100) * 0.2;
        if (i === 1 && coherence > 30) targetVol = (coherence / 100) * 0.3;
        if (i === 2 && coherence > 60) targetVol = ((coherence - 40) / 100) * 0.2;
      }
      
      voice.gain.gain.setTargetAtTime(targetVol, now, 1.0);
    });
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
    if (this.orbitInterval) {
      clearInterval(this.orbitInterval);
      this.orbitInterval = null;
    }
    this.voices.forEach(v => v.osc.stop());
    this.voices = [];
    if (this.ctx) this.ctx.close();
    this.isInitialized = false;
  }
}

export const audioFeedbackEngine = new AudioFeedbackEngine();
