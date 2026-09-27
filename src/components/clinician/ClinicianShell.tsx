import React, { useState } from 'react';
import { ClientProfile, ClinicBrandConfig, PatientInvitation, QEEGBrainMap } from '../../types';
import { ClientRosterView } from './ClientRosterView';
import { ClientDetailView } from './ClientDetailView';
import { MessagingView } from './MessagingView';
import { useMessageUnread } from '../messaging/useMessageUnread';
import { messageRepository } from '../../services/messageRepository';
import { ClinicalCalendarView } from './ClinicalCalendarView';
import { ClinicalReportsView } from './ClinicalReportsView';
import { ClinicSettingsView } from './ClinicSettingsView';
import type { ClinicSettingsSnapshot } from '../../services/clinicSettingsRepository';
import { BrandLogo } from '../brand/BrandLogo';
import { useAuth } from '../../contexts/AuthContext';
import {
  Users,
  Calendar,
  MessageSquare,
  BarChart3,
  Settings,
  Sliders,
  LogOut,
} from 'lucide-react';

interface ClinicianShellProps {
  brand: ClinicBrandConfig;
  clinicianLabel?: string;
  isDemoWorkspace?: boolean;
  clients: ClientProfile[];
  rosterStatus: 'loading' | 'ready' | 'error';
  patientInvitations: PatientInvitation[];
  onUpdateClient: (updated: ClientProfile) => Promise<void>;
  onAppendBrainMap: (patientId: string, map: QEEGBrainMap) => Promise<QEEGBrainMap>;
  onDeleteClient?: (clientId: string) => void | Promise<void>;
  onAddClient: (newClient: Partial<ClientProfile>) => Promise<PatientInvitation>;
  onCancelPatientInvitation: (invitationId: string) => Promise<void>;
  onOpenRebrand: () => void;
  onClinicSettingsSaved?: (snapshot: ClinicSettingsSnapshot) => void | Promise<void>;
  onLogout: () => Promise<void>;
}

interface ClinicianNavItem {
  id: 'clients' | 'calendar' | 'messages' | 'reports' | 'settings';
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  badge?: number;
}

export const ClinicianShell: React.FC<ClinicianShellProps> = ({
  brand,
  clinicianLabel,
  isDemoWorkspace = false,
  clients,
  rosterStatus,
  patientInvitations,
  onUpdateClient,
  onAppendBrainMap,
  onDeleteClient,
  onAddClient,
  onCancelPatientInvitation,
  onOpenRebrand,
  onClinicSettingsSaved,
  onLogout,
}) => {
  const { user } = useAuth();
  const [activeNav, setActiveNav] = useState<'clients' | 'calendar' | 'messages' | 'reports' | 'settings'>('clients');
  const [selectedClient, setSelectedClient] = useState<ClientProfile | null>(null);
  const linkedSelectedClient = clients.find((client) => client.id === selectedClient?.id) ?? null;
  const messageUnread = useMessageUnread(clients.map((client) => client.id), messageRepository, !isDemoWorkspace,
    JSON.stringify({ accountId: user?.uid ?? null, relationships: clients.map((client) => [client.id, client.clinicianId || client.linkedClinicianCode || '']).sort() }));
  const unreadConversationCount = clients.filter((client) => messageUnread.byPatient[client.id]?.unread).length;
  const messageCountKnown = rosterStatus === 'ready' && messageUnread.isComplete;

  const navItems: ClinicianNavItem[] = [
    { id: 'clients', label: 'Patients', icon: Users },
    { id: 'messages', label: 'Messages', icon: MessageSquare, badge: messageCountKnown ? unreadConversationCount : undefined },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const handleSelectClient = (client: ClientProfile) => {
    const linkedClient = clients.find((candidate) => candidate.id === client.id);
    if (!linkedClient) return;
    setSelectedClient(linkedClient);
    setActiveNav('clients');
  };

  const handleOpenMessagesForClient = (clientId: string) => {
    const client = clients.find((c) => c.id === clientId) || null;
    if (!client) return;
    setSelectedClient(client);
    setActiveNav('messages');
  };

  const handleOpenChartForClient = (clientId: string) => {
    const client = clients.find((c) => c.id === clientId);
    if (client) handleSelectClient(client);
  };

  return (
    <div className="clinician-shell-container">
      {isDemoWorkspace && (
        <div role="status" style={{ position: 'fixed', zIndex: 1000, top: 0, left: 0, right: 0, padding: '6px 12px', textAlign: 'center', background: '#7C2D12', color: '#FFFFFF', fontSize: '12px', fontWeight: 700, letterSpacing: '0.02em' }}>
          Sample clinician workspace · fictional demonstration data · isolated from production accounts
        </div>
      )}
      {/* Mobile Top Header (iPhone only) */}
      <header className="clinician-mobile-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {brand.logoUrl && brand.logoUrl.startsWith('data:image') ? (
            <img
              src={brand.logoUrl}
              alt="Clinic Logo"
              style={{ width: '28px', height: '28px', objectFit: 'contain', borderRadius: '4px' }}
            />
          ) : (
            <BrandLogo size={28} variant="terracotta" />
          )}
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
              {brand.name}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Clinician Suite</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={onOpenRebrand}
            className="btn btn-ghost"
            style={{ padding: '6px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
            title="Clinic Branding"
          >
            <Sliders size={14} />
            <span>Brand</span>
          </button>
          <button
            onClick={() => void onLogout()}
            className="btn btn-ghost"
            style={{ padding: '6px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={14} />
            <span>Sign out</span>
          </button>
        </div>
      </header>

      {/* Clinician Left Sidebar Navigation (iPad & Desktop >= 768px) */}
      <aside className="clinician-sidebar">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          {/* Clinic Brand Identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 8px' }}>
            {brand.logoUrl && brand.logoUrl.startsWith('data:image') ? (
              <img
                src={brand.logoUrl}
                alt="Clinic Logo"
                style={{ width: '32px', height: '32px', objectFit: 'contain', borderRadius: '4px' }}
              />
            ) : (
              <BrandLogo size={32} variant="terracotta" />
            )}
            <div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                {brand.name}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Neurofeedback Portal</div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveNav(item.id as any);
                    if (item.id === 'clients') setSelectedClient(null);
                  }}
                  aria-label={item.id === 'messages' ? messageCountKnown ? `Messages, ${unreadConversationCount} unread conversations` : 'Messages, unread count unavailable' : item.label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    background: isActive ? '#E4E7EB' : 'transparent',
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: isActive ? 600 : 500,
                    fontSize: '14px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </div>
                  {item.id === 'messages' && !messageCountKnown && <span aria-hidden="true" title="Unread count unavailable" style={{ color: 'var(--text-secondary)' }}>…</span>}
                  {item.badge ? (
                    <span
                      style={{
                        background: 'var(--brand-primary)',
                        color: '#FFFFFF',
                        fontSize: '10px',
                        padding: '2px 6px',
                        borderRadius: 'var(--radius-full)',
                        fontWeight: 700,
                      }}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Account and clinic actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ padding: '0 8px', minWidth: 0 }}>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Signed in as</div>
            <div
              title={clinicianLabel}
              style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {clinicianLabel}
            </div>
          </div>
          <button
            onClick={() => void onLogout()}
            className="btn btn-ghost"
            style={{
              width: '100%',
              justifyContent: 'flex-start',
              padding: '10px 12px',
              fontSize: '13px',
              gap: '8px',
              color: 'var(--text-secondary)',
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
          <button
            onClick={onOpenRebrand}
            className="btn btn-ghost"
            style={{
              width: '100%',
              justifyContent: 'flex-start',
              padding: '10px 12px',
              border: '1px dashed var(--border-default)',
              fontSize: '13px',
              gap: '8px',
            }}
          >
            <Sliders size={16} /> Clinic Theme Settings
          </button>

        </div>
      </aside>

      {/* Main Content Area */}
      <main className="clinician-main-content">
        {activeNav === 'clients' && !linkedSelectedClient && (
          <ClientRosterView
            clients={clients}
            invitations={patientInvitations}
            onSelectClient={(c) => setSelectedClient(c)}
            onAddClient={onAddClient}
            onCancelInvitation={onCancelPatientInvitation}
            onUpdateClient={onUpdateClient}
            onDeleteClient={onDeleteClient}
            onScheduleClient={(clientId) => {
              const client = clients.find((c) => c.id === clientId);
              if (client) { setSelectedClient(client); setActiveNav('calendar'); }
            }}
            onMessageClient={handleOpenMessagesForClient}
          />
        )}

        {activeNav === 'clients' && linkedSelectedClient && (
          <ClientDetailView
            client={linkedSelectedClient}
            brand={brand}
            onBack={() => setSelectedClient(null)}
            onUpdateClient={async (c) => {
              await onUpdateClient(c);
              setSelectedClient(c);
            }}
            onAppendBrainMap={(map) => onAppendBrainMap(linkedSelectedClient.id, map)}
            onSendMessage={() => {
              setActiveNav('messages');
            }}
            onScheduleClient={() => setActiveNav('calendar')}
          />
        )}

        {activeNav === 'messages' && (
          <MessagingView
            participants={clients.map((client) => ({ patientId: client.id, name: client.name, avatarUrl: client.avatarUrl }))}
            selectedClientId={linkedSelectedClient?.id}
            onOpenChart={handleOpenChartForClient}
            unreadByPatient={messageUnread.byPatient}
            notificationError={messageUnread.error}
          />
        )}

        {activeNav === 'calendar' && (
          <ClinicalCalendarView
            clients={clients}
            preSelectedClientId={linkedSelectedClient?.id}
            onSelectClient={handleSelectClient}
            onOpenMessages={handleOpenMessagesForClient}
          />
        )}

        {activeNav === 'reports' && (
          <ClinicalReportsView
            clients={clients}
            brand={brand}
            onSelectClient={handleSelectClient}
          />
        )}

        {activeNav === 'settings' && (
          <ClinicSettingsView
            brand={brand}
            onOpenRebrand={onOpenRebrand}
            onSettingsSaved={onClinicSettingsSaved}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation Bar (iPhone only) */}
      <nav className="clinician-mobile-bottom-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeNav === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setActiveNav(item.id as any);
                if (item.id === 'clients') setSelectedClient(null);
              }}
              aria-label={item.id === 'messages' ? messageCountKnown ? `Messages, ${unreadConversationCount} unread conversations` : 'Messages, unread count unavailable' : item.label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '3px',
                border: 'none',
                background: 'transparent',
                color: isActive ? 'var(--brand-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                padding: '4px 8px',
                position: 'relative',
                minWidth: '54px',
              }}
            >
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
                {item.id === 'messages' && !messageCountKnown && <span aria-hidden="true" title="Unread count unavailable" style={{ fontSize: '11px' }}>…</span>}
                {item.badge ? (
                  <span
                    style={{
                      position: 'absolute',
                      top: '-4px',
                      right: '-8px',
                      background: 'var(--brand-primary)',
                      color: '#FFFFFF',
                      fontSize: '9px',
                      padding: '1px 5px',
                      borderRadius: 'var(--radius-full)',
                      fontWeight: 700,
                    }}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </div>
              <span style={{ fontSize: '11px', fontWeight: isActive ? 700 : 500 }}>
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
