import React, { useEffect, useState } from 'react';
import { EEGDataPoint } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { Volume2, VolumeX, Waves, CloudRain, Wind, Moon, Headphones } from 'lucide-react';

interface SoundscapeProps {
  eegData: EEGDataPoint | null;
  isPaused?: boolean;
}

const SOUNDSCAPES = [
  { id: 'ocean', name: 'Pacific Shore Swell', icon: Waves, desc: 'Rhythmic 8s ocean surf waves modulated by Alpha power' },
  { id: 'rain', name: 'Verdant Forest Rain', icon: CloudRain, desc: 'Soft pink-noise rain drops filtered through canopy' },
  { id: 'binaural-alpha', name: '10 Hz Alpha Entrainment', icon: Wind, desc: 'Dual-ear 216Hz/226Hz carrier for deep calm meditation' },
  { id: 'binaural-theta', name: '6 Hz Theta Twilight', icon: Moon, desc: 'Hypnagogic crossover frequency for creative visualization' },
];

export const SoundscapePlayer: React.FC<SoundscapeProps> = ({ eegData, isPaused = false }) => {
  const [selected, setSelected] = useState(SOUNDSCAPES[0]);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (isPaused) {
      audioEngine.stopAll();
      return;
    }

    if (selected.id === 'ocean') {
      audioEngine.startNatureSoundscape('ocean');
    } else if (selected.id === 'rain') {
      audioEngine.startNatureSoundscape('rain');
    } else if (selected.id === 'binaural-alpha') {
      audioEngine.startBinauralBeat(216, 10);
    } else if (selected.id === 'binaural-theta') {
      audioEngine.startBinauralBeat(216, 6);
    }

    return () => {
      audioEngine.stopAll();
    };
  }, [selected, isPaused]);

  useEffect(() => {
    if (eegData) {
      audioEngine.updateNeuroFeedback(eegData.inZone);
    }
  }, [eegData]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    audioEngine.setMuted(next);
  };

  const SelectedIcon = selected.icon;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--surface-patient-base)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {/* Top Header */}
      <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--brand-primary-subtle)',
              color: 'var(--brand-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SelectedIcon size={16} />
          </div>
          <span style={{ fontWeight: 600, fontSize: '15px' }}>{selected.name}</span>
        </div>
        <button
          onClick={toggleMute}
          className="btn btn-ghost"
          style={{ padding: '6px 12px' }}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      </div>

      {/* Center Visual Soundwave Pulse */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', margin: 'auto 0' }}>
        <div
          className="animate-breathe"
          style={{
            width: '140px',
            height: '140px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, var(--brand-primary-subtle) 0%, rgba(248, 247, 244, 0) 70%)',
            border: '2px solid var(--brand-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: '70px',
              height: '70px',
              borderRadius: '50%',
              backgroundColor: 'var(--brand-primary)',
              opacity: eegData?.inZone ? 0.9 : 0.4,
              transition: 'all 0.8s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
            }}
          >
            <Waves size={28} />
          </div>
        </div>

        <div style={{ textAlign: 'center', maxWidth: '300px' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{selected.desc}</div>
        </div>
      </div>

      {/* Selector Grid */}
      <div style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        {SOUNDSCAPES.map(s => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              onClick={() => setSelected(s)}
              style={{
                background: selected.id === s.id ? 'var(--brand-primary-subtle)' : 'var(--surface-patient-card)',
                border: selected.id === s.id ? '1.5px solid var(--brand-primary)' : '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '10px 12px',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                transition: 'all 0.15s ease',
              }}
            >
              <Icon size={16} color={selected.id === s.id ? 'var(--brand-primary)' : 'var(--text-secondary)'} />
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{s.name}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
