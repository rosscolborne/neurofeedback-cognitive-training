// Web Worker for EEG Engine

export type EEGWorkerMessage = 
  | { type: 'CALIBRATE_BASELINE'; payload: { rawData: number[][] } }
  | { type: 'EXTRACT_FEATURES'; payload: { rawData: number[][], baselineModel?: any } };

export type EEGWorkerResponse = 
  | { type: 'BASELINE_CALIBRATED'; payload: { alphaPeakHz: number, oneOverFSlope: number } }
  | { type: 'FEATURES_EXTRACTED'; payload: { bands: any, learningScore: number, coherence: number } }
  | { type: 'ERROR'; payload: { message: string } };

// Basic pseudo-FFT / mock extraction for demonstration purposes.
// In production, this would use a WebAssembly module or robust DSP library.
self.addEventListener('message', (e: MessageEvent<EEGWorkerMessage>) => {
  const { type, payload } = e.data;

  if (type === 'CALIBRATE_BASELINE') {
    // Perform intensive 1/f background fitting and IAF peak detection here
    // Simulated calculation:
    let sum = 0;
    let count = 0;
    
    // Process all channels/samples to simulate workload
    for (const channelData of payload.rawData) {
      for (const sample of channelData) {
        sum += sample;
        count++;
      }
    }

    // Simulate baseline model parameters
    const alphaPeakHz = 9.5 + (Math.random() * 2); // 9.5 - 11.5 Hz
    const oneOverFSlope = -1.2 + (Math.random() * 0.4);

    self.postMessage({
      type: 'BASELINE_CALIBRATED',
      payload: {
        alphaPeakHz,
        oneOverFSlope
      }
    });
  } 
  
  if (type === 'EXTRACT_FEATURES') {
    // Perform FFT on live chunks for feedback
    const bands = {
      delta: 0,
      theta: 0,
      alpha: 0,
      smr: 0,
      beta: 0,
      gamma: 0,
    };
    
    // Simulate some logic using baselineModel if provided
    let learningScore = 50;
    if (payload.baselineModel) {
      // Modulate learning score based on baseline model
      learningScore = 50 + (Math.random() * 20);
    }

    self.postMessage({
      type: 'FEATURES_EXTRACTED',
      payload: {
        bands,
        learningScore,
        coherence: 50 + Math.random() * 30
      }
    });
  }
});
