import React, { useState, useEffect } from 'react';
import { EEGDataPoint } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { BookOpen, ChevronRight, ChevronLeft, Brain } from 'lucide-react';

interface NarrativeTherapyProps {
  eegData: EEGDataPoint | null;
}

interface StoryScene {
  id: string;
  chapter: number;
  actTitle: string;
  sceneTitle: string;
  speaker: string;
  dialogue: string;
  narrativeText: string;
  imageUrl: string;
  choices?: { text: string; nextSceneId: string; reward: string }[];
  targetMetric: 'SMR' | 'Alpha' | 'Theta/Beta' | 'Coherence';
  thresholdTarget: string;
}

const STORY_EPISODES: StoryScene[] = [
  {
    id: 'act1-scene1',
    chapter: 1,
    actTitle: 'Act I: The Storm of Thoughts',
    sceneTitle: 'The Tempest on the Inner Sea',
    speaker: 'Athena • Neural Guide',
    dialogue: 'A tempest brews in the frontal cortex. Scattered signals collide like fierce waves against the cliffs of awareness.',
    narrativeText: 'Before us lies the Sea of Thoughts. To calm the tempest, steady your attention and lower cognitive chatter.',
    imageUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=1920&q=80',
    targetMetric: 'Theta/Beta',
    thresholdTarget: 'Suppress Theta below 2.0',
    choices: [
      { text: 'Anchor into diaphragmatic breathing', nextSceneId: 'act1-scene2', reward: '+15 SMR Stillness' },
      { text: 'Observe thoughts as passing clouds', nextSceneId: 'act1-scene2', reward: '+15 Alpha Flow' },
    ],
  },
  {
    id: 'act1-scene2',
    chapter: 1,
    actTitle: 'Act I: The Storm of Thoughts',
    sceneTitle: 'The Beacon of Stillness',
    speaker: 'Athena • Neural Guide',
    dialogue: 'Look across the horizon. As your inner chatter settles, the lighthouse on the jagged promontory awakens.',
    narrativeText: 'The golden beam cuts through the fog. Your sensorimotor rhythm (SMR) strengthens, steadying the vessel.',
    imageUrl: 'https://images.unsplash.com/photo-1506744626753-1407336c84c1?auto=format&fit=crop&w=1920&q=80',
    targetMetric: 'SMR',
    thresholdTarget: 'SMR > 7.5 µV',
  },
  {
    id: 'act1-scene3',
    chapter: 1,
    actTitle: 'Act I: The Storm of Thoughts',
    sceneTitle: 'Entering the Harbor of Clarity',
    speaker: 'Athena • Neural Guide',
    dialogue: 'The tempest has yielded to calm waters. You have trained your mind to steer through involuntary mental turbulence.',
    narrativeText: 'The harbor gates swing open. Ahead lies the ancient valley where neural architecture reshapes itself through neuroplasticity.',
    imageUrl: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?auto=format&fit=crop&w=1920&q=80',
    targetMetric: 'Coherence',
    thresholdTarget: 'Coherence > 75%',
  },
  {
    id: 'act2-scene1',
    chapter: 2,
    actTitle: 'Act II: The Valley of Stillness',
    sceneTitle: 'The Echoes in the Canyon',
    speaker: 'Athena • Neural Guide',
    dialogue: 'We step into the Canyon of Resonance. Every breath you take sends harmonic ripples through the stone pillars.',
    narrativeText: 'Alpha waves generate an acoustic shimmer. Deep relaxation dissolves tension stored in the muscles of the jaw and neck.',
    imageUrl: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1920&q=80',
    targetMetric: 'Alpha',
    thresholdTarget: 'Alpha > 11.0 µV',
    choices: [
      { text: 'Softly relax ocular muscles', nextSceneId: 'act2-scene2', reward: '+20 Posterior Alpha' },
      { text: 'Deepen vagal nerve tone', nextSceneId: 'act2-scene2', reward: '+20 HRV Coherence' },
    ],
  },
  {
    id: 'act2-scene2',
    chapter: 2,
    actTitle: 'Act II: The Valley of Stillness',
    sceneTitle: 'The Unfolding Glyphs',
    speaker: 'Athena • Neural Guide',
    dialogue: 'The ancient runes inscribed upon the canyon walls illuminate. Your brain has achieved synchronized inter-hemispheric coherence.',
    narrativeText: 'Bioluminescent moss climbs the ancient architecture. Notice how clarity feels effortless when you surrender struggle.',
    imageUrl: 'https://images.unsplash.com/photo-1511497584788-87676104235f?auto=format&fit=crop&w=1920&q=80',
    targetMetric: 'Coherence',
    thresholdTarget: 'Coherence > 85%',
  },
  {
    id: 'act3-scene1',
    chapter: 3,
    actTitle: 'Act III: The Summit of Equilibrium',
    sceneTitle: 'The Celestial Ascent',
    speaker: 'Athena • Neural Guide',
    dialogue: 'We ascend the crystalline stairway toward the peak. Above us, the aurora borealis pulses in cadence with your brainwaves.',
    narrativeText: 'Theta and Alpha dance in perfect crossover balance. You have reached the summit of cognitive resilience and inner harmony.',
    imageUrl: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1920&q=80',
    targetMetric: 'Theta/Beta',
    thresholdTarget: 'TBR < 1.4 (Peak Focus)',
  },
  {
    id: 'act3-scene2',
    chapter: 3,
    actTitle: 'Act III: The Summit of Equilibrium',
    sceneTitle: 'Equilibrium Achieved',
    speaker: 'Athena • Neural Guide',
    dialogue: 'You hold the key to self-regulation. Whenever life brings storms, you now know the pathway back to your inner sanctuary.',
    narrativeText: 'Congratulations! You have completed the Narrative Neuro-Odyssey. Your neuroplastic conditioning is sealed.',
    imageUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1920&q=80',
    targetMetric: 'Coherence',
    thresholdTarget: 'Mastery Complete',
  },
];

export const NarrativeTherapyMode: React.FC<NarrativeTherapyProps> = ({ eegData }) => {
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [neuralSyncProgress, setNeuralSyncProgress] = useState(0);
  const [pageUnlocked, setPageUnlocked] = useState(false);
  const [userChoice, setUserChoice] = useState<string | null>(null);

  const scene = STORY_EPISODES[currentSceneIndex] || STORY_EPISODES[0];
  const inZone = eegData?.inZone ?? true;
  const zoneScore = eegData?.zoneScore ?? (inZone ? 1.0 : 0.0);

  // Progressive unlock of the scene dialogue based on sustained in-zone state
  useEffect(() => {
    if (!eegData) return;

    if (eegData.inZone) {
      setNeuralSyncProgress((p) => {
        const next = p + 3.5 * (eegData.zoneScore || 1);
        if (next >= 100) {
          if (!pageUnlocked) {
            setPageUnlocked(true);
            audioEngine.playChime('success');
          }
          return 100;
        }
        return next;
      });
    } else {
      setNeuralSyncProgress((p) => Math.max(0, p - 3.5));
    }
  }, [eegData, pageUnlocked]);

  const handleNextPage = () => {
    if (currentSceneIndex < STORY_EPISODES.length - 1) {
      setCurrentSceneIndex((prev) => prev + 1);
      setNeuralSyncProgress(0);
      setPageUnlocked(false);
      setUserChoice(null);
      audioEngine.playChime('breath-in');
    }
  };

  const handlePrevPage = () => {
    if (currentSceneIndex > 0) {
      setCurrentSceneIndex((prev) => prev - 1);
      setNeuralSyncProgress(0);
      setPageUnlocked(false);
      setUserChoice(null);
    }
  };

  const handleSelectChoice = (choice: { text: string; nextSceneId: string; reward: string }) => {
    setUserChoice(choice.text);
    audioEngine.playChime('success');
    setTimeout(() => {
      handleNextPage();
    }, 600);
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
        fontFamily: 'var(--font-body)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <style>
        {`
          @keyframes kenBurns {
            0% { transform: scale(1.03) translate(0, 0); }
            50% { transform: scale(1.10) translate(-1%, -1%); }
            100% { transform: scale(1.03) translate(0, 0); }
          }
          @keyframes particleFloat {
            0% { transform: translateY(100%) scale(0.6); opacity: 0; }
            50% { opacity: 0.8; }
            100% { transform: translateY(-20%) scale(1.1); opacity: 0; }
          }
        `}
      </style>

      {/* Cinematic Graphic Novel Background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${scene.imageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: inZone ? 0.85 : 0.45,
          filter: inZone
            ? `brightness(${0.8 + 0.25 * zoneScore}) contrast(${1.0 + 0.15 * zoneScore}) saturate(${1.0 + 0.3 * zoneScore})`
            : 'grayscale(55%) brightness(0.6) blur(2px)',
          animation: 'kenBurns 28s ease-in-out infinite',
          transition: 'all 1.2s ease-in-out',
        }}
      />

      {/* Atmospheric Vignette and Noise Gradients */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at center, rgba(10,10,15,0.2) 20%, rgba(10,10,15,0.92) 90%)',
          pointerEvents: 'none',
        }}
      />

      {/* Floating Golden Sparks when In-Zone */}
      {inZone && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          {Array.from({ length: 12 }).map((_, idx) => (
            <div
              key={idx}
              style={{
                position: 'absolute',
                left: `${10 + idx * 7.5}%`,
                bottom: '10%',
                width: `${4 + (idx % 3) * 2}px`,
                height: `${4 + (idx % 3) * 2}px`,
                backgroundColor: '#FFD700',
                borderRadius: '50%',
                boxShadow: '0 0 10px #FFD700, 0 0 20px #FFA500',
                animation: `particleFloat ${4 + (idx % 4) * 1.5}s infinite ease-out`,
                animationDelay: `${idx * 0.4}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* Top Story Header & Chapter Badges */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          padding: '14px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
          background: 'rgba(10, 10, 15, 0.65)',
          backdropFilter: 'blur(10px)',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              backgroundColor: 'rgba(232, 150, 122, 0.2)',
              color: 'var(--brand-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <BookOpen size={16} />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: '#E4B87C', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {scene.actTitle} • Chapter {scene.chapter}
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>
              {scene.sceneTitle}
            </div>
          </div>
        </div>

        {/* Neuro Metric Target Pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(255, 255, 255, 0.1)',
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
          }}
        >
          <Brain size={13} color="var(--brand-primary)" />
          <span style={{ fontSize: '11px', color: '#FFFFFF', fontWeight: 500 }}>
            {scene.targetMetric}: <strong>{scene.thresholdTarget}</strong>
          </span>
        </div>
      </div>

      {/* Main Narrative Comic Panel Viewport */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          flex: 1,
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          gap: '16px',
          maxHeight: '100%',
          overflowY: 'auto',
        }}
      >
        {/* Comic Dialogue Frame */}
        <div
          style={{
            background: inZone ? 'rgba(18, 20, 32, 0.92)' : 'rgba(15, 15, 20, 0.85)',
            border: inZone ? '1.5px solid rgba(232, 150, 122, 0.6)' : '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px 24px',
            backdropFilter: 'blur(16px)',
            boxShadow: inZone
              ? '0 16px 40px rgba(0, 0, 0, 0.6), 0 0 20px rgba(232, 150, 122, 0.2)'
              : '0 8px 30px rgba(0, 0, 0, 0.5)',
            transition: 'all 0.5s ease',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {/* Speaker Label */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: inZone ? '#68D391' : '#F6AD55',
                  boxShadow: inZone ? '0 0 10px #68D391' : 'none',
                }}
              />
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#E4B87C', letterSpacing: '0.04em' }}>
                {scene.speaker}
              </span>
            </div>

            <span style={{ fontSize: '11px', color: inZone ? '#68D391' : '#CBD5E0', fontWeight: 600 }}>
              {inZone ? '✨ Neural Sync Active' : '🌫️ Relax to Reveal'}
            </span>
          </div>

          {/* Dialogue Text */}
          <p
            style={{
              fontSize: '16px',
              lineHeight: 1.55,
              color: '#FFFFFF',
              fontStyle: 'italic',
              margin: 0,
              textShadow: '0 2px 4px rgba(0,0,0,0.6)',
            }}
          >
            "{scene.dialogue}"
          </p>

          {/* Narrative Scene Context */}
          <p
            style={{
              fontSize: '13px',
              lineHeight: 1.5,
              color: '#A0AEC0',
              margin: 0,
            }}
          >
            {scene.narrativeText}
          </p>

          {/* Neural Resonance Charge Progress Bar */}
          <div style={{ marginTop: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#CBD5E0', marginBottom: '4px' }}>
              <span>Resonance Lock</span>
              <span className="font-mono" style={{ color: inZone ? 'var(--brand-primary)' : '#A0AEC0', fontWeight: 700 }}>
                {Math.round(neuralSyncProgress)}%
              </span>
            </div>
            <div style={{ width: '100%', height: '5px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '3px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${neuralSyncProgress}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #E8967A 0%, #FFD700 100%)',
                  borderRadius: '3px',
                  boxShadow: '0 0 10px rgba(232, 150, 122, 0.6)',
                  transition: 'width 0.25s ease',
                }}
              />
            </div>
          </div>

          {/* Interactive Choices if present */}
          {scene.choices && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#E4B87C', textTransform: 'uppercase' }}>
                Cognitive Reframing Choice:
              </span>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {scene.choices.map((choice, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelectChoice(choice)}
                    style={{
                      flex: 1,
                      minWidth: '200px',
                      background: userChoice === choice.text ? 'var(--brand-primary)' : 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: 'var(--radius-md)',
                      padding: '10px 14px',
                      color: '#FFFFFF',
                      fontSize: '12px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span>{choice.text}</span>
                    <span style={{ fontSize: '10px', color: '#FFD700', fontWeight: 700 }}>{choice.reward}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Navigation & Page Turn Actions */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          padding: '12px 18px',
          background: 'rgba(10, 10, 15, 0.85)',
          backdropFilter: 'blur(10px)',
          borderTop: '1px solid rgba(255, 255, 255, 0.12)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <button
          onClick={handlePrevPage}
          disabled={currentSceneIndex === 0}
          className="btn btn-ghost"
          style={{
            color: currentSceneIndex === 0 ? 'rgba(255,255,255,0.2)' : '#FFFFFF',
            padding: '8px 14px',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <ChevronLeft size={16} /> Previous
        </button>

        {/* Scene Indicator Dots */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {STORY_EPISODES.map((s, idx) => (
            <div
              key={s.id}
              onClick={() => {
                setCurrentSceneIndex(idx);
                setNeuralSyncProgress(0);
              }}
              style={{
                width: currentSceneIndex === idx ? '20px' : '6px',
                height: '6px',
                borderRadius: '3px',
                backgroundColor: currentSceneIndex === idx ? 'var(--brand-primary)' : 'rgba(255, 255, 255, 0.2)',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
              }}
              title={s.sceneTitle}
            />
          ))}
        </div>

        {/* Next / Turn Page Button */}
        <button
          onClick={handleNextPage}
          disabled={currentSceneIndex === STORY_EPISODES.length - 1}
          style={{
            background: pageUnlocked
              ? 'linear-gradient(135deg, #E8967A 0%, #D4805E 100%)'
              : 'rgba(255, 255, 255, 0.12)',
            color: '#FFFFFF',
            border: pageUnlocked ? 'none' : '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: 'var(--radius-full)',
            padding: '9px 20px',
            fontSize: '13px',
            fontWeight: 700,
            cursor: currentSceneIndex === STORY_EPISODES.length - 1 ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: pageUnlocked ? '0 4px 20px rgba(232, 150, 122, 0.4)' : 'none',
            transition: 'all 0.3s ease',
          }}
        >
          <span>{currentSceneIndex === STORY_EPISODES.length - 1 ? 'Odyssey Complete' : 'Turn Page'}</span>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
};
