import React, { useEffect, useState, useRef } from 'react';
import { eegEngine } from '../../services/eegEngine';

type NarrativeScene = {
  id: number;
  imageUrl: string;
  text: string;
  requiresReflection: boolean;
};

// Atmospheric graphic-novel style with minimal text to reduce EOG artifacts
const SCENES: NarrativeScene[] = [
  {
    id: 1,
    imageUrl: 'https://images.unsplash.com/photo-1518241353330-0f7941c2d9b5?auto=format&fit=crop&w=1200&q=80',
    text: 'The city below fades into silence...',
    requiresReflection: false,
  },
  {
    id: 2,
    imageUrl: 'https://images.unsplash.com/photo-1444084316824-dc26d6657664?auto=format&fit=crop&w=1200&q=80',
    text: 'Breathe out. Let the mist settle.',
    requiresReflection: true,
  },
  {
    id: 3,
    imageUrl: 'https://images.unsplash.com/photo-1472712739516-7ad2b786e1f7?auto=format&fit=crop&w=1200&q=80',
    text: 'A clear path reveals itself through the pines.',
    requiresReflection: true,
  },
  {
    id: 4,
    imageUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
    text: 'The dawn breaks. You have arrived.',
    requiresReflection: false,
  }
];

export const NarrativeTherapyMode: React.FC = () => {
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [reflectionProgress, setReflectionProgress] = useState(0); // 0 to 100
  
  const inZoneStartTimeRef = useRef<number | null>(null);
  
  // Reflection Gate: Require holding target state continuously for 6 seconds
  const targetDurationMs = 6000; 

  const currentScene = SCENES[currentSceneIndex];

  useEffect(() => {
    const unsubscribe = eegEngine.subscribe((data) => {
      if (!currentScene.requiresReflection) return;

      if (data.inZone) {
        if (inZoneStartTimeRef.current === null) {
          inZoneStartTimeRef.current = Date.now();
        }
        const elapsed = Date.now() - inZoneStartTimeRef.current;
        const progress = Math.min((elapsed / targetDurationMs) * 100, 100);
        setReflectionProgress(progress);

        if (progress >= 100) {
          // Unlock next scene
          inZoneStartTimeRef.current = null;
          setReflectionProgress(0);
          if (currentSceneIndex < SCENES.length - 1) {
            setCurrentSceneIndex(prev => prev + 1);
          }
        }
      } else {
        // Reset progress if they fall out of the zone
        inZoneStartTimeRef.current = null;
        setReflectionProgress(prev => Math.max(0, prev - 2)); // gradual decay instead of instant wipe
      }
    });

    return unsubscribe;
  }, [currentScene, currentSceneIndex]);

  const handleNextClick = () => {
    if (!currentScene.requiresReflection && currentSceneIndex < SCENES.length - 1) {
      setCurrentSceneIndex(prev => prev + 1);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh', backgroundColor: '#000', overflow: 'hidden', fontFamily: 'system-ui, serif' }}>
      {/* Graphic Novel Background */}
      <div 
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundImage: `url(${currentScene.imageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.6,
          transition: 'background-image 2s ease-in-out',
        }}
      />
      
      {/* Vignette Overlay */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'radial-gradient(circle, rgba(0,0,0,0) 30%, rgba(0,0,0,0.8) 100%)'
      }} />

      {/* Narrative Text (Minimal to avoid EOG artifacts) */}
      <div style={{
        position: 'absolute',
        bottom: '15%',
        left: '50%',
        transform: 'translateX(-50%)',
        textAlign: 'center',
        width: '80%',
        maxWidth: '600px',
      }}>
        <h2 style={{ 
          color: '#fff', 
          fontSize: '28px', 
          fontWeight: 300, 
          letterSpacing: '1px', 
          textShadow: '0px 2px 4px rgba(0,0,0,0.8)',
          transition: 'opacity 1s ease',
        }}>
          {currentScene.text}
        </h2>
        
        {/* Reflection Gate UI */}
        {currentScene.requiresReflection ? (
          <div style={{ marginTop: '40px' }}>
            <p style={{ color: '#aaa', fontSize: '12px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '12px' }}>
              Hold Target State to Progress
            </p>
            <div style={{ width: '200px', height: '2px', background: 'rgba(255,255,255,0.2)', margin: '0 auto', position: 'relative' }}>
              <div style={{
                position: 'absolute',
                top: 0, left: 0, bottom: 0,
                width: `${reflectionProgress}%`,
                background: '#fff',
                transition: 'width 0.2s ease',
                boxShadow: '0 0 10px rgba(255,255,255,0.8)'
              }} />
            </div>
          </div>
        ) : (
          <button 
            onClick={handleNextClick}
            style={{
              marginTop: '40px',
              padding: '10px 30px',
              background: 'none',
              border: '1px solid rgba(255,255,255,0.4)',
              color: '#fff',
              cursor: 'pointer',
              letterSpacing: '1px',
              borderRadius: '4px',
              transition: 'background 0.3s ease'
            }}
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
};
