import React, { useState, useEffect } from 'react';
import { eegEngine } from '../../services/eegEngine';

export const NarrativeTherapyMode: React.FC = () => {
  const [inZone, setInZone] = useState(false);
  const [reflectionProgress, setReflectionProgress] = useState(0);

  const [currentScene, setCurrentScene] = useState({
    text: "The storm within begins to settle...",
    imageUrl: "https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=1920&q=80",
    requiresReflection: true
  });

  useEffect(() => {
    let progressTimer: ReturnType<typeof setTimeout>;
    
    const unsubscribe = eegEngine.subscribe((data) => {
      setInZone(data.inZone);
      
      if (currentScene.requiresReflection) {
        if (data.inZone) {
          setReflectionProgress(p => {
            const next = p + 2.5; // Progresses roughly over 4 seconds
            if (next >= 100) {
              handleNextClick();
              return 0;
            }
            return next;
          });
        } else {
          setReflectionProgress(p => Math.max(0, p - 5));
        }
      }
    });

    return () => {
      unsubscribe();
      if (progressTimer) clearTimeout(progressTimer);
    };
  }, [currentScene.requiresReflection]);

  const handleNextClick = () => {
    setReflectionProgress(0);
    setCurrentScene({
      text: "A clearing emerges through the fog.",
      imageUrl: "https://images.unsplash.com/photo-1506744626753-1407336c84c1?auto=format&fit=crop&w=1920&q=80",
      requiresReflection: false
    });
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: '#000', overflow: 'hidden', fontFamily: 'system-ui, serif' }}>
      {/* Dynamic Keyframes */}
      <style>
        {`
          @keyframes kenBurns {
            0% { transform: scale(1.05) translate(0, 0); }
            50% { transform: scale(1.15) translate(-1%, -1%); }
            100% { transform: scale(1.05) translate(0, 0); }
          }
          @keyframes floatUp {
            0% { transform: translateY(100vh) scale(0.5); opacity: 0; }
            50% { opacity: 0.8; }
            100% { transform: translateY(-10vh) scale(1.2); opacity: 0; }
          }
          @keyframes cinematicFade {
            0% { opacity: 0; transform: translateY(20px) translateX(-50%); filter: blur(4px); }
            100% { opacity: 1; transform: translateY(0) translateX(-50%); filter: blur(0px); }
          }
        `}
      </style>

      {/* Graphic Novel Background with Ken Burns */}
      <div 
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundImage: `url(${currentScene.imageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: inZone ? 0.8 : 0.4,
          filter: inZone ? 'grayscale(0%) contrast(1.1)' : 'grayscale(60%) contrast(0.9)',
          animation: 'kenBurns 30s ease-in-out infinite',
          transition: 'all 2s ease-in-out',
        }}
      />
      
      {/* Dynamic Dust Particles overlay based on state */}
      {inZone && Array.from({ length: 15 }).map((_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${Math.random() * 100}%`,
            width: `${Math.random() * 4 + 2}px`,
            height: `${Math.random() * 4 + 2}px`,
            backgroundColor: '#FFD700',
            borderRadius: '50%',
            boxShadow: '0 0 10px #FFD700, 0 0 20px #FFA500',
            animation: `floatUp ${Math.random() * 5 + 5}s linear infinite`,
            animationDelay: `${Math.random() * 5}s`,
            opacity: 0
          }}
        />
      ))}

      {/* Vignette Overlay */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'radial-gradient(circle at center, rgba(0,0,0,0) 10%, rgba(0,0,0,0.95) 100%)',
        pointerEvents: 'none',
      }} />

      {/* Cinematic Narrative Text */}
      <div 
        key={currentScene.text} // Forces re-render and re-animation on text change
        style={{
        position: 'absolute',
        bottom: '15%',
        left: '50%',
        transform: 'translateX(-50%)',
        textAlign: 'center',
        width: '90%',
        maxWidth: '800px',
        animation: 'cinematicFade 2.5s cubic-bezier(0.2, 0.8, 0.2, 1) forwards',
      }}>
        <h2 style={{ 
          color: '#fff', 
          fontSize: '36px', 
          fontWeight: 300, 
          letterSpacing: '2px', 
          lineHeight: '1.4',
          textShadow: '0px 4px 12px rgba(0,0,0,1), 0px 0px 20px rgba(255,255,255,0.2)',
          margin: 0
        }}>
          {currentScene.text}
        </h2>
        
        {/* Reflection Gate UI */}
        {currentScene.requiresReflection ? (
          <div style={{ marginTop: '50px', transition: 'opacity 1s ease', opacity: reflectionProgress > 0 ? 1 : 0.4 }}>
            <p style={{ color: '#E4B87C', fontSize: '13px', letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '16px', fontWeight: 600 }}>
              {inZone ? 'Calibrating Neural Sync...' : 'Relax to Progress'}
            </p>
            <div style={{ width: '240px', height: '3px', background: 'rgba(255,255,255,0.1)', margin: '0 auto', position: 'relative', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{
                position: 'absolute',
                top: 0, left: 0, bottom: 0,
                width: `${reflectionProgress}%`,
                background: 'linear-gradient(90deg, #E8967A, #FFD700)',
                transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: '0 0 15px rgba(255, 215, 0, 0.6)'
              }} />
            </div>
          </div>
        ) : (
          <button 
            onClick={handleNextClick}
            style={{
              marginTop: '50px',
              padding: '12px 40px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.3)',
              color: '#fff',
              cursor: 'pointer',
              letterSpacing: '2px',
              textTransform: 'uppercase',
              fontSize: '14px',
              borderRadius: '30px',
              transition: 'all 0.4s ease',
              backdropFilter: 'blur(5px)',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
              e.currentTarget.style.transform = 'scale(1.05)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            Turn Page
          </button>
        )}
      </div>
    </div>
  );
};
