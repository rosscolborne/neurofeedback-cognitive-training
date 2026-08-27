import React, { useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { XR, createXRStore } from '@react-three/xr';
import { Stars, Cloud, Environment, Sparkles, Icosahedron } from '@react-three/drei';
import * as THREE from 'three';
import { eegEngine } from '../../services/eegEngine';

const store = createXRStore();

const NeuralArtifact = ({ eegDataRef }: { eegDataRef: React.MutableRefObject<{ inZone: boolean, alpha: number, coherence: number }> }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame((state, delta) => {
    if (!meshRef.current || !materialRef.current) return;

    const { inZone, coherence } = eegDataRef.current;
    const time = state.clock.getElapsedTime();

    // Base rotation
    meshRef.current.rotation.y += delta * (inZone ? 0.2 : 0.05);
    meshRef.current.rotation.x += delta * 0.1;

    // Breathing scale effect driven by coherence
    const breathScale = 1 + Math.sin(time * 2) * 0.05;
    const targetScale = inZone ? 1.5 + (coherence / 100) * 0.5 : 1.0;
    const currentScale = meshRef.current.scale.x;
    
    // Smooth interpolation to target scale
    const newScale = THREE.MathUtils.lerp(currentScale, targetScale * breathScale, delta * 2);
    meshRef.current.scale.set(newScale, newScale, newScale);

    // Emissive glow driven by state
    const targetEmissiveIntensity = inZone ? 2.0 + (coherence / 100) * 2 : 0.2;
    materialRef.current.emissiveIntensity = THREE.MathUtils.lerp(
      materialRef.current.emissiveIntensity, 
      targetEmissiveIntensity, 
      delta * 3
    );

    // Color shift: Cool blue when out of zone, warm gold/orange when in zone
    const targetColor = inZone ? new THREE.Color('#FFD700') : new THREE.Color('#4A90D9');
    materialRef.current.emissive.lerp(targetColor, delta * 2);
    materialRef.current.color.lerp(targetColor, delta * 2);
  });

  return (
    <Icosahedron ref={meshRef} args={[1, 1]} position={[0, 1.5, -4]}>
      <meshStandardMaterial 
        ref={materialRef}
        color="#4A90D9" 
        emissive="#4A90D9"
        emissiveIntensity={0.2}
        wireframe={true}
        transparent={true}
        opacity={0.8}
      />
    </Icosahedron>
  );
};

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
    
    // Smooth, atmospheric transitions for visual guardrails
    // Dissipate fog gently when inZone, thicken when out
    const targetFogDensity = inZone ? 0.01 : 0.08;
    if (fogRef.current) {
      fogRef.current.density = THREE.MathUtils.lerp(fogRef.current.density, targetFogDensity, delta * 0.5);
    }

    // Warmth of ambient light gently increases with neural coherence
    const targetIntensity = inZone ? 0.8 + (coherence / 100) * 0.5 : 0.2;
    if (ambientLightRef.current) {
      ambientLightRef.current.intensity = THREE.MathUtils.lerp(ambientLightRef.current.intensity, targetIntensity, delta * 0.4);
    }
  });

  return (
    <>
      <fogExp2 ref={fogRef} attach="fog" args={['#020208', 0.08]} />
      <ambientLight ref={ambientLightRef} intensity={0.2} color="#ffffff" />
      <directionalLight position={[5, 10, 5]} intensity={0.5} color="#ffffff" />
      
      {/* Central Neural Artifact */}
      <NeuralArtifact eegDataRef={eegDataRef} />
      
      {/* Subtle particle field representing neural cohesion */}
      <Sparkles count={500} scale={20} size={2.5} speed={0.2} opacity={0.5} color="#FFD700" />
      
      {/* Deep background clouds for atmosphere without high-contrast motion */}
      <Cloud position={[-8, -2, -20]} speed={0.1} opacity={0.25} color="#1a1a3a" />
      <Cloud position={[8, 4, -25]} speed={0.1} opacity={0.25} color="#2a1a3a" />
      
      <Stars radius={100} depth={50} count={3000} factor={4} saturation={1} fade speed={0.5} />
      <Environment preset="night" />
    </>
  );
};

export const GenerativeWebXRCanvas: React.FC = () => {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh', background: 'radial-gradient(circle at center, #0a0a1a 0%, #000000 100%)' }}>
      <button 
        onClick={() => store.enterAR()}
        style={{
          position: 'absolute',
          bottom: '40px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          padding: '14px 32px',
          background: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255,255,255,0.2)',
          color: 'white',
          borderRadius: '30px',
          backdropFilter: 'blur(12px)',
          cursor: 'pointer',
          fontFamily: 'system-ui, sans-serif',
          fontSize: '15px',
          letterSpacing: '1px',
          textTransform: 'uppercase',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          transition: 'all 0.3s ease',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
          e.currentTarget.style.transform = 'translateX(-50%) scale(1.05)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          e.currentTarget.style.transform = 'translateX(-50%) scale(1)';
        }}
      >
        Enter Immersive AR / VR
      </button>
      
      <Canvas camera={{ position: [0, 1.5, 2], fov: 60 }}>
        <XR store={store}>
          <AtmosphericScene />
        </XR>
      </Canvas>
    </div>
  );
};
