import React, { useState, useEffect, useRef } from 'react';
import { EEGDataPoint } from '../../types';
import { Link, Video, Sparkles, Sliders, Eye, RefreshCw } from 'lucide-react';

interface MediaModeProps {
  eegData: EEGDataPoint | null;
  isPaused?: boolean;
}

const VIDEO_CHANNELS = [
  {
    id: 'nature-4k',
    title: 'Alpine Wilderness & Sunrise 4K',
    videoUrl: 'https://res.cloudinary.com/demo/video/upload/v1642599496/elephants.mp4',
    category: 'Nature & Alpha Calm',
    targetBand: 'Alpha (8-12 Hz)',
    vibe: 'Peaceful',
  },
  {
    id: 'deep-space',
    title: 'Deep Space & Galactic Nebulae',
    videoUrl: 'https://res.cloudinary.com/demo/video/upload/v1648028723/rooster.mp4',
    category: 'Curiosity & Focus',
    targetBand: 'SMR (12-15 Hz)',
    vibe: 'Immersive',
  },
  {
    id: 'ocean-life',
    title: 'Pacific Ocean Swell & Marine Reefs',
    videoUrl: 'https://res.cloudinary.com/demo/video/upload/v1648028825/dog.mp4',
    category: 'Alpha-Theta Meditation',
    targetBand: 'Alpha-Theta',
    vibe: 'Tranquil',
  },
  {
    id: 'lofi-ambient',
    title: 'Cyberpunk Lo-Fi Rain & Cityscape',
    videoUrl: 'https://res.cloudinary.com/demo/video/upload/v1642599496/elephants.mp4',
    category: 'Beta Downtraining',
    targetBand: 'Beta (15-20 Hz)',
    vibe: 'Focus',
  },
];

export const MediaModePlayer: React.FC<MediaModeProps> = ({ eegData, isPaused = false }) => {
  const [activeVideo, setActiveVideo] = useState(VIDEO_CHANNELS[0]);
  const [customUrl, setCustomUrl] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [showChannelDrawer, setShowChannelDrawer] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const inZone = eegData?.inZone ?? true;
  const zoneScore = eegData?.zoneScore ?? (inZone ? 1.0 : 0.0);

  useEffect(() => {
    if (videoRef.current) {
      if (isPaused) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(e => console.error("AutoPlay notice:", e));
      }
    }
  }, [isPaused, activeVideo]);

  const handleLoadCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUrl.trim()) return;

    setActiveVideo({
      id: 'custom-' + Date.now(),
      title: 'Custom Stream: ' + customUrl.trim().split('/').pop()?.slice(0, 20),
      videoUrl: customUrl.trim(),
      category: 'Custom Video Stream',
      targetBand: 'Custom Protocol',
      vibe: 'Personalized',
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
        backgroundColor: '#0A0A0F',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Video Viewport Layer with Dynamic Neurofeedback Visual Filter */}
      <div style={{ position: 'relative', flex: 1, width: '100%', height: '100%', overflow: 'hidden' }}>
        <video
          ref={videoRef}
          key={activeVideo.videoUrl}
          src={activeVideo.videoUrl}
          autoPlay
          loop
          muted
          playsInline
          crossOrigin="anonymous"
          controls={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: `brightness(${0.35 + 0.65 * zoneScore}) contrast(${0.85 + 0.2 * zoneScore}) saturate(${0.7 + 0.4 * zoneScore})`,
            transition: 'filter 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />

        {/* Dynamic Neuro Vignette Tunnel (sharpens on high zoneScore) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: `radial-gradient(circle at center, rgba(0,0,0,0) ${35 + 35 * zoneScore}%, rgba(0,0,0,${0.9 - 0.6 * zoneScore}) 100%)`,
            transition: 'all 1.0s ease',
          }}
        />

        {/* Neural Focus Target Reticle HUD in Center (illuminates in-zone) */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.6s ease',
            opacity: inZone ? (0.3 + 0.5 * zoneScore) : 0.15,
          }}
        >
          <div
            style={{
              width: `${120 + 40 * (1 - zoneScore)}px`,
              height: `${120 + 40 * (1 - zoneScore)}px`,
              borderRadius: '50%',
              border: `1.5px dashed ${inZone ? 'var(--brand-primary)' : 'rgba(255,255,255,0.4)'}`,
              boxShadow: inZone ? '0 0 25px rgba(232, 150, 122, 0.4)' : 'none',
              transition: 'all 0.6s ease',
            }}
          />
        </div>

        {/* Gentle Neuro-Dimming Banner when brain drifts out of target range */}
        {zoneScore < 0.35 && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              backgroundColor: 'rgba(18, 20, 28, 0.88)',
              color: '#FFFFFF',
              padding: '12px 24px',
              borderRadius: 'var(--radius-xl)',
              fontSize: '13px',
              fontWeight: 600,
              backdropFilter: 'blur(10px)',
              pointerEvents: 'none',
              border: '1px solid rgba(232, 150, 122, 0.4)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
              textAlign: 'center',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Sparkles size={16} color="var(--brand-primary)" />
            <span>Refocus attention gently to restore full video clarity</span>
          </div>
        )}

        {/* Top-Right Real-Time Neuro HUD Tag */}
        <div
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            backgroundColor: 'rgba(10, 10, 15, 0.75)',
            backdropFilter: 'blur(8px)',
            padding: '6px 12px',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#FFF',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: inZone ? '#68D391' : '#F6AD55',
              boxShadow: inZone ? '0 0 10px #68D391' : 'none',
              transition: 'background-color 0.4s ease',
            }}
          />
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em' }}>
            {inZone ? `IN-ZONE (${Math.round(zoneScore * 100)}%)` : 'ATTENTION DRIFT'}
          </span>
        </div>

        {/* Top-Left Channel Info Tag */}
        <div
          style={{
            position: 'absolute',
            top: 14,
            left: 14,
            backgroundColor: 'rgba(10, 10, 15, 0.75)',
            backdropFilter: 'blur(8px)',
            padding: '6px 12px',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: '#FFF',
            border: '1px solid rgba(255, 255, 255, 0.15)',
          }}
        >
          <Video size={13} color="var(--brand-primary)" />
          <span style={{ fontSize: '11px', fontWeight: 600 }}>{activeVideo.category}</span>
        </div>
      </div>

      {/* Control & Channel Strip */}
      <div
        style={{
          padding: '10px 16px',
          backgroundColor: '#161822',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderTop: '1px solid rgba(255, 255, 255, 0.12)',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Eye size={15} color="var(--brand-primary)" />
          <span style={{ fontSize: '13px', color: '#FFFFFF', fontWeight: 600 }}>
            {activeVideo.title}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {VIDEO_CHANNELS.map((ch, idx) => (
            <button
              key={ch.id}
              onClick={() => setActiveVideo(ch)}
              style={{
                backgroundColor: activeVideo.id === ch.id ? 'var(--brand-primary)' : 'rgba(255, 255, 255, 0.1)',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '5px 10px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              Stream {idx + 1}
            </button>
          ))}
          <button
            onClick={() => setShowCustomInput(!showCustomInput)}
            style={{
              backgroundColor: showCustomInput ? 'var(--brand-primary)' : 'rgba(255, 255, 255, 0.1)',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '5px 10px',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <Link size={12} /> Custom URL
          </button>
        </div>
      </div>

      {/* Custom URL Input Modal */}
      {showCustomInput && (
        <form
          onSubmit={handleLoadCustom}
          style={{
            padding: '10px 16px',
            backgroundColor: '#202230',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            gap: '8px',
          }}
        >
          <input
            type="text"
            value={customUrl}
            onChange={e => setCustomUrl(e.target.value)}
            placeholder="Paste direct MP4/WebM video stream URL..."
            style={{
              flex: 1,
              padding: '7px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              background: '#12141F',
              color: '#FFFFFF',
              fontSize: '12px',
              outline: 'none',
            }}
          />
          <button type="submit" className="btn btn-dense" style={{ fontSize: '11px', padding: '6px 14px' }}>
            Load Video
          </button>
        </form>
      )}
    </div>
  );
};
