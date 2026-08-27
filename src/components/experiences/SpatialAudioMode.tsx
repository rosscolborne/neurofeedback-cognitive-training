import React, { useEffect, useState } from 'react';
import { Play, Square, Headphones } from 'lucide-react';
import { audioFeedbackEngine } from '../../services/audioFeedbackEngine';
import { EEGDataPoint } from '../../types';

interface SpatialAudioProps {
  eegData: EEGDataPoint | null;
}

export const SpatialAudioMode: React.FC<SpatialAudioProps> = ({ eegData }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [coherence, setCoherence] = useState(0);
  const [inZone, setInZone] = useState(false);

  useEffect(() => {
    if (eegData) {
      setCoherence(eegData.coherence);
      setInZone(eegData.inZone);
    }
  }, [eegData]);

  useEffect(() => {
    return () => {
      audioFeedbackEngine.cleanup();
    };
  }, []);

  const toggleAudio = async () => {
    if (!isPlaying) {
      await audioFeedbackEngine.initialize();
      audioFeedbackEngine.resume();
      setIsPlaying(true);
    } else {
      audioFeedbackEngine.suspend();
      setIsPlaying(false);
    }
  };

  // Orbital UI logic
  const renderOrbitalNodes = () => {
    if (!isPlaying) return null;

    // Based on the 3 voices in the audio engine
    const nodes = [
      { color: '#4A90D9', speed: '5s', delay: '0s', active: inZone }, // Root
      { color: '#5C8C46', speed: '3.5s', delay: '-1s', active: inZone && coherence > 30 }, // Fifth
      { color: '#E4B87C', speed: '2.5s', delay: '-2s', active: inZone && coherence > 60 }, // Octave
    ];

    return nodes.map((node, i) => (
      <div
        key={i}
        style={{
          position: 'absolute',
          top: '50%', left: '50%',
          width: `${150 + i * 50}px`,
          height: `${150 + i * 50}px`,
          marginLeft: `-${(150 + i * 50) / 2}px`,
          marginTop: `-${(150 + i * 50) / 2}px`,
          borderRadius: '50%',
          border: `1px solid rgba(255,255,255,${node.active ? 0.1 : 0.02})`,
          animation: `spin ${node.speed} linear infinite`,
          animationDelay: node.delay,
          pointerEvents: 'none',
        }}
      >
        <div style={{
          position: 'absolute',
          top: '-6px',
          left: '50%',
          marginLeft: '-6px',
          width: '12px',
          height: '12px',
          backgroundColor: node.color,
          borderRadius: '50%',
          boxShadow: `0 0 15px ${node.color}`,
          opacity: node.active ? 1 : 0.1,
          transition: 'opacity 1s ease',
        }} />
      </div>
    ));
  };

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#050508', color: '#fff', fontFamily: 'system-ui, sans-serif', overflow: 'hidden' }}>
      
      <style>
        {`
          @keyframes spin {
            100% { transform: rotate(360deg); }
          }
          @keyframes pulseGlow {
            0% { box-shadow: 0 0 30px rgba(74, 144, 217, 0.1); }
            50% { box-shadow: 0 0 60px rgba(74, 144, 217, 0.4); }
            100% { box-shadow: 0 0 30px rgba(74, 144, 217, 0.1); }
          }
        `}
      </style>

      {/* Orbital Visualizer Background */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        {renderOrbitalNodes()}
      </div>

      <div style={{ textAlign: 'center', maxWidth: '450px', padding: '32px', zIndex: 10, background: 'rgba(5, 5, 8, 0.7)', borderRadius: '24px', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <Headphones size={48} color={inZone ? "#4A90D9" : "#666"} style={{ marginBottom: '20px', transition: 'color 1s ease' }} />
        
        <h2 style={{ fontSize: '28px', fontWeight: 300, marginBottom: '12px', letterSpacing: '2px' }}>
          Spatial Harmonics
        </h2>
        
        <p style={{ color: '#888', fontSize: '15px', lineHeight: 1.6, marginBottom: '40px' }}>
          Put on your headphones and close your eyes. A 3D harmonic drone will physically orbit around you as your neural coherence rises.
        </p>
        
        <button
          onClick={toggleAudio}
          style={{
            background: isPlaying ? 'rgba(74, 144, 217, 0.1)' : '#fff',
            color: isPlaying ? '#4A90D9' : '#000',
            border: isPlaying ? '1px solid #4A90D9' : 'none',
            borderRadius: '50%',
            width: '80px',
            height: '80px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            margin: '0 auto',
            animation: isPlaying && inZone ? 'pulseGlow 3s ease-in-out infinite' : 'none',
          }}
        >
          {isPlaying ? <Square fill="currentColor" size={24} /> : <Play fill="currentColor" size={28} style={{ marginLeft: '4px' }} />}
        </button>

        {isPlaying && (
          <div style={{ marginTop: '30px', fontSize: '12px', color: '#666', letterSpacing: '2px', textTransform: 'uppercase' }}>
            {inZone ? (coherence > 60 ? 'Full Chord Activated' : 'Harmonics Expanding') : 'Listening for Target State...'}
          </div>
        )}
      </div>
    </div>
  );
};
