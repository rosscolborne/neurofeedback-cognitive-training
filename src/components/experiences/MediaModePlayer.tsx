import React, { useState, useEffect, useRef } from 'react';
import { EEGDataPoint } from '../../types';
import { Video, Eye, Sun, Compass, Waves, Moon, Tv, Play } from 'lucide-react';

interface MediaModeProps {
  eegData: EEGDataPoint | null;
  isPaused?: boolean;
}

interface MediaChannel {
  id: string;
  title: string;
  category: string;
  targetBand: string;
  vibe: string;
  icon: any;
  localVideoUrl: string;
  youtubeId: string;
}

const MEDIA_CHANNELS: MediaChannel[] = [
  {
    id: 'nature-alpine',
    title: 'Alpine Wilderness & Clouds (4K)',
    category: 'Alpha Relaxation',
    targetBand: 'Alpha (8-12 Hz)',
    vibe: 'Peaceful',
    icon: Sun,
    localVideoUrl: '/videos/stream1_nature.mp4',
    youtubeId: 'BHACKCNDMW8',
  },
  {
    id: 'deep-space',
    title: 'Galactic Nebula & Cosmic Flight',
    category: 'SMR Focus & Stillness',
    targetBand: 'SMR (12-15 Hz)',
    vibe: 'Immersive',
    icon: Compass,
    localVideoUrl: '/videos/stream2_space.mp4',
    youtubeId: '1ZyhQjEZ23U',
  },
  {
    id: 'ocean-coral',
    title: 'Pacific Coral Reefs & Marine Life',
    category: 'Alpha-Theta Meditation',
    targetBand: 'Alpha-Theta',
    vibe: 'Tranquil',
    icon: Waves,
    localVideoUrl: '/videos/stream3_ocean.mp4',
    youtubeId: '7OGo8Y_h9_8',
  },
  {
    id: 'lofi-rain',
    title: 'Lo-Fi Rain & Peaceful Horizon',
    category: 'Beta Downtraining',
    targetBand: 'Beta (15-20 Hz)',
    vibe: 'Calm Focus',
    icon: Moon,
    localVideoUrl: '/videos/stream4_rain.mp4',
    youtubeId: 'TURbeWK2wwg',
  },
];

export const MediaModePlayer: React.FC<MediaModeProps> = ({ eegData, isPaused = false }) => {
  const [activeChannel, setActiveChannel] = useState(MEDIA_CHANNELS[0]);
  const [playbackSource, setPlaybackSource] = useState<'local' | 'youtube'>('local');
  const [customInput, setCustomInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customYoutubeId, setCustomYoutubeId] = useState<string | null>(null);
  const [customVideoUrl, setCustomVideoUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const inZone = eegData?.inZone ?? true;
  const zoneScore = eegData?.zoneScore ?? (inZone ? 1.0 : 0.0);

  // Parse YouTube URLs (standard, shortened, or embed)
  const extractYoutubeId = (url: string): string | null => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = customInput.trim();
    if (!input) return;

    const ytId = extractYoutubeId(input);
    if (ytId) {
      setCustomYoutubeId(ytId);
      setCustomVideoUrl(null);
      setPlaybackSource('youtube');
    } else {
      setCustomVideoUrl(input);
      setCustomYoutubeId(null);
      setPlaybackSource('local');
    }
    setShowCustomInput(false);
    setCustomInput('');
  };

  useEffect(() => {
    if (videoRef.current) {
      if (isPaused) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(() => {});
      }
    }
  }, [isPaused, activeChannel, customVideoUrl]);

  const currentYoutubeId = customYoutubeId || activeChannel.youtubeId;

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
      {/* Visualizer & Video Viewport Layer */}
      <div style={{ position: 'relative', flex: 1, width: '100%', height: '100%', overflow: 'hidden' }}>
        {playbackSource === 'youtube' ? (
          /* Actual YouTube Stream Embed */
          <div
            style={{
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              filter: `brightness(${0.4 + 0.6 * zoneScore}) contrast(${0.9 + 0.15 * zoneScore})`,
              transition: 'filter 0.8s ease',
              transform: 'scale(1.05)',
            }}
          >
            <iframe
              src={`https://www.youtube.com/embed/${currentYoutubeId}?autoplay=1&mute=1&loop=1&playlist=${currentYoutubeId}&controls=0&modestbranding=1&playsinline=1&rel=0&showinfo=0`}
              title="YouTube Neurofeedback Stream"
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                pointerEvents: 'none',
              }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            />
          </div>
        ) : (
          /* Fast Bundled / Direct Local Video Stream */
          <video
            ref={videoRef}
            key={customVideoUrl || activeChannel.localVideoUrl}
            src={customVideoUrl || activeChannel.localVideoUrl}
            autoPlay
            loop
            muted
            playsInline
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              filter: `brightness(${0.4 + 0.6 * zoneScore}) contrast(${0.9 + 0.15 * zoneScore})`,
              transition: 'filter 0.8s ease',
            }}
          />
        )}

        {/* Dynamic Neuro Vignette Tunnel (sharpens on high zoneScore) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: `radial-gradient(circle at center, rgba(0,0,0,0) ${40 + 35 * zoneScore}%, rgba(0,0,0,${0.85 - 0.55 * zoneScore}) 100%)`,
            transition: 'all 0.8s ease',
          }}
        />

        {/* Neural Focus Target Reticle HUD in Center */}
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
            opacity: inZone ? 0.3 + 0.5 * zoneScore : 0.15,
          }}
        >
          <div
            style={{
              width: `${120 + 35 * (1 - zoneScore)}px`,
              height: `${120 + 35 * (1 - zoneScore)}px`,
              borderRadius: '50%',
              border: `1.5px dashed ${inZone ? 'var(--brand-primary)' : 'rgba(255,255,255,0.4)'}`,
              boxShadow: inZone ? '0 0 25px rgba(232, 150, 122, 0.4)' : 'none',
              transition: 'all 0.6s ease',
            }}
          />
        </div>

        {/* Gentle Neuro-Dimming Notification when brain drifts */}
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
            <Sun size={16} color="var(--brand-primary)" />
            <span>Sustain calm attention to restore full video luminosity</span>
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

        {/* Top-Left Category Badge */}
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
          <span style={{ fontSize: '11px', fontWeight: 600 }}>{activeChannel.category}</span>
        </div>
      </div>

      {/* Stream Selector Strip */}
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
            {customVideoUrl || customYoutubeId ? 'Custom Video' : activeChannel.title}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {MEDIA_CHANNELS.map((channel, idx) => {
            const Icon = channel.icon;
            const isSelected = activeChannel.id === channel.id && !customVideoUrl && !customYoutubeId;
            return (
              <button
                key={channel.id}
                onClick={() => {
                  setCustomVideoUrl(null);
                  setCustomYoutubeId(null);
                  setPlaybackSource('local');
                  setActiveChannel(channel);
                }}
                style={{
                  backgroundColor: isSelected ? 'var(--brand-primary)' : 'rgba(255, 255, 255, 0.1)',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '5px 10px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'all 0.15s ease',
                }}
              >
                <Icon size={12} />
                <span>Stream {idx + 1}</span>
              </button>
            );
          })}

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
            <Tv size={12} /> Paste Link
          </button>
        </div>
      </div>

      {/* Custom YouTube or Video Form */}
      {showCustomInput && (
        <form
          onSubmit={handleCustomSubmit}
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
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            placeholder="Paste YouTube link (e.g. youtube.com/watch?v=...) or MP4 URL..."
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
            Stream Video
          </button>
        </form>
      )}
    </div>
  );
};
