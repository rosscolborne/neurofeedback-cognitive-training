import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Mail, RefreshCw, LogOut } from 'lucide-react';
import { sendEmailVerification } from 'firebase/auth';
import { auth } from '../../services/firebase';

export const VerifyEmail: React.FC = () => {
  const { user, logout } = useAuth();
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const handleResend = async () => {
    if (!auth.currentUser) return;
    setResendStatus('sending');
    try {
      await sendEmailVerification(auth.currentUser);
      setResendStatus('sent');
      setTimeout(() => setResendStatus('idle'), 5000);
    } catch (error) {
      setResendStatus('error');
      setTimeout(() => setResendStatus('idle'), 5000);
    }
  };

  const handleCheckVerification = async () => {
    // Reload user to get latest emailVerified status
    await auth.currentUser?.reload();
    // Context will pick up the change eventually, but we force a reload of the window for immediate effect
    window.location.reload();
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
      justifyContent: 'center',
      boxSizing: 'border-box',
    }}>
      <div style={{ width: '100%', maxWidth: '380px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
          <div style={{ 
            width: '80px', height: '80px', borderRadius: '50%', 
            background: 'var(--brand-primary-subtle)', color: 'var(--brand-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Mail size={40} />
          </div>
        </div>

        <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 8px 0', lineHeight: 1.2 }}>
          Verify your email
        </h1>
        <p style={{ color: 'var(--text-secondary)', margin: '0 0 24px 0', fontSize: '15px', lineHeight: 1.5 }}>
          We've sent a verification link to <strong>{user?.email}</strong>. Please check your inbox and tap the link to activate your account.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button 
            onClick={handleCheckVerification}
            style={{
              background: 'var(--brand-primary)', color: 'var(--brand-on-primary)',
              border: 'none', padding: '16px', borderRadius: 'var(--radius-md)',
              fontSize: '16px', fontWeight: '600', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
            }}
          >
            <RefreshCw size={18} /> I've Verified My Email
          </button>
          
          <button 
            onClick={handleResend}
            disabled={resendStatus === 'sending' || resendStatus === 'sent'}
            style={{
              background: 'transparent', color: 'var(--brand-primary)',
              border: '1.5px solid var(--brand-primary)', padding: '16px', borderRadius: 'var(--radius-md)',
              fontSize: '16px', fontWeight: '600', cursor: resendStatus === 'sending' || resendStatus === 'sent' ? 'default' : 'pointer',
              opacity: resendStatus === 'sending' || resendStatus === 'sent' ? 0.7 : 1
            }}
          >
            {resendStatus === 'sending' ? 'Sending...' : 
             resendStatus === 'sent' ? 'Email Sent!' : 
             resendStatus === 'error' ? 'Failed to send. Try again.' : 
             'Resend Verification Link'}
          </button>
          
          <button 
            onClick={logout}
            style={{
              background: 'transparent', color: 'var(--text-tertiary)',
              border: 'none', padding: '16px', borderRadius: 'var(--radius-md)',
              fontSize: '15px', fontWeight: '500', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              marginTop: '12px'
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
};
