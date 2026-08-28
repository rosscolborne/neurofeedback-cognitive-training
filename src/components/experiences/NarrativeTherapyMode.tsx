import React, { useState, useEffect } from 'react';
import { EEGDataPoint } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { ChevronRight, ChevronLeft, Feather } from 'lucide-react';

interface NarrativeTherapyProps {
  eegData: EEGDataPoint | null;
}

interface StoryPage {
  id: string;
  chapterNumber: number;
  title: string;
  reflection: string;
  imageUrl: string;
}

const STORY_PAGES: StoryPage[] = [
  {
    id: 'page-1',
    chapterNumber: 1,
    title: 'The Still Lake',
    reflection: 'The surface of the mountain water mirrors the open sky. When the wind of wandering thought slows, clarity returns all on its own.',
    imageUrl: 'https://images.unsplash.com/photo-1506744626753-1407336c84c1?auto=format&fit=crop&w=1920&q=80',
  },
  {
    id: 'page-2',
    chapterNumber: 2,
    title: 'The Anchor of Breath',
    reflection: 'Feel the gentle, steady rhythm of your breathing. You are not the passing clouds of thought; you are the vast and quiet sky behind them.',
    imageUrl: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?auto=format&fit=crop&w=1920&q=80',
  },
  {
    id: 'page-3',
    chapterNumber: 3,
    title: 'The Sunlight in the Pines',
    reflection: 'Morning light filters softly through the ancient trees. Let any lingering tension in the jaw, neck, and shoulders gently melt away.',
    imageUrl: 'https://images.unsplash.com/photo-1511497584788-87676104235f?auto=format&fit=crop&w=1920&q=80',
  },
  {
    id: 'page-4',
    chapterNumber: 4,
    title: 'The Open Horizon',
    reflection: 'With every calm breath, your awareness expands outward. The mind settles naturally into effortless, tranquil focus.',
    imageUrl: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1920&q=80',
  },
  {
    id: 'page-5',
    chapterNumber: 5,
    title: 'Inner Sanctuary',
    reflection: 'Here in this quiet stillness, neural pathways synchronize in balance. Rest peacefully in this grounded sense of presence.',
    imageUrl: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1920&q=80',
  },
];

export const NarrativeTherapyMode: React.FC<NarrativeTherapyProps> = ({ eegData }) => {
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const page = STORY_PAGES[currentPageIndex] || STORY_PAGES[0];

  const inZone = eegData?.inZone ?? true;
  const zoneScore = eegData?.zoneScore ?? (inZone ? 1.0 : 0.0);

  const handleNext = () => {
    if (currentPageIndex < STORY_PAGES.length - 1) {
      setCurrentPageIndex((prev) => prev + 1);
      audioEngine.playChime('breath-in');
    }
  };

  const handlePrev = () => {
    if (currentPageIndex > 0) {
      setCurrentPageIndex((prev) => prev - 1);
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#0F0F14',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        fontFamily: 'var(--font-body)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        userSelect: 'none',
      }}
    >
      <style>
        {`
          @keyframes gentleDrift {
            0% { transform: scale(1.02) translate(0, 0); }
            50% { transform: scale(1.06) translate(-0.8%, -0.5%); }
            100% { transform: scale(1.02) translate(0, 0); }
          }
        `}
      </style>

      {/* Full-Bleed Tranquil Illustrated Background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${page.imageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: inZone ? 0.75 + 0.2 * zoneScore : 0.4,
          filter: inZone
            ? `brightness(${0.8 + 0.2 * zoneScore}) contrast(${0.95 + 0.1 * zoneScore})`
            : 'grayscale(35%) brightness(0.55) blur(1.5px)',
          animation: 'gentleDrift 32s ease-in-out infinite',
          transition: 'all 1.4s ease-in-out',
        }}
      />

      {/* Atmospheric Soft Vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at center, rgba(15,15,20,0.15) 20%, rgba(15,15,20,0.88) 90%)',
          pointerEvents: 'none',
        }}
      />

      {/* Discreet Chapter Header */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          padding: '16px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Feather size={14} color="var(--brand-primary)" style={{ opacity: 0.8 }} />
          <span style={{ fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#D4AF37', fontWeight: 600 }}>
            Chapter {page.chapterNumber} of {STORY_PAGES.length}
          </span>
        </div>

        {/* Soft Calm Indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(255, 255, 255, 0.08)',
            padding: '3px 10px',
            borderRadius: 'var(--radius-full)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: inZone ? '#68D391' : '#F6AD55',
              boxShadow: inZone ? '0 0 8px #68D391' : 'none',
              transition: 'all 0.5s ease',
            }}
          />
          <span style={{ fontSize: '10px', color: '#FFFFFF', fontWeight: 500 }}>
            {inZone ? 'Present' : 'Breathe Softly'}
          </span>
        </div>
      </div>

      {/* Central Reading Card */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          margin: '0 auto',
          maxWidth: '460px',
          padding: '0 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            background: 'rgba(20, 22, 30, 0.75)',
            border: inZone ? '1px solid rgba(232, 150, 122, 0.35)' : '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 'var(--radius-xl)',
            padding: '24px 28px',
            backdropFilter: 'blur(16px)',
            boxShadow: inZone ? '0 12px 36px rgba(0, 0, 0, 0.5), 0 0 24px rgba(232, 150, 122, 0.15)' : '0 8px 24px rgba(0, 0, 0, 0.4)',
            transition: 'all 0.8s ease',
          }}
        >
          <h2
            className="font-display"
            style={{
              fontSize: '22px',
              fontWeight: 500,
              color: inZone ? '#FFFFFF' : '#E2E8F0',
              marginBottom: '14px',
              letterSpacing: '0.02em',
            }}
          >
            {page.title}
          </h2>

          <p
            style={{
              fontSize: '15px',
              lineHeight: 1.65,
              color: inZone ? '#F0EBE1' : '#CBD5E0',
              margin: 0,
              fontWeight: 400,
              transition: 'color 0.6s ease',
            }}
          >
            {page.reflection}
          </p>
        </div>
      </div>

      {/* Quiet Navigation Bar */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          padding: '16px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <button
          onClick={handlePrev}
          disabled={currentPageIndex === 0}
          style={{
            background: 'transparent',
            border: 'none',
            color: currentPageIndex === 0 ? 'rgba(255,255,255,0.15)' : '#CBD5E0',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            cursor: currentPageIndex === 0 ? 'default' : 'pointer',
            padding: '6px 10px',
          }}
        >
          <ChevronLeft size={16} />
          <span>Back</span>
        </button>

        {/* Page Dots */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {STORY_PAGES.map((p, idx) => (
            <div
              key={p.id}
              onClick={() => setCurrentPageIndex(idx)}
              style={{
                width: currentPageIndex === idx ? '16px' : '5px',
                height: '5px',
                borderRadius: '3px',
                backgroundColor: currentPageIndex === idx ? 'var(--brand-primary)' : 'rgba(255, 255, 255, 0.25)',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
              }}
            />
          ))}
        </div>

        {/* Next / Turn Page Button */}
        <button
          onClick={handleNext}
          disabled={currentPageIndex === STORY_PAGES.length - 1}
          style={{
            background: currentPageIndex === STORY_PAGES.length - 1
              ? 'rgba(255, 255, 255, 0.08)'
              : 'rgba(232, 150, 122, 0.2)',
            border: '1px solid rgba(232, 150, 122, 0.4)',
            borderRadius: 'var(--radius-full)',
            color: '#FFFFFF',
            fontSize: '12px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            cursor: currentPageIndex === STORY_PAGES.length - 1 ? 'default' : 'pointer',
            padding: '8px 16px',
            transition: 'all 0.3s ease',
            boxShadow: inZone ? '0 2px 12px rgba(232, 150, 122, 0.25)' : 'none',
          }}
        >
          <span>{currentPageIndex === STORY_PAGES.length - 1 ? 'Finished' : 'Turn Page'}</span>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
};
