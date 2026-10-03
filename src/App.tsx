import React from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { PatientShell } from './components/patient/PatientShell';
import { BrandLogo } from './components/brand/BrandLogo';

import { useAuth } from './contexts/AuthContext';
import { Welcome } from './pages/onboarding/Welcome';
import { SignUp } from './pages/onboarding/SignUp';
import { Login } from './pages/onboarding/Login';
import { HardwareSetup } from './pages/onboarding/HardwareSetup';
import { PrivacyPolicy } from './pages/legal/PrivacyPolicy';
import { TermsOfService } from './pages/legal/TermsOfService';
import { useSignOut } from './components/account/useSignOut';

export function App() {
  const { user, profile, loading, logout, cacheStatus, cacheEndingReason, signOutWithoutFirestore, profileLookupFailed, retryProfileLookup } = useAuth();
  // Sign-out from the profile lookup's error screen, which asks before
  // discarding writes that have not uploaded, as the shell's Log Out does.
  const profileLookupSignOut = useSignOut(logout);
  const navigate = useNavigate();
  const accountIdentity = `${loading ? 'loading' : 'ready'}:${user?.uid ?? 'signed-out'}`;

  // While the cache is being cleared for an account change, nothing of any
  // account is shown, only what is happening. `ending` replaces the account's
  // screens before the page navigates away, so a page kept by the browser's
  // back/forward cache holds none of its data either.
  // A sign-out started from the profile lookup's error screen keeps that
  // screen, and its unsynced-writes question, until the user has answered: a
  // lookup that succeeds meanwhile (one in flight, or the automatic retry)
  // must not close it. Once signing out proceeds, the app loads afresh.
  const profileLookupSignOutPending = profileLookupSignOut.phase === 'checking' || profileLookupSignOut.phase === 'unsynced';
  // A signed-in player is shown nothing until their profile is loaded.
  const awaitingProfile = Boolean(user) && !profile;
  if (loading || awaitingProfile || cacheStatus === 'ending' || profileLookupSignOutPending) {
    const waiting = cacheStatus === 'blocked' || cacheStatus === 'failed';
    const profileUnavailable = Boolean(user) && (profileLookupFailed || profileLookupSignOutPending) && !waiting && cacheStatus !== 'ending';
    const notice = cacheStatus === 'ending' ? { title: cacheEndingReason === 'account-deleted' ? 'Finishing account deletion…' : 'Signing out…' }
      : cacheStatus === 'blocked' ? {
        title: 'Finishing sign-out on this device…',
        detail: 'Close any other tabs or windows with this app open to continue.',
      }
        : cacheStatus === 'failed' ? {
          title: 'Sign-out couldn’t finish on this device.',
          detail: 'Close any other tabs or windows with this app open, then try again.',
          retry: true,
        }
          : profileUnavailable ? {
            title: 'Your account couldn’t be loaded.',
            detail: 'Check your internet connection, then try again.',
            retry: true,
          }
            : null;
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', padding: '24px', textAlign: 'center', background: 'var(--surface-patient-base, #F8F7F4)', color: 'var(--text-secondary)' }}>
        <BrandLogo size={72} variant="terracotta" glow />
        {notice && (
          <div role={notice.retry ? 'alert' : 'status'} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', maxWidth: '360px' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{notice.title}</strong>
            {notice.detail && <span>{notice.detail}</span>}
          </div>
        )}
        {waiting && (
          // Signing out needs no Firestore, so it works while the cache is held open.
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {cacheStatus === 'failed' && <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Try again</button>}
            <button type="button" className="btn btn-secondary" onClick={() => void signOutWithoutFirestore()}>Sign out</button>
          </div>
        )}
        {profileUnavailable && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {/* Not while sign-out runs or asks about unsynced writes: a lookup that succeeds would close that step. */}
            <button type="button" className="btn btn-primary" disabled={profileLookupSignOut.busy || profileLookupSignOut.phase === 'unsynced'} onClick={retryProfileLookup}>Try again</button>
            <button type="button" className="btn btn-secondary" disabled={profileLookupSignOut.busy} onClick={profileLookupSignOut.requestSignOut}>Sign out</button>
          </div>
        )}
        {profileUnavailable && profileLookupSignOut.dialog}
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/legal/privacy" element={<PrivacyPolicy />} />
      <Route path="/legal/terms" element={<TermsOfService />} />

      {!user ? (
        <>
          <Route path="/" element={<Welcome />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      ) : (
        <>
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/hardware-setup" element={<HardwareSetup key={accountIdentity} />} />
          <Route
            path="/"
            element={profile && (
              <PatientShell
                user={user}
                profile={profile}
                onSetUpHeadset={() => navigate('/hardware-setup')}
              />
            )}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      )}
    </Routes>
  );
}

export default App;
