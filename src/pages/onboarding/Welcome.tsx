import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, ArrowRight } from 'lucide-react';

export const Welcome: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--surface-patient-base)',
      color: 'var(--text-primary)',
      padding: '40px 20px',
      justifyContent: 'center',
      alignItems: 'center'
    }}>
      <div style={{
        background: 'var(--surface-patient-card)',
        padding: '24px',
        borderRadius: 'var(--radius-lg)',
        border: `1px solid var(--border-subtle)`,
        marginBottom: '40px',
        boxShadow: `0 8px 32px var(--brand-primary-subtle)`
      }}>
        <Brain size={64} color="var(--brand-primary)" />
      </div>

      <h1 style={{
        fontSize: '32px',
        fontWeight: 'bold',
        marginBottom: '16px',
        textAlign: 'center',
        background: `linear-gradient(135deg, var(--text-primary), var(--text-secondary))`,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
      }}>
        Welcome to Brainwell
      </h1>
      
      <p style={{
        fontSize: '18px',
        color: 'var(--text-secondary)',
        textAlign: 'center',
        maxWidth: '300px',
        marginBottom: '60px',
        lineHeight: 1.5
      }}>
        Train your brain, improve your focus, and achieve deep relaxation.
      </p>

      <div style={{ width: '100%', maxWidth: '320px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <button
          onClick={() => navigate('/signup')}
          style={{
            background: 'var(--brand-primary)',
            color: 'var(--brand-on-primary)',
            border: 'none',
            padding: '16px',
            borderRadius: 'var(--radius-md)',
            fontSize: '18px',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          Get Started <ArrowRight size={20} />
        </button>
        
        <button
          onClick={() => navigate('/login')}
          style={{
            background: 'transparent',
            color: 'var(--text-primary)',
            border: `1px solid var(--border-subtle)`,
            padding: '16px',
            borderRadius: 'var(--radius-md)',
            fontSize: '18px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
        >
          I already have an account
        </button>
      </div>

      <div style={{ marginTop: 'auto', paddingTop: '40px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '14px' }}>
        By continuing, you agree to our <br/>
        <a href="/legal/terms" onClick={(e) => { e.preventDefault(); navigate('/legal/terms'); }} style={{ color: 'var(--brand-primary)', textDecoration: 'none' }}>Terms of Service</a> and <a href="/legal/privacy" onClick={(e) => { e.preventDefault(); navigate('/legal/privacy'); }} style={{ color: 'var(--brand-primary)', textDecoration: 'none' }}>Privacy Policy</a>.
      </div>
    </div>
  );
};
