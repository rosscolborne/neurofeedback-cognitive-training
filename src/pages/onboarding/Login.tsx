import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
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
      code === 'auth/wrong-password' ||
      message.includes('INVALID_LOGIN_CREDENTIALS')
    ) {
      return 'Invalid email or password. Please check your credentials or create a new account.';
    }
    if (code === 'auth/invalid-email') return 'Please enter a valid email address.';
    if (code === 'auth/too-many-requests') {
      return 'Too many failed login attempts. Please try again later.';
    }
    if (code === 'auth/network-request-failed') {
      return 'Network connection failed. Please check your internet connection.';
    }
    return message || 'Failed to log in. Please try again.';
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email.trim(), password);
      navigate('/');
    } catch (err: any) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--surface-patient-base)',
      color: 'var(--text-primary)',
      padding: '40px 20px',
    }}>
      <button 
        onClick={() => navigate(-1)}
        style={{
          background: 'none', border: 'none', color: 'var(--text-primary)',
          display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
          padding: 0, marginBottom: '32px'
        }}
      >
        <ArrowLeft size={24} /> Back
      </button>

      <h1 style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '8px' }}>Log In</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>Welcome back to Brainwell</p>

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
  );
};
