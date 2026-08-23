import React, { useEffect, useState } from 'react';
import { ClientProfile, ClinicBrandConfig, MessageThread } from './types';
import { storageEngine } from './services/storageEngine';
import { applyBrandToDOM } from './services/brandEngine';
import { PatientShell } from './components/patient/PatientShell';
import { ClinicianShell } from './components/clinician/ClinicianShell';
import { ClinicCustomizerModal } from './components/brand/ClinicCustomizerModal';
import { Smartphone, Monitor, Sliders, User, Brain } from 'lucide-react';

export function App() {
  const [role, setRole] = useState<'patient' | 'clinician'>('patient');
  const [brand, setBrand] = useState<ClinicBrandConfig>(() => storageEngine.getBrandConfig());
  const [clients, setClients] = useState<ClientProfile[]>(() => storageEngine.getClients());
  const [currentClientId, setCurrentClientId] = useState<string>(() => storageEngine.getCurrentClient().id);
  const [messages, setMessages] = useState<MessageThread[]>(() => storageEngine.getMessages());
  const [showRebrandModal, setShowRebrandModal] = useState(false);

  useEffect(() => {
    applyBrandToDOM(brand);
  }, [brand]);

  const currentClient = clients.find(c => c.id === currentClientId) || clients[0];

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
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Master Top Control Bar (For Platform Evaluation & Testing) */}
      <div
        style={{
          background: '#1A1A1A',
          color: '#FFFFFF',
          padding: '8px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
          zIndex: 100,
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              backgroundColor: 'var(--brand-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Brain size={14} color="#FFFFFF" />
          </div>
          <span style={{ fontWeight: 700, fontSize: '13px', letterSpacing: '0.02em' }}>
            {brand.name}
          </span>
          <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.5)' }}>| Clinical Neurofeedback Suite</span>
        </div>

        {/* View Switcher & Client Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Patient Selector */}
          {role === 'patient' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <User size={14} color="rgba(255, 255, 255, 0.6)" />
              <select
                value={currentClientId}
                onChange={e => {
                  setCurrentClientId(e.target.value);
                  storageEngine.setCurrentClientId(e.target.value);
                }}
                style={{
                  background: 'rgba(255, 255, 255, 0.12)',
                  color: '#FFFFFF',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 8px',
                  fontSize: '12px',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {clients.map(c => (
                  <option key={c.id} value={c.id} style={{ background: '#1A1A1A', color: '#FFFFFF' }}>
                    {c.name} ({c.condition.split(' ')[0]})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Role Toggle */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.12)',
              borderRadius: 'var(--radius-xl)',
              padding: '3px',
              display: 'flex',
              gap: '2px',
            }}
          >
            <button
              onClick={() => setRole('patient')}
              style={{
                background: role === 'patient' ? 'var(--brand-primary)' : 'transparent',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 'var(--radius-xl)',
                padding: '4px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Smartphone size={13} /> Patient App
            </button>
            <button
              onClick={() => setRole('clinician')}
              style={{
                background: role === 'clinician' ? 'var(--brand-primary)' : 'transparent',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 'var(--radius-xl)',
                padding: '4px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Monitor size={13} /> Clinician Portal
            </button>
          </div>

          {/* Clinic Branding Settings Button */}
          <button
            onClick={() => setShowRebrandModal(true)}
            style={{
              background: 'rgba(255, 255, 255, 0.15)',
              color: '#FFFFFF',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 10px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Sliders size={13} /> Clinic Theme
          </button>
        </div>
      </div>

      {/* Main View Shell */}
      <div style={{ flex: 1 }}>
        {role === 'patient' ? (
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
        )}
      </div>

      {/* White-Label Customizer Modal */}
      {showRebrandModal && (
        <ClinicCustomizerModal
          currentBrand={brand}
          onSave={handleSaveBrand}
          onClose={() => setShowRebrandModal(false)}
        />
      )}
    </div>
  );
}

export default App;
