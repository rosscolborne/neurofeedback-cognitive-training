import React, { useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ClientProfile } from './types';
import { storageEngine } from './services/storageEngine';
import { eegEngine } from './services/eegEngine';
import { getReusableBaselineModel } from './services/dataMappers';
import { PatientShell } from './components/patient/PatientShell';
import { BrandLogo } from './components/brand/BrandLogo';

import { useAuth } from './contexts/AuthContext';
import { Welcome } from './pages/onboarding/Welcome';
import { SignUp } from './pages/onboarding/SignUp';
import { Login } from './pages/onboarding/Login';
import { RoleSelection } from './pages/onboarding/RoleSelection';
import { HardwareSetup } from './pages/onboarding/HardwareSetup';
import { PrivacyPolicy } from './pages/legal/PrivacyPolicy';
import { TermsOfService } from './pages/legal/TermsOfService';
import { useSignOut } from './components/account/useSignOut';
import { APP_DISPLAY_NAME } from './config/appIdentity';

export function App() {
  const { user, role, loading, logout, cacheStatus, cacheEndingReason, signOutWithoutFirestore, roleLookupFailed, retryRoleLookup } = useAuth();
  // Sign-out from the role lookup's error screen, which asks before
  // discarding writes that have not uploaded, as the shells' Log Out does.
  const roleLookupSignOut = useSignOut(logout);
  const unsupportedAccountSignOut = useSignOut(logout);
  const navigate = useNavigate();
  const location = useLocation();
  const [currentClient, setCurrentClient] = useState<ClientProfile | null>(null);
  const [patientProfileError, setPatientProfileError] = useState<string | null>(null);
  const [patientProfileReload, setPatientProfileReload] = useState(0);
  const [dataIdentity, setDataIdentity] = useState('');
  const loadGeneration = useRef(0);
  const accountIdentity = `${loading ? 'loading' : 'ready'}:${user?.uid ?? 'signed-out'}:${role ?? 'no-role'}`;
  const accountIdentityRef = useRef(accountIdentity);
  accountIdentityRef.current = accountIdentity;
  const profileRoutePhase = location.pathname === '/hardware-setup' ? 'hardware-setup' : 'app';
  const profileDataIdentity = `${accountIdentity}:${profileRoutePhase}`;
  const hasCurrentData = dataIdentity === profileDataIdentity;
  const visibleCurrentClient = hasCurrentData ? currentClient : null;

  useEffect(() => {
    const generation = ++loadGeneration.current;
    let active = true;
    const isCurrent = () => active && loadGeneration.current === generation && accountIdentityRef.current === accountIdentity;
    eegEngine.individualBaselineModel = null;
    setDataIdentity(profileDataIdentity);
    setCurrentClient(null);
    setPatientProfileError(null);

    if (loading || !user) return;

    if (role === 'patient') {
      void storageEngine.getCurrentClient(user)
        .then((client) => {
          if (!isCurrent()) return;
          if (profileRoutePhase !== 'hardware-setup') {
            eegEngine.individualBaselineModel = getReusableBaselineModel(client?.individualBaselineModel);
          }
          setCurrentClient(client);
        })
        .catch((error) => {
          if (!isCurrent()) return;
          console.warn('Error loading patient profile:', error);
          setPatientProfileError(error instanceof Error ? error.message : 'Your patient profile is unavailable.');
        });
    }
    return () => {
      active = false;
      eegEngine.individualBaselineModel = null;
    };
  }, [accountIdentity, loading, patientProfileReload, profileDataIdentity, profileRoutePhase, role, user]);

  // While the cache is being cleared for an account change, nothing of any
  // account is shown, only what is happening. `ending` replaces the account's
  // screens before the page navigates away, so a page kept by the browser's
  // back/forward cache holds none of its data either.
  // A sign-out started from the role lookup's error screen keeps that screen,
  // and its unsynced-writes question, until the user has answered: a lookup
  // that succeeds meanwhile (one in flight, or the automatic retry) must not
  // close it. Once signing out proceeds, the app loads afresh.
  const roleLookupSignOutPending = roleLookupSignOut.phase === 'checking' || roleLookupSignOut.phase === 'unsynced';
  if (loading || cacheStatus === 'ending' || roleLookupSignOutPending) {
    const waiting = cacheStatus === 'blocked' || cacheStatus === 'failed';
    // The signed-in account's role is unknown (not "no role"): it stays here,
    // never on role selection, until a read establishes it.
    const roleUnavailable = Boolean(user) && (roleLookupFailed || roleLookupSignOutPending) && !waiting && cacheStatus !== 'ending';
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
          : roleUnavailable ? {
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
        {roleUnavailable && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {/* Not while sign-out runs or asks about unsynced writes: a lookup that succeeds would close that step. */}
            <button type="button" className="btn btn-primary" disabled={roleLookupSignOut.busy || roleLookupSignOut.phase === 'unsynced'} onClick={retryRoleLookup}>Try again</button>
            <button type="button" className="btn btn-secondary" disabled={roleLookupSignOut.busy} onClick={roleLookupSignOut.requestSignOut}>Sign out</button>
          </div>
        )}
        {roleUnavailable && roleLookupSignOut.dialog}
      </div>
    );
  }

  const handleUpdateClient = async (updated: ClientProfile) => {
    const requestIdentity = accountIdentity;
    await storageEngine.saveClient(updated);
    if (accountIdentityRef.current !== requestIdentity) return;
    if (visibleCurrentClient && visibleCurrentClient.id === updated.id) setCurrentClient(updated);
  };

  const handleClientPersistedElsewhere = (updated: ClientProfile) => {
    if (accountIdentityRef.current !== accountIdentity) return;
    if (visibleCurrentClient?.id === updated.id) setCurrentClient(updated);
  };

  const handleBaselinePersisted = (patientId: string, model: ClientProfile['individualBaselineModel']) => {
    if (accountIdentityRef.current !== accountIdentity || !model) return;
    setCurrentClient((current) => current?.id === patientId ? { ...current, individualBaselineModel: model } : current);
  };

  const renderPrimaryApp = () => {
    if (!role) return <Navigate to="/role-selection" replace />;
    if (role === 'patient') {
      if (!visibleCurrentClient) {
        if (patientProfileError) {
          return (
            <div role="alert" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', padding: '24px', textAlign: 'center', background: 'var(--surface-patient-base, #F8F7F4)', color: 'var(--text-secondary)' }}>
              <BrandLogo size={56} variant="terracotta" />
              <strong style={{ color: 'var(--text-primary)' }}>Your patient profile could not be loaded.</strong>
              <span>{patientProfileError}</span>
              <button type="button" className="btn btn-primary" onClick={() => setPatientProfileReload((value) => value + 1)}>Retry</button>
            </div>
          );
        }
        return (
          <div role="status" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', background: 'var(--surface-patient-base, #F8F7F4)', color: 'var(--text-secondary)' }}>
            <BrandLogo size={56} variant="terracotta" glow />
            <span>Preparing your patient profile…</span>
          </div>
        );
      }
      return (
        <PatientShell
          client={visibleCurrentClient}
          onUpdateClient={handleUpdateClient}
          onClientPersistedElsewhere={handleClientPersistedElsewhere}
          onBaselinePersisted={handleBaselinePersisted}
          onRecalibrate={() => navigate('/hardware-setup')}
        />
      );
    }
    // Practitioner accounts are retired: the clinician workspace is gone, and
    // the account's role is left as it is until the consumer profile replaces it.
    return (
      <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', padding: '24px', textAlign: 'center', background: 'var(--surface-patient-base, #F8F7F4)', color: 'var(--text-secondary)' }}>
        <BrandLogo size={56} variant="terracotta" />
        <h1 style={{ fontSize: '20px', color: 'var(--text-primary)', margin: 0 }}>Practitioner accounts aren’t supported</h1>
        <p style={{ maxWidth: '360px', margin: 0 }}>{APP_DISPLAY_NAME} is for personal brain training. Sign out, then create a new account to train.</p>
        <button type="button" className="btn btn-primary" disabled={unsupportedAccountSignOut.busy} onClick={unsupportedAccountSignOut.requestSignOut}>Sign out</button>
        {unsupportedAccountSignOut.dialog}
      </main>
    );
  };

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
          <Route path="/role-selection" element={<RoleSelection />} />
          <Route path="/hardware-setup" element={<HardwareSetup key={accountIdentity} />} />
          
          <Route path="/" element={renderPrimaryApp()} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      )}
    </Routes>
  );
}

export default App;
