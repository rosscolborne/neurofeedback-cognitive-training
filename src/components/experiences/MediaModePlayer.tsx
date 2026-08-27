import React, { useState } from 'react';
import { EEGDataPoint } from '../../types';
import { Play, Link, Video, AlertCircle } from 'lucide-react';

interface MediaModeProps {
  eegData: EEGDataPoint | null;
  isPaused?: boolean;
}

const YOUTUBE_CHANNELS = [
  {
    title: 'Earth & Alpine Wilderness (4K Relax)',
    youtubeId: 'LXb3EKWsInQ',
    category: 'Nature & Calm',
  },
  {
    title: 'Deep Space & Galactic Nebulae',
    youtubeId: 'f_J8QU1m0NE',
    category: 'Curiosity & Focus',
  },
  {
    title: 'Coral Reef Coralscapes & Marine Life',
    youtubeId: 'a9_qjXFvQhU',
    category: 'Alpha Meditation',
  },
];

export const MediaModePlayer: React.FC<MediaModeProps> = ({ eegData, isPaused = false }) => {
  const [activeVideo, setActiveVideo] = useState(YOUTUBE_CHANNELS[0]);
  const [customUrl, setCustomUrl] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const inZone = eegData?.inZone ?? true;

  const handleLoadCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUrl.trim()) return;

    // Extract YouTube ID from standard formats (youtu.be/ID or youtube.com/watch?v=ID)
    let id = customUrl.trim();
    const match = customUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (match && match[1]) {
      id = match[1];
    }

    setActiveVideo({
      title: 'Custom YouTube Stream',
      youtubeId: id,
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
      {/* YouTube Video Viewport Layer */}
      <div style={{ position: 'relative', flex: 1, width: '100%', height: '100%', overflow: 'hidden' }}>
        <iframe
          key={activeVideo.youtubeId}
          src={`https://www.youtube.com/embed/${activeVideo.youtubeId}?autoplay=1&mute=1&controls=1&loop=1&playlist=${activeVideo.youtubeId}&modestbranding=1&rel=0&origin=${window.location.origin}`}
          title={activeVideo.title}
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            filter: inZone ? 'brightness(1.0) contrast(1.0)' : 'brightness(0.4) contrast(0.85)',
            transition: 'filter 1.5s cubic-bezier(0.4, 0, 0.2, 1)',
            pointerEvents: isPaused ? 'none' : 'auto',
          }}
        />

        {/* Gentle Neuro-Dimming Banner when brain drifts out of target range */}
        {!inZone && (
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
            backgroundColor: 'rgba(20, 20, 20, 0.85)',
            backdropFilter: 'blur(8px)',
            padding: '6px 12px',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#FFFFFF',
            fontSize: '11px',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: inZone ? 'var(--status-active)' : 'var(--status-paused)',
              boxShadow: inZone ? '0 0 8px var(--status-active)' : 'none',
            }}
          />
          <span>{inZone ? 'In Focus Zone (100% Clarity)' : 'Dimming Engaged'}</span>
        </div>
      </div>

      {/* Video Channel Selector Bar */}
      <div
        style={{
          backgroundColor: '#1A1A1A',
          padding: '10px 16px',
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
          {YOUTUBE_CHANNELS.map((ch, idx) => (
            <button
              key={ch.youtubeId}
              onClick={() => setActiveVideo(ch)}
              style={{
                backgroundColor: activeVideo.youtubeId === ch.youtubeId ? 'var(--brand-primary)' : 'rgba(255, 255, 255, 0.12)',
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

      {/* Custom YouTube URL Modal / Inset Form */}
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
            placeholder="Paste any YouTube video URL or ID..."
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
