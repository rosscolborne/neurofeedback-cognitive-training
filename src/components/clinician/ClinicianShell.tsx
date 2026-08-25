import React, { useState } from 'react';
import { ClientProfile, ClinicBrandConfig, MessageThread } from '../../types';
import { ClientRosterView } from './ClientRosterView';
import { ClientDetailView } from './ClientDetailView';
import { MessagingView } from './MessagingView';
import { Users, Calendar, MessageSquare, BarChart3, Settings, Sliders, ShieldCheck } from 'lucide-react';

interface ClinicianShellProps {
  brand: ClinicBrandConfig;
  clients: ClientProfile[];
  messages: MessageThread[];
  onUpdateClient: (updated: ClientProfile) => void;
  onAddClient: (newClient: Partial<ClientProfile>) => void;
  onSendMessage: (clientId: string, text: string) => void;
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
  onUpdateClient,
  onAddClient,
  onSendMessage,
  onOpenRebrand,
}) => {
  const [activeNav, setActiveNav] = useState<'clients' | 'calendar' | 'messages' | 'reports' | 'settings'>('clients');
  const [selectedClient, setSelectedClient] = useState<ClientProfile | null>(null);

  const totalUnread = messages.reduce((acc, t) => acc + t.unreadCount, 0);

  const navItems: ClinicianNavItem[] = [
    { id: 'clients', label: 'Clients', icon: Users },
    { id: 'messages', label: 'Messages', icon: MessageSquare, badge: totalUnread },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

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
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--brand-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: '14px',
              }}
            >
              ●
            </div>
          )}
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
              {brand.name}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Clinician Suite</div>
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
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--brand-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '16px',
                }}
              >
                ●
              </div>
            )}
            <div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                {brand.name}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Clinician Suite</div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {navItems.map(item => {
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
            <ShieldCheck size={13} />
            <span>HIPAA Verified Portal</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="clinician-main-content">
        {activeNav === 'clients' && !selectedClient && (
          <ClientRosterView
            clients={clients}
            onSelectClient={c => setSelectedClient(c)}
            onAddClient={onAddClient}
          />
        )}

        {activeNav === 'clients' && selectedClient && (
          <ClientDetailView
            client={selectedClient}
            brand={brand}
            onBack={() => setSelectedClient(null)}
            onUpdateClient={c => {
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
          <div className="card-clinician" style={{ padding: '28px 20px', textAlign: 'center' }}>
            <Calendar size={36} color="var(--text-tertiary)" style={{ margin: '0 auto 12px auto' }} />
            <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Clinical Session Calendar</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Synchronized scheduling with automated patient reminder notifications.
            </p>
          </div>
        )}

        {activeNav === 'reports' && (
          <div className="card-clinician" style={{ padding: '28px 20px', textAlign: 'center' }}>
            <BarChart3 size={36} color="var(--text-tertiary)" style={{ margin: '0 auto 12px auto' }} />
            <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Clinic Aggregate Outcome Analytics</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Cohort-wide neuroplastic trend metrics and symptom rating score improvements.
            </p>
          </div>
        )}

        {activeNav === 'settings' && (
          <div className="card-clinician" style={{ padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Clinic Platform Settings</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Manage clinic license, EEG hardware drivers, and team practitioner access.
            </p>
            <button onClick={onOpenRebrand} className="btn btn-dense" style={{ alignSelf: 'flex-start' }}>
              Open Clinic Branding Customizer
            </button>
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation Bar (iPhone only) */}
      <nav className="clinician-mobile-bottom-nav">
        {navItems.map(item => {
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
