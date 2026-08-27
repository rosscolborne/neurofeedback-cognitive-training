import React, { useEffect, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { audioFeedbackEngine } from '../../services/audioFeedbackEngine';

export const SpatialAudioMode: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    // Cleanup on unmount
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#0a0a0a', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center', maxWidth: '400px', padding: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 300, marginBottom: '16px', letterSpacing: '1px' }}>Spatial Audio Meditation</h2>
        <p style={{ color: '#888', fontSize: '14px', lineHeight: 1.6, marginBottom: '40px' }}>
          Close your eyes and focus on your breath. The ambient soundscape will unfold and surround you as you reach your target state.
        </p>
        
        <button
          onClick={toggleAudio}
          style={{
            background: isPlaying ? 'rgba(255,255,255,0.1)' : '#fff',
            color: isPlaying ? '#fff' : '#000',
            border: 'none',
            borderRadius: '50%',
            width: '80px',
            height: '80px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            margin: '0 auto'
          }}
        >
          {isPlaying ? <Square fill="#fff" size={24} /> : <Play fill="#000" size={28} style={{ marginLeft: '4px' }} />}
        </button>
      </div>
    </div>
  );
};
