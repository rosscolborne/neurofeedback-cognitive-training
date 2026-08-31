import React, { useState } from 'react';
import { EEGDataPoint } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { ChevronRight, ChevronLeft, Feather, BookOpen, RotateCcw, Compass, CheckCircle2 } from 'lucide-react';

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

interface ReadingJourney {
  id: string;
  journeyNumber: number;
  title: string;
  subtitle: string;
  targetFocus: string;
  pages: StoryPage[];
}

const READING_JOURNEYS: ReadingJourney[] = [
  {
    id: 'journey-1',
    journeyNumber: 1,
    title: 'Waters of Stillness',
    subtitle: 'Alpha Calm & Emotional Grounding',
    targetFocus: 'Alpha Wave Synchronization',
    pages: [
      {
        id: 'j1-p1',
        chapterNumber: 1,
        title: 'The Still Lake',
        reflection: 'The surface of the mountain water mirrors the open sky. When the wind of wandering thought slows, clarity returns all on its own.',
        imageUrl: 'https://images.unsplash.com/photo-1506744626753-1407336c84c1?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j1-p2',
        chapterNumber: 2,
        title: 'The Anchor of Breath',
        reflection: 'Feel the gentle, steady rhythm of your breathing. You are not the passing clouds of thought; you are the vast and quiet sky behind them.',
        imageUrl: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j1-p3',
        chapterNumber: 3,
        title: 'The Sunlight in the Pines',
        reflection: 'Morning light filters softly through the ancient trees. Let any lingering tension in the jaw, neck, and shoulders gently melt away.',
        imageUrl: 'https://images.unsplash.com/photo-1511497584788-87676104235f?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j1-p4',
        chapterNumber: 4,
        title: 'The Open Horizon',
        reflection: 'With every calm breath, your awareness expands outward. The mind settles naturally into effortless, tranquil focus.',
        imageUrl: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j1-p5',
        chapterNumber: 5,
        title: 'Inner Sanctuary',
        reflection: 'Here in this quiet stillness, neural pathways synchronize in balance. Rest peacefully in this grounded sense of presence.',
        imageUrl: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1920&q=80',
      },
    ],
  },
  {
    id: 'journey-2',
    journeyNumber: 2,
    title: 'The Forest of Focus',
    subtitle: 'SMR Stillness & ADHD Resilience',
    targetFocus: 'Sensorimotor Rhythm Elevation',
    pages: [
      {
        id: 'j2-p1',
        chapterNumber: 1,
        title: 'The Ancient Grove',
        reflection: 'Step into the cedar forest where giant trees have stood grounded for centuries. Stillness is not the absence of energy, but energy perfectly centered.',
        imageUrl: 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j2-p2',
        chapterNumber: 2,
        title: 'The Roots Below',
        reflection: 'Like deep roots holding firm against the mountain gale, allow your attention to rest comfortably in the physical body without restlessness.',
        imageUrl: 'https://images.unsplash.com/photo-1473448912268-2022ce9509d8?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j2-p3',
        chapterNumber: 3,
        title: 'The Quiet Stream',
        reflection: 'Thoughts may arise like fallen leaves upon the brook. Watch them drift downstream without reaching out to grasp or push them away.',
        imageUrl: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j2-p4',
        chapterNumber: 4,
        title: 'Crystalline Awareness',
        reflection: 'Your motor cortex settles into harmonious quiet. In this calm clarity, attention becomes sharp, effortless, and unwavering.',
        imageUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j2-p5',
        chapterNumber: 5,
        title: 'The Cleared Path',
        reflection: 'The path ahead is illuminated with calm certainty. You carry this stillness forward into everything you touch today.',
        imageUrl: 'https://images.unsplash.com/photo-1506744626753-1407336c84c1?auto=format&fit=crop&w=1920&q=80',
      },
    ],
  },
  {
    id: 'journey-3',
    journeyNumber: 3,
    title: 'Mountain Equilibrium',
    subtitle: 'Theta-Beta Harmony & Perspective',
    targetFocus: 'Frontal Cortex Balance',
    pages: [
      {
        id: 'j3-p1',
        chapterNumber: 1,
        title: 'The Foothills of Observation',
        reflection: 'From the foot of the mountain, steep peaks seem daunting. But every great climb begins with a single, unhurried breath.',
        imageUrl: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j3-p2',
        chapterNumber: 2,
        title: 'The Cloudline',
        reflection: 'As you climb above the cloud layer, mental chatter and noise remain far below. Up here, the air is crisp, pure, and quiet.',
        imageUrl: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j3-p3',
        chapterNumber: 3,
        title: 'The Vista of Equanimity',
        reflection: 'Look across the expanse. See how small daily worries become against the vast panorama of time and space.',
        imageUrl: 'https://images.unsplash.com/photo-1506744626753-1407336c84c1?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j3-p4',
        chapterNumber: 4,
        title: 'The Summit of Presence',
        reflection: 'You stand at the peak. Left and right brainwaves pulse in synchronized symmetry. You are fully awake and deeply at peace.',
        imageUrl: 'https://images.unsplash.com/photo-1511497584788-87676104235f?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j3-p5',
        chapterNumber: 5,
        title: 'The Mountain Within',
        reflection: 'Whatever storms blow across the world outside, the mountain within remains unmoved, solid, and serene.',
        imageUrl: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?auto=format&fit=crop&w=1920&q=80',
      },
    ],
  },
  {
    id: 'journey-4',
    journeyNumber: 4,
    title: 'The Twilight Horizon',
    subtitle: 'Deep Relaxation & Vagal Tone',
    targetFocus: 'Parasympathetic Recovery',
    pages: [
      {
        id: 'j4-p1',
        chapterNumber: 1,
        title: 'Golden Dusk',
        reflection: 'The golden sun dips behind the ocean waves. As daylight softens into twilight, give your nervous system permission to rest.',
        imageUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j4-p2',
        chapterNumber: 2,
        title: 'The Evening Tide',
        reflection: 'The rhythm of the gentle waves matches the rise and fall of your diaphragm. Each exhale releases fatigue from the mind.',
        imageUrl: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j4-p3',
        chapterNumber: 3,
        title: 'The First Star',
        reflection: 'A single star appears in the purple dusk. Focus softly on its steady light, letting go of all mental striving.',
        imageUrl: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j4-p4',
        chapterNumber: 4,
        title: 'Velvet Stillness',
        reflection: 'Slow Alpha transitions into soothing Theta waves. A warm blanket of tranquility settles over your entire body.',
        imageUrl: 'https://images.unsplash.com/photo-1511497584788-87676104235f?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j4-p5',
        chapterNumber: 5,
        title: 'Peaceful Rest',
        reflection: 'Your mind rests in deep, restorative calm. Know that you can return to this peaceful haven whenever you choose.',
        imageUrl: 'https://images.unsplash.com/photo-1506744626753-1407336c84c1?auto=format&fit=crop&w=1920&q=80',
      },
    ],
  },
  {
    id: 'journey-5',
    journeyNumber: 5,
    title: 'Zen Koans & Parables',
    subtitle: 'Cognitive Flexibility & Insight',
    targetFocus: 'Inter-Hemispheric Coherence',
    pages: [
      {
        id: 'j5-p1',
        chapterNumber: 1,
        title: 'The Empty Cup',
        reflection: 'A master poured tea until the cup overflowed. "Like this cup, your mind is full of opinions. To learn stillness, first empty your cup."',
        imageUrl: 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j5-p2',
        chapterNumber: 2,
        title: 'The Floating Reed',
        reflection: 'The rigid oak tree breaks in the fierce winter storm, but the supple bamboo bends gracefully with the wind and rises unharmed.',
        imageUrl: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j5-p3',
        chapterNumber: 3,
        title: 'The Pure Reflection',
        reflection: 'Muddy water is best cleared by leaving it alone. When you stop stirring your thoughts, clarity settles naturally to the bottom.',
        imageUrl: 'https://images.unsplash.com/photo-1506744626753-1407336c84c1?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j5-p4',
        chapterNumber: 4,
        title: 'The Open Palm',
        reflection: 'Try to hold water in a clenched fist and it all slips away. Open your palm and you can hold the whole ocean.',
        imageUrl: 'https://images.unsplash.com/photo-1473448912268-2022ce9509d8?auto=format&fit=crop&w=1920&q=80',
      },
      {
        id: 'j5-p5',
        chapterNumber: 5,
        title: 'Beginner’s Mind',
        reflection: 'In the beginner’s mind there are many possibilities; in the expert’s mind there are few. Meet each new moment with fresh curiosity.',
        imageUrl: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1920&q=80',
      },
    ],
  },
];

export const NarrativeTherapyMode: React.FC<NarrativeTherapyProps> = ({ eegData }) => {
  const [activeJourneyIndex, setActiveJourneyIndex] = useState(0);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [showAnthologyDrawer, setShowAnthologyDrawer] = useState(false);

  const journey = READING_JOURNEYS[activeJourneyIndex] || READING_JOURNEYS[0];
  const isFinished = currentPageIndex >= journey.pages.length;
  const page = journey.pages[currentPageIndex] || journey.pages[journey.pages.length - 1];

  const inZone = eegData?.inZone ?? true;
  const zoneScore = eegData?.zoneScore ?? (inZone ? 1.0 : 0.0);

  const handleNext = () => {
    if (currentPageIndex < journey.pages.length - 1) {
      setCurrentPageIndex((prev) => prev + 1);
      audioEngine.playChime('breath-in');
    } else {
      // Reached the completion of the journey
      setCurrentPageIndex(journey.pages.length);
      audioEngine.playChime('complete');
    }
  };

  const handlePrev = () => {
    if (currentPageIndex > 0) {
      setCurrentPageIndex((prev) => prev - 1);
    }
  };

  const handleSelectJourney = (index: number) => {
    setActiveJourneyIndex(index);
    setCurrentPageIndex(0);
    setShowAnthologyDrawer(false);
    audioEngine.playChime('breath-in');
  };

  const handleNextJourney = () => {
    const nextIndex = (activeJourneyIndex + 1) % READING_JOURNEYS.length;
    handleSelectJourney(nextIndex);
  };

  const handleRestartJourney = () => {
    setCurrentPageIndex(0);
    audioEngine.playChime('breath-in');
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
            50% { transform: scale(1.05) translate(-0.8%, -0.5%); }
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

      {/* Header Bar */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          padding: '14px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        {/* Journey Name & Anthology Trigger */}
        <button
          onClick={() => setShowAnthologyDrawer(true)}
          style={{
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: 'var(--radius-full)',
            padding: '5px 12px',
            color: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
          }}
        >
          <BookOpen size={13} color="var(--brand-primary)" />
          <span>Journey {journey.journeyNumber}: {journey.title}</span>
          <span style={{ fontSize: '10px', color: 'var(--brand-primary)', marginLeft: '4px' }}>• Library ▾</span>
        </button>

        {/* Soft Calm Presence Indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(255, 255, 255, 0.08)',
            padding: '4px 10px',
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
            {inZone ? 'Mindful Flow' : 'Breathe Softly'}
          </span>
        </div>
      </div>

      {/* Main Reading Viewport OR Completion Pavilion */}
      {!isFinished ? (
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
              background: 'rgba(20, 22, 30, 0.78)',
              border: inZone ? '1px solid rgba(232, 150, 122, 0.35)' : '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 'var(--radius-xl)',
              padding: '24px 28px',
              backdropFilter: 'blur(16px)',
              boxShadow: inZone
                ? '0 12px 36px rgba(0, 0, 0, 0.5), 0 0 24px rgba(232, 150, 122, 0.15)'
                : '0 8px 24px rgba(0, 0, 0, 0.4)',
              transition: 'all 0.8s ease',
            }}
          >
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#D4AF37', marginBottom: '8px', fontWeight: 600 }}>
              Chapter {page.chapterNumber} of {journey.pages.length}
            </div>

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
      ) : (
        /* Journey Complete Pavilion */
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
              background: 'rgba(20, 22, 30, 0.88)',
              border: '1px solid rgba(232, 150, 122, 0.4)',
              borderRadius: 'var(--radius-xl)',
              padding: '28px 28px',
              backdropFilter: 'blur(20px)',
              boxShadow: '0 16px 40px rgba(0, 0, 0, 0.6), 0 0 30px rgba(232, 150, 122, 0.2)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div
              style={{
                width: '46px',
                height: '46px',
                borderRadius: '50%',
                backgroundColor: 'rgba(232, 150, 122, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--brand-primary)',
              }}
            >
              <CheckCircle2 size={24} />
            </div>

            <h2 className="font-display" style={{ fontSize: '22px', fontWeight: 500, color: '#FFFFFF', margin: 0 }}>
              Journey Complete
            </h2>

            <p style={{ fontSize: '13px', color: '#CBD5E0', lineHeight: 1.5, margin: 0 }}>
              You have completed <em>{journey.title}</em> with grounded neural coherence. Choose where you would like to go next:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', marginTop: '6px' }}>
              <button
                onClick={handleNextJourney}
                style={{
                  background: 'var(--brand-primary)',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px 16px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  boxShadow: '0 4px 12px rgba(232, 150, 122, 0.3)',
                }}
              >
                <span>Continue to Next Journey</span>
                <ChevronRight size={15} />
              </button>

              <button
                onClick={() => setShowAnthologyDrawer(true)}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: '#FFFFFF',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 'var(--radius-md)',
                  padding: '9px 16px',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <BookOpen size={14} />
                <span>Browse All 5 Journeys</span>
              </button>

              <button
                onClick={handleRestartJourney}
                style={{
                  background: 'transparent',
                  color: '#A0AEC0',
                  border: 'none',
                  padding: '6px 12px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                }}
              >
                <RotateCcw size={12} />
                <span>Re-read this Journey</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Footer */}
      {!isFinished && (
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
            {journey.pages.map((p, idx) => (
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
            style={{
              background: 'rgba(232, 150, 122, 0.22)',
              border: '1px solid rgba(232, 150, 122, 0.45)',
              borderRadius: 'var(--radius-full)',
              color: '#FFFFFF',
              fontSize: '12px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              padding: '8px 16px',
              transition: 'all 0.3s ease',
              boxShadow: inZone ? '0 2px 12px rgba(232, 150, 122, 0.25)' : 'none',
            }}
          >
            <span>{currentPageIndex === journey.pages.length - 1 ? 'Complete' : 'Turn Page'}</span>
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Reading Anthology Library Modal / Drawer */}
      {showAnthologyDrawer && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 30,
            background: 'rgba(10, 10, 15, 0.92)',
            backdropFilter: 'blur(16px)',
            display: 'flex',
            flexDirection: 'column',
            padding: '20px 16px',
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BookOpen size={18} color="var(--brand-primary)" />
              <h3 style={{ margin: 0, fontSize: '16px', color: '#FFFFFF', fontWeight: 600 }}>
                Therapy Reading Library
              </h3>
            </div>
            <button
              onClick={() => setShowAnthologyDrawer(false)}
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
            Select a mindfulness reading journey calibrated for your neurofeedback session:
          </p>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {READING_JOURNEYS.map((j, idx) => {
              const isCurrent = activeJourneyIndex === idx;
              return (
                <div
                  key={j.id}
                  onClick={() => handleSelectJourney(idx)}
                  style={{
                    background: isCurrent ? 'rgba(232, 150, 122, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                    border: isCurrent ? '1.5px solid var(--brand-primary)' : '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        background: isCurrent ? 'var(--brand-primary)' : 'rgba(255, 255, 255, 0.1)',
                        color: '#FFFFFF',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '12px',
                      }}
                    >
                      {j.journeyNumber}
                    </div>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#FFFFFF' }}>
                        {j.title}
                      </div>
                      <div style={{ fontSize: '12px', color: '#CBD5E0', marginTop: '2px' }}>
                        {j.subtitle}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--brand-primary)', marginTop: '3px' }}>
                        Target: {j.targetFocus} • 5 Chapters
                      </div>
                    </div>
                  </div>

                  <ChevronRight size={16} color={isCurrent ? 'var(--brand-primary)' : '#A0AEC0'} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
