import React, { useState } from 'react';
import { EEGDataPoint } from '../../types';
import { Play, Link, Video, AlertCircle } from 'lucide-react';

interface MediaModeProps {
  eegData: EEGDataPoint | null;
  isPaused?: boolean;
}

const VIDEO_CHANNELS = [
  {
    title: 'Earth & Alpine Wilderness (4K Relax)',
    videoUrl: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
    category: 'Nature & Calm',
  },
  {
    title: 'Deep Space & Galactic Nebulae',
    videoUrl: 'https://media.w3.org/2010/05/bunny/trailer.mp4',
    category: 'Curiosity & Focus',
  },
  {
    title: 'Ocean Waves & Marine Life',
    videoUrl: 'https://media.w3.org/2010/05/video/movie_300.mp4',
    category: 'Alpha Meditation',
  },
];

export const MediaModePlayer: React.FC<MediaModeProps> = ({ eegData, isPaused = false }) => {
  const [activeVideo, setActiveVideo] = useState(VIDEO_CHANNELS[0]);
  const [customUrl, setCustomUrl] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const inZone = eegData?.inZone ?? true;
  const zoneScore = eegData?.zoneScore ?? (inZone ? 1.0 : 0.0);

  const handleLoadCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUrl.trim()) return;

    setActiveVideo({
      title: 'Custom Media Stream',
      videoUrl: customUrl.trim(),
      category: 'User Custom',
    });
    setShowCustomInput(false);
    setCustomUrl('');
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#0F0F0F',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Video Viewport Layer */}
      <div style={{ position: 'relative', flex: 1, width: '100%', height: '100%', overflow: 'hidden' }}>
        <video
          key={activeVideo.videoUrl}
          src={activeVideo.videoUrl}
          autoPlay
          loop
          muted
          playsInline
          controls={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: `brightness(${0.4 + 0.6 * zoneScore}) contrast(${0.85 + 0.15 * zoneScore})`,
            transition: 'filter 1.5s cubic-bezier(0.4, 0, 0.2, 1)',
            pointerEvents: isPaused ? 'none' : 'auto',
          }}
        />

        {/* Gentle Neuro-Dimming Banner when brain drifts out of target range */}
        {zoneScore < 0.3 && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              backgroundColor: 'rgba(20, 20, 20, 0.85)',
              color: '#FFFFFF',
              padding: '10px 22px',
              borderRadius: 'var(--radius-xl)',
              fontSize: '13px',
              fontWeight: 500,
              backdropFilter: 'blur(6px)',
              pointerEvents: 'none',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
              textAlign: 'center',
            }}
          >
            Refocus attention gently to restore full video brightness
          </div>
        )}

        {/* Live Telemetry HUD Tag in Top Right */}
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            backgroundColor: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            padding: '6px 10px',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: '#FFF',
            border: '1px solid rgba(255,255,255,0.1)',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: inZone ? '#4CAF50' : '#FF5252',
              boxShadow: inZone ? '0 0 10px #4CAF50' : 'none',
              transition: 'background-color 0.5s ease',
            }}
          />
          <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.5px' }}>
            {inZone ? 'SYNC' : 'DRIFT'}
          </span>
        </div>
      </div>

      {/* Control & Channel Strip */}
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: '#1A1A1A',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Video size={16} color="var(--brand-primary)" />
          <span style={{ fontSize: '13px', color: '#FFFFFF', fontWeight: 500 }}>
            {activeVideo.title}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          {VIDEO_CHANNELS.map((ch, idx) => (
            <button
              key={ch.videoUrl}
              onClick={() => setActiveVideo(ch)}
              style={{
                backgroundColor: activeVideo.videoUrl === ch.videoUrl ? 'var(--brand-primary)' : 'rgba(255, 255, 255, 0.12)',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 10px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Stream {idx + 1}
            </button>
          ))}
          <button
            onClick={() => setShowCustomInput(!showCustomInput)}
            style={{
              backgroundColor: showCustomInput ? 'var(--brand-primary)' : 'rgba(255, 255, 255, 0.12)',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 10px',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
            }}
          >
            <Link size={12} /> Custom URL
          </button>
        </div>
      </div>

      {/* Custom URL Modal / Inset Form */}
      {showCustomInput && (
        <form
          onSubmit={handleLoadCustom}
          style={{
            padding: '10px 16px',
            backgroundColor: '#262626',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            gap: '8px',
          }}
        >
          <input
            type="text"
            value={customUrl}
            onChange={e => setCustomUrl(e.target.value)}
            placeholder="Paste any MP4 video URL..."
            style={{
              flex: 1,
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              background: '#1A1A1A',
              color: '#FFFFFF',
              fontSize: '12px',
              outline: 'none',
            }}
          />
          <button type="submit" className="btn btn-dense" style={{ fontSize: '11px', padding: '6px 12px' }}>
            Load Stream
          </button>
        </form>
      )}
    </div>
  );
};
