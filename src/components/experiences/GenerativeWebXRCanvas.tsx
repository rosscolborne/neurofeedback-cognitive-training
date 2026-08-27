import React, { useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { XR, createXRStore } from '@react-three/xr';
import { Stars, Cloud, Environment, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { eegEngine } from '../../services/eegEngine';

const store = createXRStore();

const AtmosphericScene = () => {
  const fogRef = useRef<THREE.FogExp2>(null);
  const ambientLightRef = useRef<THREE.AmbientLight>(null);
  
  // Use a ref to hold the latest eeg data to avoid re-renders on the main thread
  const eegDataRef = useRef({ inZone: false, alpha: 0, coherence: 0 });

  useEffect(() => {
    const unsubscribe = eegEngine.subscribe((data) => {
      eegDataRef.current = {
        inZone: data.inZone,
        alpha: data.bands.alpha,
        coherence: data.coherence,
      };
    });
    return unsubscribe;
  }, []);

  useFrame((state, delta) => {
    const { inZone, coherence } = eegDataRef.current;
    
    // Smooth, atmospheric transitions for visual guardrails (Preventing ERD)
    // Dissipate fog gently when inZone, thicken when out
    const targetFogDensity = inZone ? 0.015 : 0.06;
    if (fogRef.current) {
      fogRef.current.density = THREE.MathUtils.lerp(fogRef.current.density, targetFogDensity, delta * 0.3);
    }

    // Warmth of ambient light gently increases with neural coherence
    const targetIntensity = inZone ? 0.7 + (coherence / 100) * 0.4 : 0.3;
    if (ambientLightRef.current) {
      ambientLightRef.current.intensity = THREE.MathUtils.lerp(ambientLightRef.current.intensity, targetIntensity, delta * 0.4);
    }
  });

  return (
    <>
      <fogExp2 ref={fogRef} attach="fog" args={['#050510', 0.06]} />
      <ambientLight ref={ambientLightRef} intensity={0.3} color="#b0c4de" />
      <directionalLight position={[5, 10, 5]} intensity={0.15} color="#ffffff" />
      
      {/* Subtle particle field representing neural cohesion */}
      <Sparkles count={300} scale={15} size={1.5} speed={0.1} opacity={0.3} color="#88aaff" />
      
      {/* Deep background clouds for atmosphere without high-contrast motion */}
      <Cloud position={[-6, -2, -15]} speed={0.05} opacity={0.15} color="#0a0a20" />
      <Cloud position={[6, 2, -20]} speed={0.05} opacity={0.15} color="#0a0a20" />
      
      <Stars radius={50} depth={50} count={1500} factor={3} saturation={0} fade speed={0.2} />
      <Environment preset="night" />
    </>
  );
};

export const GenerativeWebXRCanvas: React.FC = () => {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh', background: '#000' }}>
      <button 
        onClick={() => store.enterAR()}
        style={{
          position: 'absolute',
          bottom: '30px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          padding: '12px 24px',
          background: 'rgba(255, 255, 255, 0.1)',
          border: '1px solid rgba(255,255,255,0.2)',
          color: 'white',
          borderRadius: '8px',
          backdropFilter: 'blur(10px)',
          cursor: 'pointer',
          fontFamily: 'system-ui, sans-serif',
          fontSize: '14px',
          letterSpacing: '0.5px'
        }}
      >
        Enter Immersive AR / VR
      </button>
      
      <Canvas camera={{ position: [0, 0, 5] }}>
        <XR store={store}>
          <AtmosphericScene />
        </XR>
      </Canvas>
    </div>
  );
};
