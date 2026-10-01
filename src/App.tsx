import React, { useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ClientProfile, ClinicBrandConfig, PatientInvitation, QEEGBrainMap } from './types';
import { storageEngine } from './services/storageEngine';
import { eegEngine } from './services/eegEngine';
import { getReusableBaselineModel } from './services/dataMappers';
import { applyBrandToDOM, BRAND_PRESETS } from './services/brandEngine';
import { clinicSettingsRepository } from './services/clinicSettingsRepository';
import type { ClinicSettingsSnapshot } from './services/clinicSettingsRepository';
import { PatientShell } from './components/patient/PatientShell';
import { ClinicianShell } from './components/clinician/ClinicianShell';
import { ClinicCustomizerModal } from './components/brand/ClinicCustomizerModal';
import { BrandLogo } from './components/brand/BrandLogo';

import { useAuth } from './contexts/AuthContext';
import { Welcome } from './pages/onboarding/Welcome';
import { SignUp } from './pages/onboarding/SignUp';
import { Login } from './pages/onboarding/Login';
import { RoleSelection } from './pages/onboarding/RoleSelection';
import { HardwareSetup } from './pages/onboarding/HardwareSetup';
import { PrivacyPolicy } from './pages/legal/PrivacyPolicy';
import { TermsOfService } from './pages/legal/TermsOfService';
import { clearPendingInvitation } from './services/pendingInvitation';

function InvitationEntryRedirect({ signedInUidRef }: { signedInUidRef: React.RefObject<string | null> }) {
  const { invitationCode } = useParams();
  const navigate = useNavigate();
  const retainInvitation = useRef<boolean | null>(null);

  useEffect(() => {
    // Decided on first run, before App records the sign-out: an account that just
    // signed out while a /connect URL was still open is not opening a new invitation.
    retainInvitation.current ??= signedInUidRef.current === null;
    if (invitationCode && retainInvitation.current) {
      window.sessionStorage.setItem('waveable_pending_invitation', invitationCode.toUpperCase());
    }
    navigate('/welcome', { replace: true });
  }, [invitationCode, navigate, signedInUidRef]);

  return null;
}

export function App() {
  const { user, role, loading, logout, isDemoWorkspace, cacheStatus, cacheEndingReason, signOutWithoutFirestore } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const routeInvitationCode = location.pathname.match(/^\/connect\/([^/]+)$/i)?.[1];
  const storedInvitationCode = typeof window === 'undefined'
    ? undefined
    : window.sessionStorage.getItem('waveable_pending_invitation') || undefined;
  
  const [brand, setBrand] = useState<ClinicBrandConfig>(() => BRAND_PRESETS[0]);
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [clinicIdentity, setClinicIdentity] = useState('');
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [currentClient, setCurrentClient] = useState<ClientProfile | null>(null);
  const [patientInvitations, setPatientInvitations] = useState<PatientInvitation[]>([]);
  const [patientProfileError, setPatientProfileError] = useState<string | null>(null);
  const [patientProfileReload, setPatientProfileReload] = useState(0);
  const [clinicianRosterError, setClinicianRosterError] = useState<string | null>(null);
  const [clinicianRosterLoad, setClinicianRosterLoad] = useState<{ key: string; status: 'loading' | 'ready' | 'error' }>({ key: '', status: 'loading' });
  const [clinicianInvitationsError, setClinicianInvitationsError] = useState<string | null>(null);
  const [clinicianRosterReload, setClinicianRosterReload] = useState(0);
  const [showRebrandModal, setShowRebrandModal] = useState(false);
  const [dataIdentity, setDataIdentity] = useState('');
  const loadGeneration = useRef(0);
  const brandGeneration = useRef(0);
  // The signed-in clinician's clinic, while its settings are still loading.
  const pendingClinicLoad = useRef<{ identity: string; clinicId: Promise<string | null> } | null>(null);
  const accountIdentity = `${loading ? 'loading' : 'ready'}:${isDemoWorkspace ? 'demo' : 'production'}:${user?.uid ?? 'signed-out'}:${role ?? 'no-role'}`;
  const accountIdentityRef = useRef(accountIdentity);
  accountIdentityRef.current = accountIdentity;
  const profileRoutePhase = location.pathname === '/hardware-setup' ? 'hardware-setup' : 'app';
  const profileDataIdentity = `${accountIdentity}:${profileRoutePhase}`;
  const clinicianRosterLoadKey = `${profileDataIdentity}:${clinicianRosterReload}`;
  const hasCurrentData = dataIdentity === profileDataIdentity;
  const visibleClients = hasCurrentData ? clients : [];
  const visibleRosterStatus = hasCurrentData && clinicianRosterLoad.key === clinicianRosterLoadKey ? clinicianRosterLoad.status : 'loading';
  const visibleCurrentClient = hasCurrentData ? currentClient : null;
  const visibleInvitations = hasCurrentData ? patientInvitations : [];
  const visibleBrand = hasCurrentData ? brand : BRAND_PRESETS[0];
  const visibleClinicId = clinicIdentity === accountIdentity ? clinicId : null;

  useEffect(() => {
    applyBrandToDOM(visibleBrand);
  }, [visibleBrand]);

  useEffect(() => {
    if (routeInvitationCode) {
      window.sessionStorage.setItem('waveable_pending_invitation', routeInvitationCode.toUpperCase());
    }
  }, [routeInvitationCode]);

  // A pending invitation belongs to the sign-in it was opened for. When that
  // account signs out or is replaced, drop it so the next login starts clean.
  const signedInUidRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    const uid = user?.uid ?? null;
    if (signedInUidRef.current && signedInUidRef.current !== uid) clearPendingInvitation();
    signedInUidRef.current = uid;
  }, [loading, user?.uid]);

  useEffect(() => {
    const generation = ++loadGeneration.current;
    let active = true;
    let stopRoster = () => {};
    let rosterRequest = 0;
    const isCurrent = () => active && loadGeneration.current === generation && accountIdentityRef.current === accountIdentity;
    eegEngine.individualBaselineModel = null;
    setDataIdentity(profileDataIdentity);
    setClients([]);
    setCurrentClient(null);
    setPatientProfileError(null);
    setClinicianRosterError(null);
    setClinicianRosterLoad({ key: clinicianRosterLoadKey, status: 'loading' });
    setClinicianInvitationsError(null);
    setPatientInvitations([]);
    setShowRebrandModal(false);

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
    } else if (role === 'clinician') {
      const loadRoster = () => {
        const request = ++rosterRequest;
        void storageEngine.getClients().then((nextClients) => {
          if (!isCurrent() || request !== rosterRequest) return;
          setClients(nextClients);
          setClinicianRosterError(null);
          setClinicianRosterLoad({ key: clinicianRosterLoadKey, status: 'ready' });
        })
        .catch((error) => {
          if (!isCurrent() || request !== rosterRequest) return;
          console.warn('Error loading clinician roster:', error);
          setClients([]);
          setClinicianRosterError(error instanceof Error ? error.message : 'The patient roster could not be loaded.');
          setClinicianRosterLoad({ key: clinicianRosterLoadKey, status: 'error' });
        });
      };
      loadRoster();
      stopRoster = storageEngine.subscribeToClientRoster(loadRoster, (error) => {
        if (!isCurrent()) return;
        ++rosterRequest;
        setClients([]);
        setClinicianRosterError(error.message);
        setClinicianRosterLoad({ key: clinicianRosterLoadKey, status: 'error' });
      });
      void storageEngine.getPatientInvitationsForClinician()
        .then((invitations) => { if (isCurrent()) setPatientInvitations(invitations); })
        .catch((error) => {
          if (!isCurrent()) return;
          console.warn('Error loading patient invitations:', error);
          setClinicianInvitationsError(error instanceof Error ? error.message : 'Pending invitations could not be loaded.');
        });
    }
    return () => {
      active = false;
      stopRoster();
      eegEngine.individualBaselineModel = null;
    };
  }, [accountIdentity, clinicianRosterLoadKey, clinicianRosterReload, isDemoWorkspace, loading, patientProfileReload, profileDataIdentity, profileRoutePhase, role, user]);

  useEffect(() => {
    const generation = ++brandGeneration.current;
    const isCurrent = () => brandGeneration.current === generation;
    setBrand(BRAND_PRESETS[0]);
    setClinicId(null);
    setClinicIdentity(accountIdentity);
    pendingClinicLoad.current = null;

    if (loading || !user) return;
    if (isDemoWorkspace) {
      setBrand(storageEngine.getBrandConfig());
      return;
    }

    if (role === 'clinician') {
      const request = clinicSettingsRepository.load();
      pendingClinicLoad.current = {
        identity: accountIdentity,
        clinicId: request.then((snapshot) => (snapshot.clinic && snapshot.practitioner ? snapshot.clinicId : null), () => null),
      };
      void request
        .then((snapshot) => {
          if (!isCurrent()) return;
          setClinicId(snapshot.clinic && snapshot.practitioner ? snapshot.clinicId : null);
          setBrand(snapshot.brand ?? BRAND_PRESETS[0]);
        })
        .catch((error) => {
          if (isCurrent()) console.warn('Error loading clinic branding:', error);
        });
      return;
    }

    if (role === 'patient' && visibleCurrentClient?.clinicId) {
      void storageEngine.getClinicBrandConfig(visibleCurrentClient.clinicId)
        .then((nextBrand) => { if (isCurrent()) setBrand(nextBrand); })
        .catch((error) => {
          if (isCurrent()) console.warn('Error loading patient clinic branding:', error);
        });
    }
  }, [accountIdentity, isDemoWorkspace, loading, role, user, visibleCurrentClient?.clinicId]);

  // While the cache is being cleared for an account change, nothing of any
  // account is shown, only what is happening. `ending` replaces the account's
  // screens before the page navigates away, so a page kept by the browser's
  // back/forward cache holds none of its data either.
  if (loading || cacheStatus === 'ending') {
    const waiting = cacheStatus === 'blocked' || cacheStatus === 'failed';
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
      </div>
    );
  }

  const handleUpdateClient = async (updated: ClientProfile) => {
    const requestIdentity = accountIdentity;
    await storageEngine.saveClient(updated);
    if (accountIdentityRef.current !== requestIdentity) return;
    if (visibleCurrentClient && visibleCurrentClient.id === updated.id) setCurrentClient(updated);
    setClients((current) => current.map(c => (c.id === updated.id ? updated : c)));
  };

  const handleClientPersistedElsewhere = (updated: ClientProfile) => {
    if (accountIdentityRef.current !== accountIdentity) return;
    if (visibleCurrentClient?.id === updated.id) setCurrentClient(updated);
    setClients((current) => current.map((client) => client.id === updated.id ? updated : client));
  };

  const handleBaselinePersisted = (patientId: string, model: ClientProfile['individualBaselineModel']) => {
    if (accountIdentityRef.current !== accountIdentity || !model) return;
    setCurrentClient((current) => current?.id === patientId ? { ...current, individualBaselineModel: model } : current);
  };

  const handleAppendBrainMap = async (patientId: string, map: QEEGBrainMap) =>
    storageEngine.appendBrainMap(patientId, map);

  const handleDeleteClient = async (clientId: string) => {
    if (isDemoWorkspace) {
      await storageEngine.deleteClient(clientId);
    } else {
      await storageEngine.unlinkPatient(clientId);
    }
    setClients((current) => current.filter((client) => client.id !== clientId));
  };

  const handleAddClient = async (newClient: Partial<ClientProfile>): Promise<PatientInvitation> => {
    const requestIdentity = accountIdentity;
    if (!newClient.email?.trim()) throw new Error('Patient email is required');
    // The clinic settings load after sign-in. An invitation sent before they
    // arrive waits for them instead of reporting a missing clinic.
    const pending = pendingClinicLoad.current;
    const clinicForInvitation = visibleClinicId
      ?? (pending?.identity === requestIdentity ? await pending.clinicId : null);
    if (accountIdentityRef.current !== requestIdentity) throw new Error('The signed-in account changed. Try again.');
    if (!clinicForInvitation) throw new Error('Complete clinic setup before inviting a patient');
    if (!newClient.condition || !newClient.assignedProtocol || newClient.prescribedSessionsPerWeek == null) {
      throw new Error('Select a clinical indication, protocol, and weekly target before inviting a patient');
    }
    const invitation = await storageEngine.createPatientInvitation({
      clinicId: clinicForInvitation,
      clinicianName: user?.displayName || user?.email || 'Clinician',
      patientEmail: newClient.email,
      patientName: newClient.name || '',
      condition: newClient.condition,
      assignedProtocol: newClient.assignedProtocol,
      prescribedSessionsPerWeek: newClient.prescribedSessionsPerWeek,
      notes: newClient.notes,
    });
    if (accountIdentityRef.current === requestIdentity) {
      setPatientInvitations((current) => [invitation, ...current]);
    }
    return invitation;
  };

  const handleCancelPatientInvitation = async (invitationId: string) => {
    const requestIdentity = accountIdentity;
    await storageEngine.cancelPatientInvitation(invitationId);
    if (accountIdentityRef.current !== requestIdentity) return;
    setPatientInvitations((current) =>
      current.map((invitation) =>
        invitation.id === invitationId ? { ...invitation, status: 'cancelled' } : invitation
      )
    );
  };

  const handleSaveBrand = (newBrand: ClinicBrandConfig) => {
    if (accountIdentityRef.current !== accountIdentity) return;
    setBrand(newBrand);
    applyBrandToDOM(newBrand);
  };

  const handleClinicSettingsSaved = (snapshot: ClinicSettingsSnapshot) => {
    if (accountIdentityRef.current !== accountIdentity) return;
    setClinicId(snapshot.clinic && snapshot.practitioner ? snapshot.clinicId : null);
    setBrand(snapshot.brand ?? BRAND_PRESETS[0]);
  };

  const invitationCode = routeInvitationCode?.toUpperCase() || storedInvitationCode;

  const renderPrimaryApp = () => {
    if (!role) return <Navigate to="/role-selection" replace />;
    if (role === 'clinician' && invitationCode) {
      return (
        <main style={{ minHeight: '100dvh', display: 'grid', placeContent: 'center', gap: '16px', padding: '24px', textAlign: 'center' }}>
          <h1>Patient invitation</h1>
          <p>This invitation is for a patient account. Sign in with the invited patient email address to accept it.</p>
          <button type="button" className="btn btn-primary" onClick={() => {
            window.sessionStorage.removeItem('waveable_pending_invitation');
            navigate('/');
          }}>Return to clinician dashboard</button>
        </main>
      );
    }
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
          brand={visibleBrand}
          client={visibleCurrentClient}
          initialInvitationCode={invitationCode}
          invitationRouteCode={routeInvitationCode}
          onInvitationAccepted={() => {
            window.sessionStorage.removeItem('waveable_pending_invitation');
            navigate('/', { replace: true });
          }}
          onInvitationDismissed={() => {
            window.sessionStorage.removeItem('waveable_pending_invitation');
            navigate('/', { replace: true });
          }}
          onUpdateClient={handleUpdateClient}
          onClientPersistedElsewhere={handleClientPersistedElsewhere}
          onBaselinePersisted={handleBaselinePersisted}
          onRecalibrate={() => navigate('/hardware-setup')}
          onOpenRebrand={() => setShowRebrandModal(true)}
        />
      );
    }
    return (
      <>
      {clinicianRosterError && <div role="alert" style={{ padding: '10px 16px', background: 'var(--status-alert-bg)', color: 'var(--status-alert)', display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}><span>Patient roster unavailable: {clinicianRosterError}</span><button type="button" className="btn btn-ghost" onClick={() => setClinicianRosterReload((value) => value + 1)}>Retry</button></div>}
      {clinicianInvitationsError && <div role="alert" style={{ padding: '10px 16px', background: 'var(--status-alert-bg)', color: 'var(--status-alert)', display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}><span>Pending invitations unavailable: {clinicianInvitationsError}</span><button type="button" className="btn btn-ghost" onClick={() => setClinicianRosterReload((value) => value + 1)}>Retry</button></div>}
      <ClinicianShell
        brand={visibleBrand}
        clinicianLabel={user?.displayName || user?.email || undefined}
        isDemoWorkspace={isDemoWorkspace}
        clients={visibleClients}
        rosterStatus={visibleRosterStatus}
        patientInvitations={visibleInvitations}
        onUpdateClient={handleUpdateClient}
        onAppendBrainMap={handleAppendBrainMap}
        onDeleteClient={handleDeleteClient}
        onAddClient={handleAddClient}
        onCancelPatientInvitation={handleCancelPatientInvitation}
        onClinicSettingsSaved={handleClinicSettingsSaved}
        onOpenRebrand={() => setShowRebrandModal(true)}
        onLogout={logout}
      />
      </>
    );
  };

  return (
    <>
      <Routes>
        <Route path="/legal/privacy" element={<PrivacyPolicy />} />
        <Route path="/legal/terms" element={<TermsOfService />} />

        {!user ? (
          <>
            <Route path="/" element={<Welcome />} />
            <Route path="/welcome" element={<Welcome />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/login" element={<Login />} />
            <Route path="/connect/:invitationCode" element={<InvitationEntryRedirect signedInUidRef={signedInUidRef} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <>
            <Route path="/welcome" element={<Welcome />} />
            <Route path="/role-selection" element={<RoleSelection />} />
            <Route path="/hardware-setup" element={<HardwareSetup key={accountIdentity} />} />
            
            <Route path="/" element={renderPrimaryApp()} />
            <Route path="/connect/:invitationCode" element={renderPrimaryApp()} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>

      {showRebrandModal && (
        <ClinicCustomizerModal
          currentBrand={visibleBrand}
          onSave={handleSaveBrand}
          onClose={() => setShowRebrandModal(false)}
        />
      )}
    </>
  );
}

export default App;
