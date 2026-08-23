import React, { useState } from 'react';
import { ClientProfile } from '../../types';
import { Search, Plus, MoreVertical, Filter, UserCheck } from 'lucide-react';

interface ClientRosterViewProps {
  clients: ClientProfile[];
  onSelectClient: (client: ClientProfile) => void;
  onAddClient: (newClient: Partial<ClientProfile>) => void;
}

export const ClientRosterView: React.FC<ClientRosterViewProps> = ({
  clients,
  onSelectClient,
  onAddClient,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused' | 'completed'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientCondition, setNewClientCondition] = useState<ClientProfile['condition']>('ADHD (Inattentive)');

  const filteredClients = clients.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          c.condition.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName.trim()) return;

    onAddClient({
      name: newClientName,
      condition: newClientCondition,
      status: 'active',
      assignedProtocol: newClientCondition.includes('ADHD') ? 'theta-beta-ratio' : 'alpha-enhancement',
    });
    setNewClientName('');
    setShowAddModal(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header & Action */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="font-body" style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Client Roster
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {clients.length} Total Patients • {clients.filter(c => c.status === 'active').length} Active Training
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn btn-dense"
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Plus size={16} /> Add Client
        </button>
      </div>

      {/* Search & Filter Bar (Matching Mockup §8.6) */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div
          style={{
            flex: '1',
            minWidth: '240px',
            position: 'relative',
            background: 'var(--surface-clinician-card)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Search size={16} color="var(--text-tertiary)" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by client name, condition, or protocol..."
            style={{
              border: 'none',
              outline: 'none',
              background: 'transparent',
              width: '100%',
              fontSize: '13px',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-body)',
            }}
          />
        </div>

        {/* Filter Chips */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {(['all', 'active', 'paused', 'completed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              style={{
                background: statusFilter === f ? '#3A4B58' : 'var(--surface-clinician-card)',
                color: statusFilter === f ? '#FFFFFF' : 'var(--text-secondary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'capitalize',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* High Information Density Data Table (Matching Spec §7.6 & §8.6) */}
      <div
        className="card-clinician"
        style={{
          padding: '0',
          overflow: 'hidden',
          backgroundColor: 'var(--surface-clinician-card)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: 'var(--surface-clinician-sidebar)', borderBottom: '1px solid var(--border-default)' }}>
              <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Client Name</th>
              <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Status</th>
              <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Condition / Protocol</th>
              <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Last Session</th>
              <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Next Session</th>
              <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Capacity Score</th>
              <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Sessions</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {filteredClients.map(client => (
              <tr
                key={client.id}
                onClick={() => onSelectClient(client)}
                style={{
                  borderBottom: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                  transition: 'background-color 0.1s ease',
                }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--surface-patient-base)')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <td style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <img
                      src={client.avatarUrl}
                      alt={client.name}
                      style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }}
                    />
                    <div>
                      <div>{client.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 400 }}>{client.email}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '14px 16px' }}>
                  <span className={`status-tag status-tag-${client.status}`}>
                    ● {client.status.toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: '14px 16px' }}>
                  <div style={{ fontWeight: 500 }}>{client.condition}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {client.assignedProtocol.replace(/-/g, ' ')}
                  </div>
                </td>
                <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>
                  {client.lastSessionDate}
                </td>
                <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>
                  {client.nextSessionDate}
                </td>
                <td style={{ padding: '14px 16px' }}>
                  <span className="font-mono" style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>
                    {client.brainCapacityScore}%
                  </span>
                </td>
                <td style={{ padding: '14px 16px', fontWeight: 600 }}>
                  {client.completedSessionsCount}
                </td>
                <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                  <MoreVertical size={16} color="var(--text-tertiary)" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Client Modal */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(26, 26, 26, 0.4)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            className="card-clinician"
            style={{
              width: '100%',
              maxWidth: '440px',
              backgroundColor: '#FFFFFF',
              borderRadius: 'var(--radius-md)',
              padding: '24px',
            }}
          >
            <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Add New Patient</h3>
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={newClientName}
                  onChange={e => setNewClientName(e.target.value)}
                  placeholder="e.g. Alex Morgan"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-default)',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                  Clinical Indication
                </label>
                <select
                  value={newClientCondition}
                  onChange={e => setNewClientCondition(e.target.value as any)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-default)',
                    fontSize: '13px',
                    outline: 'none',
                    background: '#FFFFFF',
                  }}
                >
                  <option value="ADHD (Inattentive)">ADHD (Inattentive Focus)</option>
                  <option value="ADHD (Combined)">ADHD (Combined)</option>
                  <option value="Generalized Anxiety">Generalized Anxiety (Alpha Regulation)</option>
                  <option value="Stress / Insomnia">Stress & Insomnia (Beta Downtraining)</option>
                  <option value="Peak Performance">Peak Cognitive Performance (SMR Stillness)</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button type="submit" className="btn btn-dense" style={{ flex: 1 }}>
                  Create Patient Record
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
