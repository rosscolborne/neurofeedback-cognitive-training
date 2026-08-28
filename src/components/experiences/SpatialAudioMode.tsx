import React, { useEffect, useState, useRef } from 'react';
import { EEGDataPoint } from '../../types';
import { neuroMusicEngine, CLASSICAL_PLAYLIST, ClassicalTrack } from '../../services/neuroMusicEngine';
import { Play, Pause, SkipForward, SkipBack, Music, Upload, Sparkles, Volume2, Disc, Waves } from 'lucide-react';

interface SpatialAudioProps {
  eegData: EEGDataPoint | null;
}

export const SpatialAudioMode: React.FC<SpatialAudioProps> = ({ eegData }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTrackIndex, setActiveTrackIndex] = useState(0);
  const [customTrackName, setCustomTrackName] = useState<string | null>(null);
  const [showPlaylistDrawer, setShowPlaylistDrawer] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentTrack = CLASSICAL_PLAYLIST[activeTrackIndex];
  const inZone = eegData?.inZone ?? true;
  const zoneScore = eegData?.zoneScore ?? (inZone ? 1.0 : 0.0);
  const coherence = eegData?.coherence ?? 75;
  const alphaPower = eegData?.bands.alpha ?? 10.0;

  useEffect(() => {
    return () => {
      neuroMusicEngine.cleanup();
    };
  }, []);

  const handleTogglePlay = async () => {
    if (!isPlaying) {
      await neuroMusicEngine.play();
      setIsPlaying(true);
    } else {
      neuroMusicEngine.pause();
      setIsPlaying(false);
    }
  };

  const handleSelectTrack = async (index: number) => {
    setActiveTrackIndex(index);
    setCustomTrackName(null);
    neuroMusicEngine.setTrack(CLASSICAL_PLAYLIST[index]);
    if (isPlaying) {
      neuroMusicEngine.pause();
      await neuroMusicEngine.play();
    }
    setShowPlaylistDrawer(false);
  };

  const handleNextTrack = async () => {
    const nextIdx = (activeTrackIndex + 1) % CLASSICAL_PLAYLIST.length;
    await handleSelectTrack(nextIdx);
  };

  const handlePrevTrack = async () => {
    const prevIdx = (activeTrackIndex - 1 + CLASSICAL_PLAYLIST.length) % CLASSICAL_PLAYLIST.length;
    await handleSelectTrack(prevIdx);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const fileName = await neuroMusicEngine.loadCustomAudioFile(file);
      setCustomTrackName(fileName);
      await neuroMusicEngine.play();
      setIsPlaying(true);
      setShowPlaylistDrawer(false);
    } catch (err) {
      console.error("Error loading audio file:", err);
    }
  };

  // Acoustic clarity calculation for visual telemetry
  const acousticCutoffKhz = inZone
    ? (4.5 + zoneScore * 14.5).toFixed(1)
    : (0.9 + zoneScore * 2.5).toFixed(1);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#0A0A10',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        color: '#FFFFFF',
        fontFamily: 'var(--font-body)',
        userSelect: 'none',
      }}
    >
      <style>
        {`
          @keyframes vinylSpin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          @keyframes auraPulse {
            0% { transform: scale(1.0); opacity: 0.4; }
            50% { transform: scale(1.08); opacity: 0.8; }
            100% { transform: scale(1.0); opacity: 0.4; }
          }
        `}
      </style>

      {/* Hidden File Input for Custom Music Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />

      {/* Header Bar */}
      <div
        style={{
          padding: '14px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Music size={16} color="var(--brand-primary)" />
          <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#CBD5E0' }}>
            Neuro-Music Therapy
          </span>
        </div>

        {/* Playlist & Upload Buttons */}
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 'var(--radius-sm)',
              padding: '5px 10px',
              color: '#FFFFFF',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Upload size={12} />
            <span>Upload Music</span>
          </button>

          <button
            onClick={() => setShowPlaylistDrawer(true)}
            style={{
              background: 'rgba(232, 150, 122, 0.18)',
              border: '1px solid rgba(232, 150, 122, 0.35)',
              borderRadius: 'var(--radius-sm)',
              padding: '5px 10px',
              color: '#FFFFFF',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Playlist ▾
          </button>
        </div>
      </div>

      {/* Central Visualizer (Vinyl & Harmonic Bio-Aura) */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '10px',
        }}
      >
        {/* Harmonic Bio-Aura Halo */}
        <div
          style={{
            position: 'absolute',
            width: `${210 + (alphaPower / 25) * 60}px`,
            height: `${210 + (alphaPower / 25) * 60}px`,
            borderRadius: '50%',
            background: inZone
              ? `radial-gradient(circle, rgba(232, 150, 122, ${0.45 * zoneScore}) 0%, rgba(212, 175, 55, ${0.2 * zoneScore}) 60%, rgba(0,0,0,0) 100%)`
              : 'radial-gradient(circle, rgba(74, 144, 217, 0.2) 0%, rgba(0,0,0,0) 70%)',
            animation: isPlaying ? 'auraPulse 4.5s ease-in-out infinite' : 'none',
            transition: 'all 0.8s ease',
            pointerEvents: 'none',
          }}
        />

        {/* Rotating Vinyl Record / Audio Mandala Disc */}
        <div
          onClick={handleTogglePlay}
          style={{
            position: 'relative',
            width: '180px',
            height: '180px',
            borderRadius: '50%',
            backgroundColor: '#121218',
            boxShadow: inZone
              ? '0 12px 35px rgba(0, 0, 0, 0.8), 0 0 25px rgba(232, 150, 122, 0.3)'
              : '0 8px 24px rgba(0, 0, 0, 0.6)',
            border: '2px solid rgba(255, 255, 255, 0.1)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: isPlaying ? 'vinylSpin 18s linear infinite' : 'none',
            transition: 'box-shadow 0.6s ease',
          }}
        >
          {/* Vinyl Grooves */}
          {[160, 135, 110, 85].map((size) => (
            <div
              key={size}
              style={{
                position: 'absolute',
                width: `${size}px`,
                height: `${size}px`,
                borderRadius: '50%',
                border: '1px solid rgba(255, 255, 255, 0.04)',
                pointerEvents: 'none',
              }}
            />
          ))}

          {/* Center Label Disc */}
          <div
            style={{
              width: '68px',
              height: '68px',
              borderRadius: '50%',
              backgroundColor: inZone ? 'var(--brand-primary)' : '#2D3748',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.5)',
              transition: 'background-color 0.5s ease',
            }}
          >
            {isPlaying ? (
              <Disc size={26} color="#FFFFFF" />
            ) : (
              <Play size={24} color="#FFFFFF" style={{ marginLeft: '3px' }} />
            )}
          </div>
        </div>

        {/* Real-time Acoustic Filtering HUD Card */}
        <div
          style={{
            marginTop: '16px',
            background: 'rgba(20, 22, 32, 0.85)',
            backdropFilter: 'blur(12px)',
            border: inZone ? '1px solid rgba(232, 150, 122, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            fontSize: '11px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Waves size={13} color="var(--brand-primary)" />
            <span style={{ color: '#CBD5E0' }}>Acoustic Filter:</span>
            <strong style={{ color: inZone ? '#68D391' : '#F6AD55' }}>
              {acousticCutoffKhz} kHz {inZone ? '(Pure)' : '(Muffled)'}
            </strong>
          </div>

          <div style={{ width: '1px', height: '14px', backgroundColor: 'rgba(255,255,255,0.15)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Sparkles size={13} color="#D4AF37" />
            <span style={{ color: '#CBD5E0' }}>State:</span>
            <strong style={{ color: inZone ? '#68D391' : '#F6AD55' }}>
              {inZone ? `In-Zone (${Math.round(zoneScore * 100)}%)` : 'Attention Drift'}
            </strong>
          </div>
        </div>
      </div>

      {/* Bottom Track Controls & Info */}
      <div
        style={{
          padding: '16px 20px',
          backgroundColor: '#12141F',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          zIndex: 10,
        }}
      >
        {/* Track Title & Indication */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#FFFFFF' }}>
              {customTrackName || currentTrack.title}
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#A0AEC0' }}>
              {customTrackName ? 'Custom Audio File' : `${currentTrack.composer} • ${currentTrack.key}`}
            </p>
          </div>

          {!customTrackName && (
            <div
              style={{
                fontSize: '10px',
                color: '#D4AF37',
                background: 'rgba(212, 175, 55, 0.12)',
                padding: '2px 8px',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 600,
              }}
            >
              {currentTrack.indication}
            </div>
          )}
        </div>

        {/* Transport Controls */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={handlePrevTrack}
            disabled={!!customTrackName}
            style={{
              background: 'transparent',
              border: 'none',
              color: customTrackName ? 'rgba(255,255,255,0.2)' : '#CBD5E0',
              cursor: customTrackName ? 'default' : 'pointer',
              padding: '6px',
            }}
          >
            <SkipBack size={20} />
          </button>

          <button
            onClick={handleTogglePlay}
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '50%',
              backgroundColor: 'var(--brand-primary)',
              color: '#FFFFFF',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(232, 150, 122, 0.4)',
              transition: 'transform 0.15s ease',
            }}
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} style={{ marginLeft: '2px' }} />}
          </button>

          <button
            onClick={handleNextTrack}
            disabled={!!customTrackName}
            style={{
              background: 'transparent',
              border: 'none',
              color: customTrackName ? 'rgba(255,255,255,0.2)' : '#CBD5E0',
              cursor: customTrackName ? 'default' : 'pointer',
              padding: '6px',
            }}
          >
            <SkipForward size={20} />
          </button>
        </div>
      </div>

      {/* Classical Music Playlist Drawer Modal */}
      {showPlaylistDrawer && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 30,
            background: 'rgba(10, 10, 16, 0.95)',
            backdropFilter: 'blur(16px)',
            display: 'flex',
            flexDirection: 'column',
            padding: '20px 16px',
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Music size={18} color="var(--brand-primary)" />
              <h3 style={{ margin: 0, fontSize: '16px', color: '#FFFFFF', fontWeight: 600 }}>
                Classical Music Therapy Playlist
              </h3>
            </div>
            <button
              onClick={() => setShowPlaylistDrawer(false)}
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                border: 'none',
                color: '#CBD5E0',
                borderRadius: '50%',
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>

          <p style={{ fontSize: '12px', color: '#A0AEC0', marginTop: 0, marginBottom: '14px' }}>
            Select a classical composition calibrated for neurofeedback acoustic modulation:
          </p>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {CLASSICAL_PLAYLIST.map((track, idx) => {
              const isCurrent = activeTrackIndex === idx && !customTrackName;
              return (
                <div
                  key={track.id}
                  onClick={() => handleSelectTrack(idx)}
                  style={{
                    background: isCurrent ? 'rgba(232, 150, 122, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                    border: isCurrent ? '1.5px solid var(--brand-primary)' : '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 'var(--radius-md)',
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>
                      {track.title}
                    </div>
                    <div style={{ fontSize: '11px', color: '#CBD5E0', marginTop: '2px' }}>
                      {track.composer} • {track.key}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--brand-primary)', marginTop: '3px' }}>
                      Focus: {track.indication}
                    </div>
                  </div>

                  {isCurrent && isPlaying && (
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#68D391', boxShadow: '0 0 8px #68D391' }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
