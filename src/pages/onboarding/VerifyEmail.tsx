import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Mail, RefreshCw, LogOut, AlertCircle, CheckCircle2 } from 'lucide-react';
import { sendEmailVerification, ActionCodeSettings } from 'firebase/auth';
import { auth } from '../../services/firebase';

const ACTION_CODE_SETTINGS: ActionCodeSettings = {
  url: typeof window !== 'undefined' ? window.location.origin : 'https://brainswell.app',
  handleCodeInApp: true,
  iOS: {
    bundleId: 'com.brainswell.app',
  },
};

export const VerifyEmail: React.FC = () => {
  const { user, logout } = useAuth();
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [isChecking, setIsChecking] = useState(false);

  // Periodic automatic check in background so user doesn't even need to click
  useEffect(() => {
    const interval = setInterval(async () => {
      if (auth.currentUser) {
        await auth.currentUser.reload().catch(() => {});
        if (auth.currentUser.emailVerified) {
          window.location.reload();
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const handleResend = async () => {
    if (!auth.currentUser) return;
    setResendStatus('sending');
    try {
      await sendEmailVerification(auth.currentUser, ACTION_CODE_SETTINGS);
      setResendStatus('sent');
      setTimeout(() => setResendStatus('idle'), 5000);
    } catch (error) {
      console.warn('Failed to resend verification email:', error);
      setResendStatus('error');
      setTimeout(() => setResendStatus('idle'), 5000);
    }
  };

  const handleCheckVerification = async () => {
    setIsChecking(true);
    try {
      await auth.currentUser?.reload();
      if (auth.currentUser?.emailVerified) {
        window.location.reload();
      } else {
        alert('Email not yet verified. Please tap the link sent to your email, or move the email to your inbox if it went to spam.');
      }
    } catch (err) {
      console.warn('Error checking verification:', err);
    } finally {
      setIsChecking(false);
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
      justifyContent: 'center',
      boxSizing: 'border-box',
    }}>
      <div style={{ width: '100%', maxWidth: '380px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
          <div style={{ 
            width: '76px', height: '76px', borderRadius: '50%', 
            background: 'var(--brand-primary-subtle)', color: 'var(--brand-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Mail size={36} />
          </div>
        </div>

        <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 8px 0', lineHeight: 1.2 }}>
          Verify your email
        </h1>
        <p style={{ color: 'var(--text-secondary)', margin: '0 0 16px 0', fontSize: '14px', lineHeight: 1.5 }}>
          We've sent a verification email to <strong style={{ color: 'var(--text-primary)' }}>{user?.email}</strong>.
        </p>

        {/* Junk / Unclickable Link Callout Banner */}
        <div style={{
          backgroundColor: 'rgba(232, 150, 122, 0.08)',
          border: '1px solid rgba(232, 150, 122, 0.25)',
          borderRadius: 'var(--radius-md)',
          padding: '14px',
          margin: '0 0 20px 0',
          fontSize: '13px',
          textAlign: 'left',
          color: 'var(--text-secondary)',
          lineHeight: 1.45,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '6px' }}>
            <AlertCircle size={16} color="var(--brand-primary)" />
            <span>Link not clickable or in Junk?</span>
          </div>
          If the email landed in your <strong>Junk/Spam</strong> folder, email apps disable links for protection. Tap <strong>"Not Junk"</strong> or <strong>Move to Inbox</strong> and the link will become active.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button 
            onClick={handleCheckVerification}
            disabled={isChecking}
            style={{
              background: 'var(--brand-primary)', color: 'var(--brand-on-primary)',
              border: 'none', padding: '16px', borderRadius: 'var(--radius-md)',
              fontSize: '16px', fontWeight: '600', cursor: isChecking ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
            }}
          >
            <RefreshCw size={18} className={isChecking ? 'spin' : ''} />
            {isChecking ? 'Checking...' : "I've Verified My Email"}
          </button>
          
          <button 
            onClick={handleResend}
            disabled={resendStatus === 'sending' || resendStatus === 'sent'}
            style={{
              background: 'transparent', color: 'var(--brand-primary)',
              border: '1.5px solid var(--brand-primary)', padding: '16px', borderRadius: 'var(--radius-md)',
              fontSize: '15px', fontWeight: '600', cursor: resendStatus === 'sending' || resendStatus === 'sent' ? 'default' : 'pointer',
              opacity: resendStatus === 'sending' || resendStatus === 'sent' ? 0.7 : 1
            }}
          >
            {resendStatus === 'sending' ? 'Sending...' : 
             resendStatus === 'sent' ? 'Verification Link Sent!' : 
             resendStatus === 'error' ? 'Failed to send. Try again.' : 
             'Resend Verification Link'}
          </button>
          
          <button 
            onClick={logout}
            style={{
              background: 'transparent', color: 'var(--text-tertiary)',
              border: 'none', padding: '12px', borderRadius: 'var(--radius-md)',
              fontSize: '14px', fontWeight: '500', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              marginTop: '8px'
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
};
