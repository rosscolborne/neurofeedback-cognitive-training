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
import { RoleSelection } from './pages/onboarding/RoleSelection';
import { HardwareSetup } from './pages/onboarding/HardwareSetup';
import { PrivacyPolicy } from './pages/legal/PrivacyPolicy';
import { TermsOfService } from './pages/legal/TermsOfService';

export function App() {
  const { user, role, loading } = useAuth();
  
  const [brand, setBrand] = useState<ClinicBrandConfig>(() => storageEngine.getBrandConfig());
  const [clients, setClients] = useState<ClientProfile[]>(() => storageEngine.getClients());
  const [currentClientId, setCurrentClientId] = useState<string>(() => storageEngine.getCurrentClient().id);
  const [messages, setMessages] = useState<MessageThread[]>(() => storageEngine.getMessages());
  const [appointments, setAppointments] = useState<CalendarAppointment[]>(() => storageEngine.getAppointments());
  const [showRebrandModal, setShowRebrandModal] = useState(false);

  useEffect(() => {
    applyBrandToDOM(brand);
  }, [brand]);

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-patient-base)', color: 'var(--text-primary)' }}>Loading Brainswell...</div>;
  }

  const currentClient = storageEngine.getCurrentClient(user);

  const handleUpdateClient = (updated: ClientProfile) => {
    const next = clients.map(c => (c.id === updated.id ? updated : c));
    setClients(next);
    storageEngine.saveClients(next);
  };

  const handleDeleteClient = (clientId: string) => {
    const next = clients.filter(c => c.id !== clientId);
    setClients(next);
    storageEngine.saveClients(next);
  };

  const handleAddClient = (newClient: Partial<ClientProfile>) => {
    const fullClient: ClientProfile = {
      id: 'client-' + Date.now(),
      name: newClient.name || 'New Patient',
      email: (newClient.name?.toLowerCase().replace(/\s+/g, '.') || 'patient') + '@example.com',
      avatarUrl: `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80`,
      condition: newClient.condition || 'ADHD (Inattentive)',
      status: 'active',
      assignedProtocol: newClient.assignedProtocol || 'theta-beta-ratio',
      brainMaps: [],
      allowedExperiences: ['skyline-drift', 'signal-sort', 'media-mode', 'rhythm-lock', 'mandala'],
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
    storageEngine.saveClients(next);

    // Auto-create a welcome thread for this patient
    const newThread: MessageThread = {
      clientId: fullClient.id,
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
    storageEngine.saveMessages(nextThreads);
  };

  const handleSendMessage = (clientId: string, text: string) => {
    if (!text.trim()) return;

    let targetThread = messages.find(t => t.clientId === clientId);
    let nextThreads: MessageThread[];

    if (targetThread) {
      targetThread.messages.push({
        id: 'msg-' + Date.now(),
        sender: 'clinician',
        text,
        timestamp: 'Just now',
        isRead: true,
      });
      targetThread.lastMessageTime = 'Just now';
      nextThreads = [...messages];
    } else {
      const client = clients.find(c => c.id === clientId);
      const newThread: MessageThread = {
        clientId,
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
      nextThreads = [newThread, ...messages];
    }

    setMessages(nextThreads);
    storageEngine.saveMessages(nextThreads);
  };

  const handleSaveAppointment = (appt: CalendarAppointment) => {
    storageEngine.saveAppointment(appt);
    setAppointments(storageEngine.getAppointments());
  };

  const handleDeleteAppointment = (id: string) => {
    storageEngine.deleteAppointment(id);
    setAppointments(storageEngine.getAppointments());
  };

  const handleClearDemoData = () => {
    storageEngine.clearDemoData();
    setClients(storageEngine.getClients());
    setMessages(storageEngine.getMessages());
    setAppointments(storageEngine.getAppointments());
  };

  const handleResetDemoData = () => {
    storageEngine.resetToDefaultSeed();
    setClients(storageEngine.getClients());
    setMessages(storageEngine.getMessages());
    setAppointments(storageEngine.getAppointments());
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
            <Route path="/welcome" element={<Welcome />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<Navigate to="/welcome" replace />} />
          </>
        ) : (
          <>
            <Route path="/role-selection" element={<RoleSelection />} />
            <Route path="/hardware-setup" element={<HardwareSetup />} />
            
            <Route path="/" element={
              !role ? <Navigate to="/role-selection" replace /> :
              role === 'patient' ? (
                <PatientShell
                  brand={brand}
                  client={currentClient}
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
