import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { BrandLogo } from '../../components/brand/BrandLogo';
import { ArrowLeft } from 'lucide-react';

export const SignUp: React.FC = () => {
  const navigate = useNavigate();
  const { signup } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const getErrorMessage = (err: any): string => {
    const code = err?.code || '';
    const message = err?.message || '';

    if (code === 'auth/email-already-in-use') return 'An account with this email already exists.';
    if (code === 'auth/invalid-email') return 'Please enter a valid email address.';
    if (code === 'auth/weak-password') return 'Password should be at least 6 characters.';
    if (code === 'auth/operation-not-allowed' || message.includes('CONFIGURATION_NOT_FOUND')) {
      return 'Firebase Authentication is not yet enabled. In your Firebase Console, go to Authentication > Sign-in method and enable Email/Password.';
    }
    if (code === 'auth/invalid-api-key' || code === 'auth/api-key-not-valid') {
      return 'Firebase API key is invalid or unconfigured.';
    }
    return message || 'Failed to create account. Please try again.';
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signup(email, password, displayName);
      navigate('/role-selection');
    } catch (err: any) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--surface-patient-base)',
      color: 'var(--text-primary)',
      padding: 'calc(32px + env(safe-area-inset-top, 0px)) 20px calc(32px + env(safe-area-inset-bottom, 0px))',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      boxSizing: 'border-box',
    }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <button 
          onClick={() => navigate(-1)}
          style={{
            background: 'none', border: 'none', color: 'var(--text-secondary)',
            display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
            padding: 0, marginBottom: '24px', fontSize: '14px'
          }}
        >
          <ArrowLeft size={18} /> Back
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <BrandLogo size={44} variant="terracotta" />
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0, lineHeight: 1.2 }}>Create Account</h1>
            <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '13px' }}>Start your journey with Waveable</p>
          </div>
        </div>

        {error && (
          <div style={{
            background: '#FF4C4C15',
            color: '#D32F2F',
            padding: '14px',
            borderRadius: '8px',
            marginBottom: '24px',
            fontSize: '14px',
            lineHeight: '1.4',
            border: '1px solid rgba(211, 47, 47, 0.2)'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSignUp} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '14px', marginBottom: '8px', color: 'var(--text-secondary)' }}>Your Name</label>
            <input 
              type="text" 
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="How should we call you?"
              required
              autoComplete="name"
              style={{
                width: '100%', padding: '16px', borderRadius: 'var(--radius-md)',
                background: 'var(--surface-patient-card)', border: `1px solid var(--border-subtle)`,
                color: 'var(--text-primary)', fontSize: '16px', boxSizing: 'border-box'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '14px', marginBottom: '8px', color: 'var(--text-secondary)' }}>Email</label>
            <input 
              type="email" 
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              style={{
                width: '100%', padding: '16px', borderRadius: 'var(--radius-md)',
                background: 'var(--surface-patient-card)', border: `1px solid var(--border-subtle)`,
                color: 'var(--text-primary)', fontSize: '16px', boxSizing: 'border-box'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '14px', marginBottom: '8px', color: 'var(--text-secondary)' }}>Password</label>
            <input 
              type="password" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
              style={{
                width: '100%', padding: '16px', borderRadius: 'var(--radius-md)',
                background: 'var(--surface-patient-card)', border: `1px solid var(--border-subtle)`,
                color: 'var(--text-primary)', fontSize: '16px', boxSizing: 'border-box'
              }}
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            style={{
              background: 'var(--brand-primary)',
              color: 'var(--brand-on-primary)',
              border: 'none',
              padding: '16px',
              borderRadius: 'var(--radius-md)',
              fontSize: '18px',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              marginTop: '8px',
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '14px', color: 'var(--text-secondary)' }}>
          Already have an account?{' '}
          <span 
            onClick={() => navigate('/login')}
            style={{ color: 'var(--brand-primary)', fontWeight: '600', cursor: 'pointer' }}
          >
            Log in
          </span>
        </div>
      </div>
    </div>
  );
};
