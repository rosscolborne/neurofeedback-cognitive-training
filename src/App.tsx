import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ClientProfile, ClinicBrandConfig, MessageThread, CalendarAppointment } from './types';
import { storageEngine } from './services/storageEngine';
import { applyBrandToDOM } from './services/brandEngine';
import { PatientShell } from './components/patient/PatientShell';
import { ClinicianShell } from './components/clinician/ClinicianShell';
import { ClinicCustomizerModal } from './components/brand/ClinicCustomizerModal';

import { useAuth } from './contexts/AuthContext';
import { Welcome } from './pages/onboarding/Welcome';
import { SignUp } from './pages/onboarding/SignUp';
import { Login } from './pages/onboarding/Login';
import { VerifyEmail } from './pages/onboarding/VerifyEmail';
import { RoleSelection } from './pages/onboarding/RoleSelection';
import { HardwareSetup } from './pages/onboarding/HardwareSetup';
import { PrivacyPolicy } from './pages/legal/PrivacyPolicy';
import { TermsOfService } from './pages/legal/TermsOfService';

export function App() {
  const { user, role, loading } = useAuth();
  
  const [brand, setBrand] = useState<ClinicBrandConfig>(() => storageEngine.getBrandConfig());
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [currentClient, setCurrentClient] = useState<ClientProfile | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [messages, setMessages] = useState<MessageThread[]>([]);
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [showRebrandModal, setShowRebrandModal] = useState(false);

  useEffect(() => {
    applyBrandToDOM(brand);
  }, [brand]);

  useEffect(() => {
    let isMounted = true;
    async function loadClientData() {
      setDataLoading(true);
      try {
        if (role === 'patient' && user) {
          const client = await storageEngine.getCurrentClient(user);
          if (isMounted) setCurrentClient(client);
        } else if (role === 'clinician') {
          const cls = await storageEngine.getClients();
          if (isMounted) setClients(cls);
        } else {
          const defaultClient = await storageEngine.getCurrentClient(user);
          const cls = await storageEngine.getClients();
          if (isMounted) {
            setCurrentClient(defaultClient);
            setClients(cls);
          }
        }
        const appts = await storageEngine.getAppointments();
        if (isMounted) setAppointments(appts);
      } catch (err) {
        console.warn('Error loading client data:', err);
      } finally {
        if (isMounted) setDataLoading(false);
      }
    }

    if (!loading) {
      loadClientData();
    }

    return () => {
      isMounted = false;
    };
  }, [user, role, loading]);

  useEffect(() => {
    if (!loading) {
      const unsubscribe = storageEngine.subscribeToMessages((threads) => {
        setMessages(threads);
      });
      return unsubscribe;
    }
  }, [user, role, loading]);

  if (loading || (user && role && dataLoading)) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-patient-base)', color: 'var(--text-primary)' }}>Loading Brainswell...</div>;
  }

  const handleUpdateClient = async (updated: ClientProfile) => {
    if (currentClient && currentClient.id === updated.id) {
      setCurrentClient(updated);
    }
    const next = clients.map(c => (c.id === updated.id ? updated : c));
    setClients(next);
    await storageEngine.saveClient(updated);
  };

  const handleDeleteClient = async (clientId: string) => {
    const next = clients.filter(c => c.id !== clientId);
    setClients(next);
    await storageEngine.deleteClient(clientId);
  };

  const handleAddClient = async (newClient: Partial<ClientProfile>) => {
    const fullClient: ClientProfile = {
      id: 'client-' + Date.now(),
      clinicianId: user?.uid,
      patientId: 'client-' + Date.now(),
      name: newClient.name || 'New Patient',
      email: (newClient.name?.toLowerCase().replace(/\s+/g, '.') || 'patient') + '@example.com',
      avatarUrl: `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80`,
      condition: newClient.condition || 'ADHD (Inattentive)',
      status: 'active',
      assignedProtocol: newClient.assignedProtocol || 'theta-beta-ratio',
      brainMaps: [],
      allowedExperiences: ['immersive-3d', 'spatial-audio', 'narrative-story', 'skyline-drift', 'signal-sort', 'media-mode', 'rhythm-lock', 'mandala'],
      prescribedSessionsPerWeek: 4,
      completedSessionsCount: 0,
      currentStreak: 0,
      streakFreezeRemaining: 1,
      brainCapacityScore: 60,
      lastSessionDate: 'Just Enrolled',
      nextSessionDate: 'Ready to schedule',
      isDemo: false,
      notes: newClient.notes || '',
      tidalGardenState: {
        stage: 1,
        plantsUnlocked: ['amber-coral'],
        growthPoints: 0,
        lastWatered: new Date().toISOString().split('T')[0],
      },
      skylineBiomesUnlocked: ['Alpine Meadows'],
      badges: ['first-light'],
    };

    const next = [fullClient, ...clients];
    setClients(next);
    await storageEngine.saveClient(fullClient);

    // Auto-create a welcome thread for this patient
    const newThread: MessageThread = {
      clientId: fullClient.id,
      patientId: fullClient.id,
      clinicianId: user?.uid,
      clientName: fullClient.name,
      clientAvatar: fullClient.avatarUrl,
      lastMessageTime: 'Just now',
      unreadCount: 0,
      isDemo: false,
      messages: [
        {
          id: 'welcome-' + Date.now(),
          sender: 'clinician',
          text: `Welcome ${fullClient.name}! Your clinical neurofeedback profile has been initialized with the ${fullClient.assignedProtocol.replace(/-/g, ' ')} protocol for your Muse S (Athena) headset.`,
          timestamp: 'Just now',
          isRead: true,
        },
      ],
    };
    const nextThreads = [newThread, ...messages];
    setMessages(nextThreads);
    await storageEngine.saveMessageThread(newThread);
  };

  const handleSendMessage = async (clientId: string, text: string) => {
    if (!text.trim()) return;

    let targetThread = messages.find(t => t.clientId === clientId);
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
      const client = clients.find(c => c.id === clientId);
      updatedThread = {
        clientId,
        patientId: clientId,
        clinicianId: user?.uid,
        clientName: client ? client.name : 'Patient',
        clientAvatar: client?.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
        lastMessageTime: 'Just now',
        unreadCount: 0,
        isDemo: client?.isDemo || false,
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
      ? messages.map(t => (t.clientId === clientId ? updatedThread : t))
      : [updatedThread, ...messages];

    setMessages(nextThreads);
    await storageEngine.saveMessageThread(updatedThread);
  };

  const handleSaveAppointment = async (appt: CalendarAppointment) => {
    const apptWithUser = {
      ...appt,
      clinicianId: user?.uid || appt.clinicianId,
    };
    const next = appointments.some(a => a.id === appt.id)
      ? appointments.map(a => a.id === appt.id ? apptWithUser : a)
      : [apptWithUser, ...appointments];
    setAppointments(next);
    await storageEngine.saveAppointment(apptWithUser);
  };

  const handleDeleteAppointment = async (id: string) => {
    const next = appointments.filter(a => a.id !== id);
    setAppointments(next);
    await storageEngine.deleteAppointment(id);
  };

  const handleClearDemoData = async () => {
    storageEngine.clearDemoData();
    const cls = await storageEngine.getClients();
    setClients(cls);
    const msgs = await storageEngine.getMessages();
    setMessages(msgs);
    const appts = await storageEngine.getAppointments();
    setAppointments(appts);
  };

  const handleResetDemoData = async () => {
    storageEngine.resetToDefaultSeed();
    const cls = await storageEngine.getClients();
    setClients(cls);
    const msgs = await storageEngine.getMessages();
    setMessages(msgs);
    const appts = await storageEngine.getAppointments();
    setAppointments(appts);
  };

  const handleSaveBrand = (newBrand: ClinicBrandConfig) => {
    setBrand(newBrand);
    storageEngine.saveBrandConfig(newBrand);
    applyBrandToDOM(newBrand);
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : !user.emailVerified ? (
          <>
            <Route path="/welcome" element={<Welcome />} />
            <Route path="*" element={<VerifyEmail />} />
          </>
        ) : (
          <>
            <Route path="/welcome" element={<Welcome />} />
            <Route path="/role-selection" element={<RoleSelection />} />
            <Route path="/hardware-setup" element={<HardwareSetup />} />
            
            <Route path="/" element={
              !role ? <Navigate to="/role-selection" replace /> :
              role === 'patient' ? (
                <PatientShell
                  brand={brand}
                  client={currentClient || {
                    id: user?.uid || 'patient',
                    name: user?.displayName || 'Patient',
                    email: user?.email || 'patient@brainswell.app',
                    avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
                    condition: 'Peak Performance',
                    status: 'active',
                    assignedProtocol: 'theta-beta-ratio',
                    brainMaps: [],
                    allowedExperiences: ['immersive-3d', 'spatial-audio', 'narrative-story', 'skyline-drift', 'tidal-garden', 'breath-weave', 'signal-sort', 'rhythm-lock', 'media-mode', 'soundscape-mode', 'mandala'],
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
                  onUpdateClient={handleUpdateClient}
                  onOpenRebrand={() => setShowRebrandModal(true)}
                />
              ) : (
                <ClinicianShell
                  brand={brand}
                  clients={clients}
                  messages={messages}
                  appointments={appointments}
                  onUpdateClient={handleUpdateClient}
                  onDeleteClient={handleDeleteClient}
                  onAddClient={handleAddClient}
                  onSendMessage={handleSendMessage}
                  onSaveAppointment={handleSaveAppointment}
                  onDeleteAppointment={handleDeleteAppointment}
                  onClearDemoData={handleClearDemoData}
                  onResetDemoData={handleResetDemoData}
                  onOpenRebrand={() => setShowRebrandModal(true)}
                />
              )
            } />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>

      {showRebrandModal && (
        <ClinicCustomizerModal
          currentBrand={brand}
          onSave={handleSaveBrand}
          onClose={() => setShowRebrandModal(false)}
        />
      )}
    </>
  );
}

export default App;
