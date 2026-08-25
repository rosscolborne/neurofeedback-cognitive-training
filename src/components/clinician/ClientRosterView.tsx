import React, { useState } from 'react';
import { ClientProfile } from '../../types';
import { Search, Plus, MoreVertical } from 'lucide-react';

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className="font-body" style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Client Roster
          </h1>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            {clients.length} Total Patients • {clients.filter(c => c.status === 'active').length} Active Training
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn btn-dense"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '13px' }}
        >
          <Plus size={16} /> Add Patient
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div
          style={{
            flex: '1',
            minWidth: '200px',
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
            placeholder="Search patients, conditions..."
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
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: '2px' }}>
          {(['all', 'active', 'paused', 'completed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              style={{
                background: statusFilter === f ? '#3A4B58' : 'var(--surface-clinician-card)',
                color: statusFilter === f ? '#FFFFFF' : 'var(--text-secondary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'capitalize',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* High Information Density Data Table (Desktop & iPad >= 768px) */}
      <div
        className="card-clinician clinician-table-desktop"
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

      {/* Mobile Patient Cards List (iPhone < 768px) */}
      <div className="clinician-roster-mobile">
        {filteredClients.map(client => (
          <div
            key={client.id}
            onClick={() => onSelectClient(client)}
            className="card-clinician"
            style={{
              padding: '16px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              backgroundColor: 'var(--surface-clinician-card)',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <img
                  src={client.avatarUrl}
                  alt={client.name}
                  style={{ width: '42px', height: '42px', borderRadius: '50%', objectFit: 'cover' }}
                />
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>{client.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{client.email}</div>
                </div>
              </div>
              <span className={`status-tag status-tag-${client.status}`} style={{ fontSize: '10px', padding: '3px 8px' }}>
                ● {client.status.toUpperCase()}
              </span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', fontSize: '12px' }}>
              <span style={{ background: 'var(--surface-clinician-sidebar)', padding: '4px 8px', borderRadius: 'var(--radius-sm)', fontWeight: 500 }}>
                {client.condition}
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>
                Protocol: <strong>{client.assignedProtocol.replace(/-/g, ' ')}</strong>
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px', fontSize: '12px' }}>
              <div>
                <span style={{ color: 'var(--text-tertiary)' }}>Capacity: </span>
                <span className="font-mono" style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>
                  {client.brainCapacityScore}%
                </span>
                <span style={{ color: 'var(--text-tertiary)', marginLeft: '12px' }}>Sessions: </span>
                <span style={{ fontWeight: 600 }}>{client.completedSessionsCount}</span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                {client.lastSessionDate}
              </div>
            </div>
          </div>
        ))}
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
            padding: '16px',
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
                  Primary Clinical Indication
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
                  <option value="ADHD (Inattentive)">ADHD (Inattentive)</option>
                  <option value="ADHD (Combined)">ADHD (Combined)</option>
                  <option value="Generalized Anxiety">Generalized Anxiety</option>
                  <option value="Executive Functioning & Burnout">Executive Functioning & Burnout</option>
                  <option value="Peak Performance & Flow">Peak Performance & Flow</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="btn btn-ghost"
                  style={{ padding: '8px 14px', fontSize: '13px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-dense"
                  style={{ padding: '8px 16px', fontSize: '13px' }}
                >
                  Enroll Patient
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
