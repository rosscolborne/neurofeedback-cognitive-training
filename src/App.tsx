import React, { useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ClientProfile, ClinicBrandConfig, PatientInvitation, QEEGBrainMap } from './types';
import { storageEngine } from './services/storageEngine';
import { applyBrandToDOM, BRAND_PRESETS } from './services/brandEngine';
import { clinicSettingsRepository } from './services/clinicSettingsRepository';
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

function InvitationEntryRedirect() {
  const { invitationCode } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (invitationCode) {
      window.sessionStorage.setItem('waveable_pending_invitation', invitationCode.toUpperCase());
    }
    navigate('/welcome', { replace: true });
  }, [invitationCode, navigate]);

  return null;
}

export function App() {
  const { user, role, loading, logout, isDemoWorkspace } = useAuth();
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
  const [showRebrandModal, setShowRebrandModal] = useState(false);
  const [dataIdentity, setDataIdentity] = useState('');
  const loadGeneration = useRef(0);
  const brandGeneration = useRef(0);
  const accountIdentity = `${loading ? 'loading' : 'ready'}:${isDemoWorkspace ? 'demo' : 'production'}:${user?.uid ?? 'signed-out'}:${role ?? 'no-role'}`;
  const hasCurrentData = dataIdentity === accountIdentity;
  const visibleClients = hasCurrentData ? clients : [];
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

  useEffect(() => {
    const generation = ++loadGeneration.current;
    const isCurrent = () => loadGeneration.current === generation;
    setDataIdentity(accountIdentity);
    setClients([]);
    setCurrentClient(null);
    setPatientInvitations([]);
    setShowRebrandModal(false);

    if (loading || !user) return;

    if (role === 'patient') {
      void storageEngine.getCurrentClient(user)
        .then((client) => { if (isCurrent()) setCurrentClient(client); })
        .catch((error) => { if (isCurrent()) console.warn('Error loading patient profile:', error); });
    } else if (role === 'clinician') {
      void storageEngine.getClients()
        .then((nextClients) => { if (isCurrent()) setClients(nextClients); })
        .catch((error) => { if (isCurrent()) console.warn('Error loading clinician roster:', error); });
      void storageEngine.getPatientInvitationsForClinician()
        .then((invitations) => { if (isCurrent()) setPatientInvitations(invitations); })
        .catch((error) => { if (isCurrent()) console.warn('Error loading patient invitations:', error); });
    }
  }, [accountIdentity, isDemoWorkspace, loading, role, user]);

  useEffect(() => {
    const generation = ++brandGeneration.current;
    const isCurrent = () => brandGeneration.current === generation;
    setBrand(BRAND_PRESETS[0]);
    setClinicId(null);
    setClinicIdentity(accountIdentity);

    if (loading || !user) return;
    if (isDemoWorkspace) {
      setBrand(storageEngine.getBrandConfig());
      return;
    }

    if (role === 'clinician') {
      void clinicSettingsRepository.load()
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

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-patient-base, #F8F7F4)' }}>
        <BrandLogo size={72} variant="terracotta" glow />
      </div>
    );
  }

  const handleUpdateClient = async (updated: ClientProfile) => {
    if (visibleCurrentClient && visibleCurrentClient.id === updated.id) {
      setCurrentClient(updated);
    }
    const next = visibleClients.map(c => (c.id === updated.id ? updated : c));
    setClients(next);
    await storageEngine.saveClient(updated);
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
    if (!newClient.email?.trim()) throw new Error('Patient email is required');
    if (!visibleClinicId) throw new Error('Complete clinic setup before inviting a patient');
    const invitation = await storageEngine.createPatientInvitation({
      clinicId: visibleClinicId,
      clinicianName: user?.displayName || user?.email || 'Clinician',
      patientEmail: newClient.email,
      patientName: newClient.name || '',
      condition: newClient.condition || 'Peak Performance',
      assignedProtocol: newClient.assignedProtocol || 'theta-beta-ratio',
      prescribedSessionsPerWeek: newClient.prescribedSessionsPerWeek || 4,
      notes: newClient.notes,
    });
    setPatientInvitations((current) => [invitation, ...current]);
    return invitation;
  };

  const handleCancelPatientInvitation = async (invitationId: string) => {
    await storageEngine.cancelPatientInvitation(invitationId);
    setPatientInvitations((current) =>
      current.map((invitation) =>
        invitation.id === invitationId ? { ...invitation, status: 'cancelled' } : invitation
      )
    );
  };

  const handleSaveBrand = (newBrand: ClinicBrandConfig) => {
    setBrand(newBrand);
    applyBrandToDOM(newBrand);
  };

  const invitationCode = routeInvitationCode?.toUpperCase() || storedInvitationCode;

  const renderPrimaryApp = () => {
    if (!role) return <Navigate to="/role-selection" replace />;
    if (role === 'patient') {
      if (!visibleCurrentClient) {
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
          onInvitationAccepted={() => window.sessionStorage.removeItem('waveable_pending_invitation')}
          onUpdateClient={handleUpdateClient}
          onOpenRebrand={() => setShowRebrandModal(true)}
        />
      );
    }
    return (
      <ClinicianShell
        brand={visibleBrand}
        clinicianLabel={user?.displayName || user?.email || undefined}
        isDemoWorkspace={isDemoWorkspace}
        clients={visibleClients}
        patientInvitations={visibleInvitations}
        onUpdateClient={handleUpdateClient}
        onAppendBrainMap={handleAppendBrainMap}
        onDeleteClient={handleDeleteClient}
        onAddClient={handleAddClient}
        onCancelPatientInvitation={handleCancelPatientInvitation}
        onOpenRebrand={() => setShowRebrandModal(true)}
        onLogout={logout}
      />
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
            <Route path="/connect/:invitationCode" element={<InvitationEntryRedirect />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <>
            <Route path="/welcome" element={<Welcome />} />
            <Route path="/role-selection" element={<RoleSelection />} />
            <Route path="/hardware-setup" element={<HardwareSetup />} />
            
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
