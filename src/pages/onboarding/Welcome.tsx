import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { BrandLogo } from '../../components/brand/BrandLogo';
import { audioEngine } from '../../services/audioEngine';

export const Welcome: React.FC = () => {
  const navigate = useNavigate();
  const hasPlayedAudio = useRef(false);

  useEffect(() => {
    // Play the serene 432Hz meditative singing bowl chime on the user's first touch/click
    const handleFirstInteraction = () => {
      if (!hasPlayedAudio.current) {
        hasPlayedAudio.current = true;
        try {
          audioEngine.playMeditativeIntroChime();
        } catch (e) {
          // Gracefully ignore any audio restrictions
        }
      }
    };

    window.addEventListener('pointerdown', handleFirstInteraction, { once: true });
    window.addEventListener('keydown', handleFirstInteraction, { once: true });

    return () => {
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
    };
  }, []);

  return (
    <main
      style={{
        minHeight: '100dvh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'calc(32px + env(safe-area-inset-top, 0px)) 24px calc(32px + env(safe-area-inset-bottom, 0px))',
        boxSizing: 'border-box',
        backgroundColor: 'var(--surface-patient-base)',
        backgroundImage: 'radial-gradient(circle at 50% 35%, rgba(209, 109, 77, 0.09) 0%, rgba(248, 247, 244, 0) 65%)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Centered Content Container */}
      <div
        style={{
          width: '100%',
          maxWidth: '400px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          margin: 'auto 0',
          gap: '24px',
          animation: 'fadeIn 0.6s ease-out',
        }}
      >
        {/* Meditative Glowing Brand Logo */}
        <div style={{ marginBottom: '8px' }}>
          <BrandLogo size={112} variant="terracotta" glow />
        </div>

        {/* Header & Subtitle */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h1
            className="font-display"
            style={{
              fontSize: '32px',
              fontWeight: 400,
              lineHeight: 1.25,
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em',
              margin: 0,
            }}
          >
            Welcome to your<br />brain training journey
          </h1>

          <p
            style={{
              fontSize: '15px',
              color: 'var(--text-secondary)',
              lineHeight: 1.55,
              maxWidth: '320px',
              margin: '0 auto',
            }}
          >
            Personalized neurofeedback to calm your mind, sharpen focus, and restore balance.
          </p>
        </div>

        {/* Primary & Secondary Action CTAs */}
        <div
          style={{
            width: '100%',
            maxWidth: '320px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            marginTop: '12px',
          }}
        >
          <button
            onClick={() => navigate('/signup')}
            className="btn btn-primary"
            style={{
              width: '100%',
              padding: '16px',
              fontSize: '16px',
              borderRadius: 'var(--radius-xl)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 18px rgba(209, 109, 77, 0.25)',
            }}
          >
            <span>Begin Journey</span>
            <ArrowRight size={18} />
          </button>

          <button
            onClick={() => navigate('/login')}
            className="btn btn-secondary"
            style={{
              width: '100%',
              padding: '14px',
              fontSize: '15px',
              borderRadius: 'var(--radius-xl)',
              backgroundColor: 'var(--surface-patient-card)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-primary)',
            }}
          >
            Sign In
          </button>
        </div>

        {/* Minimal Legal Footer */}
        <div
          style={{
            marginTop: '8px',
            fontSize: '12px',
            color: 'var(--text-tertiary)',
            lineHeight: 1.5,
          }}
        >
          By continuing, you agree to our{' '}
          <a
            href="#/legal/terms"
            onClick={(e) => {
              e.preventDefault();
              navigate('/legal/terms');
            }}
            style={{ color: 'var(--brand-primary)', textDecoration: 'none' }}
          >
            Terms
          </a>{' '}
          and{' '}
          <a
            href="#/legal/privacy"
            onClick={(e) => {
              e.preventDefault();
              navigate('/legal/privacy');
            }}
            style={{ color: 'var(--brand-primary)', textDecoration: 'none' }}
          >
            Privacy Policy
          </a>.
        </div>
      </div>
    </main>
  );
};
