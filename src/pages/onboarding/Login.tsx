import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { BrandLogo } from '../../components/brand/BrandLogo';
import { ArrowLeft } from 'lucide-react';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const getErrorMessage = (err: any): string => {
    const code = err?.code || '';
    const message = err?.message || '';

    if (
      code === 'auth/invalid-credential' ||
      code === 'auth/invalid-login-credentials' ||
      code === 'auth/user-not-found' ||
      code === 'auth/wrong-password'
    ) {
      return 'Incorrect email or password. Please check your credentials and try again.';
    }
    if (code === 'auth/invalid-email') {
      return 'Please enter a valid email address.';
    }
    if (code === 'auth/too-many-requests') {
      return 'Access temporarily locked due to multiple failed login attempts. Please reset your password or try again later.';
    }
    if (code === 'auth/network-request-failed') {
      return 'Network connection error. Please verify your internet connection.';
    }
    if (message.toLowerCase().includes('timed out')) {
      return 'The login attempt timed out. Please check your network connection and try again.';
    }
    return message || 'An unexpected error occurred during login. Please try again.';
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please fill in all fields.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await login(email, password);
      navigate('/');
    } catch (err: any) {
      console.error(err);
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
            <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0, lineHeight: 1.2 }}>Log In</h1>
            <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '13px' }}>Welcome back to Brainswell</p>
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

      <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '14px', marginBottom: '8px', color: 'var(--text-secondary)' }}>Email</label>
          <input 
            type="email" 
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="name@example.com"
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
            placeholder="Your password"
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
          {loading ? 'Logging in...' : 'Log In'}
        </button>
      </form>
      </div>
    </div>
  );
};
