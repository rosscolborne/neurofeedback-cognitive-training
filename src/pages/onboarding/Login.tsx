import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { BrandLogo } from '../../components/brand/BrandLogo';
import { ArrowLeft, Stethoscope } from 'lucide-react';
import { shouldOfferClinicianDemoWorkspace } from '../../services/clinicianDemoBoundary';

// Client-side pause between reset emails to the same address so repeated clicks
// cannot flood an inbox. Firebase still applies its own server-side limits.
const RESET_COOLDOWN_MS = 60_000;

const normalizeResetAddress = (value: string) => value.trim().toLowerCase();

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login, loginAsDemoClinician, requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetView, setResetView] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSent, setResetSent] = useState<'first' | 'repeat' | null>(null);
  const [resetPending, setResetPending] = useState(false);
  const resetPendingRef = useRef(false);
  // When each normalized address may be sent another reset email. Kept at this
  // level so it survives leaving and reopening the reset view; the ref gives
  // handleReset the same synchronous guard as resetPendingRef.
  const [resetAvailableAt, setResetAvailableAt] = useState<Record<string, number>>({});
  const resetAvailableAtRef = useRef<Record<string, number>>({});
  const [resetClock, setResetClock] = useState(() => Date.now());

  const resetConfirmation = 'If an account uses that email address, we’ll send password reset instructions.';
  const resetRepeatConfirmation = 'If an account uses that email address, we’ll send a new reset email. Use the link in the most recent email. Earlier reset links no longer work.';
  const resetDeliveryHint = 'Reset emails can take a few minutes to arrive. If you don’t see one, check your spam or junk folder.';

  const resetAddressAvailableAt = resetAvailableAt[normalizeResetAddress(email)];
  const resetCooldownSeconds = resetAddressAvailableAt === undefined
    ? 0
    : Math.max(0, Math.ceil((resetAddressAvailableAt - resetClock) / 1000));
  const resetCoolingDown = resetView && resetCooldownSeconds > 0;

  // Tick only while the visible address is cooling down.
  useEffect(() => {
    if (!resetCoolingDown) return undefined;
    const timer = setInterval(() => setResetClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resetCoolingDown]);

  const openReset = () => {
    setError('');
    setResetError('');
    setResetSent(null);
    setResetClock(Date.now());
    setResetView(true);
  };

  const returnToLogin = () => {
    if (resetPendingRef.current) return;
    setResetError('');
    setResetSent(null);
    setError('');
    setResetView(false);
  };

  // A missing account goes through here too, so its message and cooldown match a real send.
  const confirmResetRequest = (key: string) => {
    const now = Date.now();
    const repeat = resetAvailableAtRef.current[key] !== undefined;
    resetAvailableAtRef.current = { ...resetAvailableAtRef.current, [key]: now + RESET_COOLDOWN_MS };
    setResetAvailableAt(resetAvailableAtRef.current);
    setResetClock(now);
    setResetSent(repeat ? 'repeat' : 'first');
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetPendingRef.current) return;
    const address = email.trim();
    const key = normalizeResetAddress(address);
    if ((resetAvailableAtRef.current[key] ?? 0) > Date.now()) return;
    setResetError('');
    setResetSent(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setResetError('Please enter a valid email address.');
      return;
    }
    resetPendingRef.current = true;
    setResetPending(true);
    try {
      await requestPasswordReset(address);
      confirmResetRequest(key);
    } catch (err: any) {
      const code = err?.code;
      if (code === 'auth/user-not-found' || code === 'auth/email-not-found') {
        confirmResetRequest(key);
      } else if (code === 'auth/invalid-email') {
        setResetError('Please enter a valid email address.');
      } else if (code === 'auth/network-request-failed') {
        setResetError('Connection problem. Please check your internet connection and try again.');
      } else if (code === 'auth/too-many-requests') {
        setResetError('Too many requests. Please wait and try again later.');
      } else {
        setResetError('We could not request a password reset. Please try again.');
      }
    } finally {
      resetPendingRef.current = false;
      setResetPending(false);
    }
  };

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
      return 'Access temporarily locked due to multiple failed login attempts. Use Forgot password? below or try again later.';
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

  const handleDemoClinician = async () => {
    setLoading(true);
    setError('');
    try {
      await loginAsDemoClinician();
      navigate('/');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const submitDisabled = resetView ? resetPending || resetCoolingDown : loading;
  const resetSubmitLabel = resetPending
    ? 'Sending...'
    : resetCoolingDown
      ? `Resend in ${resetCooldownSeconds}s`
      : resetAddressAvailableAt === undefined ? 'Send reset instructions' : 'Resend reset instructions';

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
            <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0, lineHeight: 1.2 }}>{resetView ? 'Reset Password' : 'Log In'}</h1>
            <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '13px' }}>Welcome back to Waveable</p>
          </div>
        </div>

      {(resetView ? resetError : error) && (
        <div role="alert" style={{
          background: '#FF4C4C15',
          color: '#D32F2F',
          padding: '14px',
          borderRadius: '8px',
          marginBottom: '24px',
          fontSize: '14px',
          lineHeight: '1.4',
          border: '1px solid rgba(211, 47, 47, 0.2)'
        }}>
          {resetView ? resetError : error}
        </div>
      )}

      {resetView && resetSent && (
        <div role="status" style={{
          background: 'var(--surface-patient-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '14px',
          marginBottom: '16px',
          fontSize: '14px',
          lineHeight: 1.4,
        }}>
          {resetSent === 'repeat' ? resetRepeatConfirmation : resetConfirmation}
          <span style={{ display: 'block', marginTop: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            {resetDeliveryHint}
          </span>
        </div>
      )}

      <form onSubmit={resetView ? handleReset : handleLogin} noValidate={resetView} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label htmlFor="login-email" style={{ display: 'block', fontSize: '14px', marginBottom: '8px', color: 'var(--text-secondary)' }}>Email</label>
          <input 
            id="login-email"
            type="email" 
            value={email}
            disabled={resetPending}
            onChange={e => {
              setEmail(e.target.value);
              if (resetView) {
                setResetError('');
                setResetSent(null);
                setResetClock(Date.now());
              }
            }}
            placeholder="name@example.com"
            required={!resetView}
            style={{
              width: '100%', padding: '16px', borderRadius: 'var(--radius-md)',
              background: 'var(--surface-patient-card)', border: `1px solid var(--border-subtle)`,
              color: 'var(--text-primary)', fontSize: '16px', boxSizing: 'border-box'
            }}
          />
        </div>

        {!resetView && <div>
          <label htmlFor="login-password" style={{ display: 'block', fontSize: '14px', marginBottom: '8px', color: 'var(--text-secondary)' }}>Password</label>
          <input 
            id="login-password"
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
        </div>}

        {!resetView && (
          <button type="button" onClick={openReset} disabled={loading} style={{
            alignSelf: 'flex-end', background: 'none', border: 'none',
            color: 'var(--brand-primary)', cursor: 'pointer', padding: 0,
            fontSize: '14px', fontWeight: 600,
          }}>
            Forgot password?
          </button>
        )}

        <button 
          type="submit" 
          disabled={submitDisabled}
          style={{
            background: 'var(--brand-primary)',
            color: 'var(--brand-on-primary)',
            border: 'none',
            padding: '16px',
            borderRadius: 'var(--radius-md)',
            fontSize: '18px',
            fontWeight: '600',
            cursor: submitDisabled ? 'not-allowed' : 'pointer',
            marginTop: '8px',
            opacity: submitDisabled ? 0.7 : 1
          }}
        >
          {resetView ? resetSubmitLabel : (loading ? 'Logging in...' : 'Log In')}
        </button>
      </form>

      {resetView && (
        <button type="button" onClick={returnToLogin} disabled={resetPending} style={{
          background: 'none', border: 'none', color: 'var(--text-secondary)',
          cursor: resetPending ? 'not-allowed' : 'pointer', padding: '16px 0',
          fontSize: '14px',
        }}>
          Return to login
        </button>
      )}

      {!resetView && shouldOfferClinicianDemoWorkspace() && (
        <section aria-label="Sample clinician workspace" style={{ marginTop: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px', gap: '12px' }}>
            <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
            <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Demo environment</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
          </div>
          <button
            type="button"
            onClick={() => void handleDemoClinician()}
            disabled={loading}
            style={{
              width: '100%', padding: '14px 16px', borderRadius: 'var(--radius-md)',
              background: 'rgba(232, 150, 122, 0.12)', border: '1.5px dashed var(--brand-primary)',
              color: 'var(--text-primary)', fontSize: '14px', fontWeight: 600, display: 'flex',
              alignItems: 'center', justifyContent: 'center', gap: '10px', cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Stethoscope size={18} color="var(--brand-primary)" />
            <span>Open Sample Clinician Workspace</span>
          </button>
          <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', textAlign: 'center', marginTop: '6px', marginBottom: 0 }}>
            Fictional sample records for demonstration only. This workspace is isolated from production accounts.
          </p>
        </section>
      )}

      </div>
    </div>
  );
};
