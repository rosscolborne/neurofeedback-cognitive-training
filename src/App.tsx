import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ClientProfile, ClinicBrandConfig, MessageThread } from './types';
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
  const [showRebrandModal, setShowRebrandModal] = useState(false);

  useEffect(() => {
    applyBrandToDOM(brand);
  }, [brand]);

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-patient-base)', color: 'var(--text-primary)' }}>Loading Brainwell...</div>;
  }

  const currentClient = storageEngine.getCurrentClient(user);

  const handleUpdateClient = (updated: ClientProfile) => {
    const next = clients.map(c => (c.id === updated.id ? updated : c));
    setClients(next);
    storageEngine.saveClients(next);
  };

  const handleAddClient = (newClient: Partial<ClientProfile>) => {
    const fullClient: ClientProfile = {
      id: 'client-' + Date.now(),
      name: newClient.name || 'New Patient',
      email: (newClient.name?.toLowerCase().replace(/\s+/g, '.') || 'patient') + '@example.com',
      avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
      condition: newClient.condition || 'ADHD (Inattentive)',
      status: 'active',
      assignedProtocol: newClient.assignedProtocol || 'theta-beta-ratio',
      brainMaps: [],
      allowedExperiences: ['skyline-drift', 'signal-sort', 'media-mode', 'rhythm-lock', 'mandala'],
      prescribedSessionsPerWeek: 4,
      completedSessionsCount: 0,
      currentStreak: 1,
      streakFreezeRemaining: 1,
      brainCapacityScore: 65,
      lastSessionDate: 'Just Enrolled',
      nextSessionDate: 'Tomorrow, 10:00 AM',
      tidalGardenState: {
        stage: 1,
        plantsUnlocked: ['amber-coral'],
        growthPoints: 50,
        lastWatered: new Date().toISOString().split('T')[0],
      },
      skylineBiomesUnlocked: ['Alpine Meadows'],
      badges: ['first-light'],
    };

    const next = [fullClient, ...clients];
    setClients(next);
    storageEngine.saveClients(next);
  };

  const handleSendMessage = (clientId: string, text: string) => {
    const thread = messages.find(t => t.clientId === clientId);
    if (thread) {
      thread.messages.push({
        id: 'msg-' + Date.now(),
        sender: 'clinician',
        text,
        timestamp: 'Just now',
        isRead: true,
      });
      thread.lastMessageTime = 'Just now';
      const next = [...messages];
      setMessages(next);
      storageEngine.saveMessages(next);
    }
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
                  onUpdateClient={handleUpdateClient}
                  onAddClient={handleAddClient}
                  onSendMessage={handleSendMessage}
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
