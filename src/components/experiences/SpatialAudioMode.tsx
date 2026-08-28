import React, { useEffect, useState } from 'react';
import { Play, Square, Headphones, Sparkles } from 'lucide-react';
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

    const nodes = [
      { color: '#E8967A', speed: '5s', delay: '0s', active: inZone }, // Root
      { color: '#5C8C46', speed: '3.5s', delay: '-1s', active: inZone && coherence > 30 }, // Fifth
      { color: '#E4B87C', speed: '2.5s', delay: '-2s', active: inZone && coherence > 60 }, // Octave
    ];

    return nodes.map((node, i) => (
      <div
        key={i}
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: `${140 + i * 45}px`,
          height: `${140 + i * 45}px`,
          marginLeft: `-${(140 + i * 45) / 2}px`,
          marginTop: `-${(140 + i * 45) / 2}px`,
          borderRadius: '50%',
          border: `1px solid rgba(255,255,255,${node.active ? 0.15 : 0.04})`,
          animation: `spin ${node.speed} linear infinite`,
          animationDelay: node.delay,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '-6px',
            left: '50%',
            marginLeft: '-6px',
            width: '12px',
            height: '12px',
            backgroundColor: node.color,
            borderRadius: '50%',
            boxShadow: `0 0 15px ${node.color}`,
            opacity: node.active ? 1 : 0.15,
            transition: 'opacity 0.8s ease',
          }}
        />
      </div>
    ));
  };

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: '#0A0A0F',
        color: '#FFFFFF',
        fontFamily: 'var(--font-body)',
        overflow: 'hidden',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <style>
        {`
          @keyframes spin {
            100% { transform: rotate(360deg); }
          }
          @keyframes pulseGlow {
            0% { box-shadow: 0 0 25px rgba(232, 150, 122, 0.2); }
            50% { box-shadow: 0 0 50px rgba(232, 150, 122, 0.5); }
            100% { box-shadow: 0 0 25px rgba(232, 150, 122, 0.2); }
          }
        `}
      </style>

      {/* Orbital Visualizer Background */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        {renderOrbitalNodes()}
      </div>

      <div
        style={{
          textAlign: 'center',
          maxWidth: '380px',
          padding: '24px',
          zIndex: 10,
          background: 'rgba(15, 17, 26, 0.85)',
          borderRadius: 'var(--radius-xl)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        }}
      >
        <div
          style={{
            width: '54px',
            height: '54px',
            borderRadius: '50%',
            backgroundColor: inZone ? 'rgba(232, 150, 122, 0.2)' : 'rgba(255, 255, 255, 0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px auto',
            transition: 'all 0.4s ease',
          }}
        >
          <Headphones size={28} color={inZone ? 'var(--brand-primary)' : '#888'} />
        </div>

        <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px', letterSpacing: '0.04em' }}>
          Spatial Harmonics
        </h2>

        <p style={{ color: '#A0AEC0', fontSize: '13px', lineHeight: 1.5, marginBottom: '24px' }}>
          Put on your headphones. A 3D binaural harmonic drone physically orbits in space around you as your neural coherence rises.
        </p>

        <button
          onClick={toggleAudio}
          style={{
            background: isPlaying ? 'rgba(232, 150, 122, 0.15)' : 'var(--brand-primary)',
            color: isPlaying ? 'var(--brand-primary)' : '#FFFFFF',
            border: isPlaying ? '1.5px solid var(--brand-primary)' : 'none',
            borderRadius: '50%',
            width: '68px',
            height: '68px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            margin: '0 auto',
            animation: isPlaying && inZone ? 'pulseGlow 2.5s ease-in-out infinite' : 'none',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          }}
        >
          {isPlaying ? <Square fill="currentColor" size={20} /> : <Play fill="currentColor" size={24} style={{ marginLeft: '3px' }} />}
        </button>

        {isPlaying && (
          <div style={{ marginTop: '20px', fontSize: '11px', color: inZone ? '#68D391' : '#CBD5E0', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {inZone ? (coherence > 60 ? '✨ Full Harmonic Chord Active' : '🎵 Harmonics Expanding') : 'Listening for Target Neural State...'}
          </div>
        )}
      </div>
    </div>
  );
};
