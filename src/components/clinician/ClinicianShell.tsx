import React, { useState } from 'react';
import {
  CalendarAppointment,
  ClientProfile,
  ClinicBrandConfig,
  MessageThread,
} from '../../types';
import { ClientRosterView } from './ClientRosterView';
import { ClientDetailView } from './ClientDetailView';
import { MessagingView } from './MessagingView';
import { ClinicalCalendarView } from './ClinicalCalendarView';
import { ClinicalReportsView } from './ClinicalReportsView';
import { ClinicSettingsView } from './ClinicSettingsView';
import { BrandLogo } from '../brand/BrandLogo';
import {
  Users,
  Calendar,
  MessageSquare,
  BarChart3,
  Settings,
  Sliders,
  ShieldCheck,
} from 'lucide-react';

interface ClinicianShellProps {
  brand: ClinicBrandConfig;
  clients: ClientProfile[];
  messages: MessageThread[];
  appointments: CalendarAppointment[];
  onUpdateClient: (updated: ClientProfile) => void;
  onDeleteClient?: (clientId: string) => void;
  onAddClient: (newClient: Partial<ClientProfile>) => void;
  onSendMessage: (clientId: string, text: string) => void;
  onSaveAppointment: (appt: CalendarAppointment) => void;
  onDeleteAppointment: (id: string) => void;
  onClearDemoData: () => void;
  onResetDemoData: () => void;
  onOpenRebrand: () => void;
}

interface ClinicianNavItem {
  id: 'clients' | 'calendar' | 'messages' | 'reports' | 'settings';
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  badge?: number;
}

export const ClinicianShell: React.FC<ClinicianShellProps> = ({
  brand,
  clients,
  messages,
  appointments,
  onUpdateClient,
  onDeleteClient,
  onAddClient,
  onSendMessage,
  onSaveAppointment,
  onDeleteAppointment,
  onClearDemoData,
  onResetDemoData,
  onOpenRebrand,
}) => {
  const [activeNav, setActiveNav] = useState<'clients' | 'calendar' | 'messages' | 'reports' | 'settings'>('clients');
  const [selectedClient, setSelectedClient] = useState<ClientProfile | null>(null);

  const totalUnread = messages.reduce((acc, t) => acc + (t.unreadCount || 0), 0);

  const navItems: ClinicianNavItem[] = [
    { id: 'clients', label: 'Patients', icon: Users },
    { id: 'messages', label: 'Messages', icon: MessageSquare, badge: totalUnread },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const handleSelectClient = (client: ClientProfile) => {
    setSelectedClient(client);
    setActiveNav('clients');
  };

  const handleOpenMessagesForClient = (clientId: string) => {
    const client = clients.find((c) => c.id === clientId) || null;
    setSelectedClient(client);
    setActiveNav('messages');
  };

  return (
    <div className="clinician-shell-container">
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
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Clinician Suite • Muse S Athena</div>
          </div>
        </div>

        <button
          onClick={onOpenRebrand}
          className="btn btn-ghost"
          style={{ padding: '6px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
          title="Clinic Branding"
        >
          <Sliders size={14} />
          <span>Brand</span>
        </button>
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

        {/* Bottom Rebranding Action */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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

          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', padding: '0 8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ShieldCheck size={13} color="var(--status-active)" />
            <span>HIPAA Compliant Security</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="clinician-main-content">
        {activeNav === 'clients' && !selectedClient && (
          <ClientRosterView
            clients={clients}
            onSelectClient={(c) => setSelectedClient(c)}
            onAddClient={onAddClient}
            onUpdateClient={onUpdateClient}
            onDeleteClient={onDeleteClient}
            onScheduleClient={(clientId) => {
              const client = clients.find((c) => c.id === clientId);
              if (client) setSelectedClient(client);
              setActiveNav('calendar');
            }}
            onMessageClient={handleOpenMessagesForClient}
          />
        )}

        {activeNav === 'clients' && selectedClient && (
          <ClientDetailView
            client={selectedClient}
            brand={brand}
            onBack={() => setSelectedClient(null)}
            onUpdateClient={(c) => {
              onUpdateClient(c);
              setSelectedClient(c);
            }}
            onSendMessage={() => {
              setActiveNav('messages');
            }}
          />
        )}

        {activeNav === 'messages' && (
          <MessagingView
            threads={messages}
            selectedClientId={selectedClient?.id}
            onSendMessage={onSendMessage}
          />
        )}

        {activeNav === 'calendar' && (
          <ClinicalCalendarView
            clients={clients}
            appointments={appointments}
            onSaveAppointment={onSaveAppointment}
            onDeleteAppointment={onDeleteAppointment}
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
            onClearDemoData={onClearDemoData}
            onResetDemoData={onResetDemoData}
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
