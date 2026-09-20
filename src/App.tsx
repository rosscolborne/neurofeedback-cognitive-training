import React, { useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ClientProfile, ClinicBrandConfig, MessageThread, CalendarAppointment, PatientInvitation, QEEGBrainMap } from './types';
import { storageEngine } from './services/storageEngine';
import { applyBrandToDOM } from './services/brandEngine';
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
  
  const [brand, setBrand] = useState<ClinicBrandConfig>(() => storageEngine.getBrandConfig());
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [currentClient, setCurrentClient] = useState<ClientProfile | null>(null);
  const [messages, setMessages] = useState<MessageThread[]>([]);
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [patientInvitations, setPatientInvitations] = useState<PatientInvitation[]>([]);
  const [showRebrandModal, setShowRebrandModal] = useState(false);
  const [dataIdentity, setDataIdentity] = useState('');
  const loadGeneration = useRef(0);
  const accountIdentity = `${loading ? 'loading' : 'ready'}:${isDemoWorkspace ? 'demo' : 'production'}:${user?.uid ?? 'signed-out'}:${role ?? 'no-role'}`;
  const hasCurrentData = dataIdentity === accountIdentity;
  const visibleClients = hasCurrentData ? clients : [];
  const visibleCurrentClient = hasCurrentData ? currentClient : null;
  const visibleMessages = hasCurrentData ? messages : [];
  const visibleAppointments = hasCurrentData ? appointments : [];
  const visibleInvitations = hasCurrentData ? patientInvitations : [];
  const visibleBrand = hasCurrentData ? brand : storageEngine.getBrandConfig();

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
    setMessages([]);
    setAppointments([]);
    setPatientInvitations([]);
    setShowRebrandModal(false);
    setBrand(storageEngine.getBrandConfig());

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

    void storageEngine.getAppointments()
      .then((nextAppointments) => { if (isCurrent()) setAppointments(nextAppointments); })
      .catch((error) => { if (isCurrent()) console.warn('Error loading appointments:', error); });
  }, [accountIdentity, isDemoWorkspace, loading, role, user]);

  useEffect(() => {
    if (!loading && user) {
      const generation = loadGeneration.current;
      const unsubscribe = storageEngine.subscribeToMessages((threads) => {
        if (loadGeneration.current === generation) setMessages(threads);
      }, role);
      return unsubscribe;
    }
  }, [accountIdentity, loading, role, user]);

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
    const invitation = await storageEngine.createPatientInvitation({
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

  const handleSendMessage = async (clientId: string, text: string) => {
    if (!text.trim()) return;

    let targetThread = visibleMessages.find(t => t.clientId === clientId);
    let updatedThread: MessageThread;

    if (targetThread) {
      updatedThread = {
        ...targetThread,
        clinicianId: user?.uid,
        messages: [
          ...targetThread.messages,
          {
            id: 'msg-' + Date.now(),
            sender: 'clinician',
            text,
            timestamp: 'Just now',
            isRead: true,
          },
        ],
        lastMessageTime: 'Just now',
      };
    } else {
      const client = visibleClients.find(c => c.id === clientId);
      updatedThread = {
        clientId,
        patientId: clientId,
        clinicianId: user?.uid,
        clientName: client ? client.name : 'Patient',
        clientAvatar: client?.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
        lastMessageTime: 'Just now',
        unreadCount: 0,
        messages: [
          {
            id: 'msg-' + Date.now(),
            sender: 'clinician',
            text,
            timestamp: 'Just now',
            isRead: true,
          },
        ],
      };
    }

    const nextThreads = targetThread
      ? visibleMessages.map(t => (t.clientId === clientId ? updatedThread : t))
      : [updatedThread, ...visibleMessages];

    setMessages(nextThreads);
    await storageEngine.saveMessageThread(updatedThread);
  };

  const handleSaveAppointment = async (appt: CalendarAppointment) => {
    const apptWithUser = {
      ...appt,
      clinicianId: user?.uid || appt.clinicianId,
    };
    const next = visibleAppointments.some(a => a.id === appt.id)
      ? visibleAppointments.map(a => a.id === appt.id ? apptWithUser : a)
      : [apptWithUser, ...visibleAppointments];
    setAppointments(next);
    await storageEngine.saveAppointment(apptWithUser);
  };

  const handleDeleteAppointment = async (id: string) => {
    const next = visibleAppointments.filter(a => a.id !== id);
    setAppointments(next);
    await storageEngine.deleteAppointment(id);
  };

  const handleSaveBrand = (newBrand: ClinicBrandConfig) => {
    setBrand(newBrand);
    storageEngine.saveBrandConfig(newBrand);
    applyBrandToDOM(newBrand);
  };

  const invitationCode = routeInvitationCode?.toUpperCase() || storedInvitationCode;

  const renderPrimaryApp = () => {
    if (!role) return <Navigate to="/role-selection" replace />;
    if (role === 'patient') {
      return (
        <PatientShell
          brand={visibleBrand}
          client={visibleCurrentClient || {
            id: user?.uid || 'patient',
            name: user?.displayName || 'Patient',
            email: user?.email || 'patient@waveable.app',
            avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
            condition: 'Peak Performance',
            status: 'active',
            assignedProtocol: 'theta-beta-ratio',
            brainMaps: [],
            allowedExperiences: ['immersive-3d', 'generative-music', 'narrative-story', 'skyline-drift', 'tidal-garden', 'breath-weave', 'signal-sort', 'rhythm-lock', 'media-mode', 'soundscape-mode', 'mandala', 'eeg-mandala', 'neuro-gambit'],
            prescribedSessionsPerWeek: 4,
            completedSessionsCount: 0,
            currentStreak: 0,
            streakFreezeRemaining: 1,
            brainCapacityScore: 60,
            lastSessionDate: 'Just Enrolled',
            nextSessionDate: 'Ready to schedule',
            tidalGardenState: { stage: 1, plantsUnlocked: ['amber-coral'], growthPoints: 0, lastWatered: new Date().toISOString().split('T')[0] },
            skylineBiomesUnlocked: ['Alpine Meadows'],
            badges: ['first-light'],
          }}
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
        messages={visibleMessages}
        appointments={visibleAppointments}
        onUpdateClient={handleUpdateClient}
        onAppendBrainMap={handleAppendBrainMap}
        onDeleteClient={handleDeleteClient}
        onAddClient={handleAddClient}
        onCancelPatientInvitation={handleCancelPatientInvitation}
        onSendMessage={handleSendMessage}
        onSaveAppointment={handleSaveAppointment}
        onDeleteAppointment={handleDeleteAppointment}
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
