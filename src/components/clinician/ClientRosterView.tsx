import React, { useState } from 'react';
import { ClientProfile, ProtocolType } from '../../types';
import {
  Search,
  Plus,
  MoreVertical,
  Edit,
  Trash2,
  Calendar,
  MessageSquare,
  FileText,
  User,
} from 'lucide-react';

interface ClientRosterViewProps {
  clients: ClientProfile[];
  onSelectClient: (client: ClientProfile) => void;
  onAddClient: (newClient: Partial<ClientProfile>) => void;
  onUpdateClient?: (updated: ClientProfile) => void;
  onDeleteClient?: (id: string) => void;
  onScheduleClient?: (clientId: string) => void;
  onMessageClient?: (clientId: string) => void;
}

export const ClientRosterView: React.FC<ClientRosterViewProps> = ({
  clients,
  onSelectClient,
  onAddClient,
  onUpdateClient,
  onDeleteClient,
  onScheduleClient,
  onMessageClient,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused' | 'completed'>('all');
  const [cohortFilter, setCohortFilter] = useState<'all' | 'real' | 'demo'>('all');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientProfile | null>(null);

  // Form State
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formCondition, setFormCondition] = useState<ClientProfile['condition']>('ADHD (Inattentive)');
  const [formProtocol, setFormProtocol] = useState<ProtocolType>('theta-beta-ratio');
  const [formStatus, setFormStatus] = useState<'active' | 'paused' | 'completed'>('active');
  const [formSessionsPerWeek, setFormSessionsPerWeek] = useState(4);
  const [formNotes, setFormNotes] = useState('');

  const filteredClients = clients.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.condition.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    const matchesCohort =
      cohortFilter === 'all' ||
      (cohortFilter === 'real' && !c.isDemo) ||
      (cohortFilter === 'demo' && !!c.isDemo);

    return matchesSearch && matchesStatus && matchesCohort;
  });

  const handleOpenAdd = () => {
    setEditingClient(null);
    setFormName('');
    setFormEmail('');
    setFormCondition('ADHD (Inattentive)');
    setFormProtocol('theta-beta-ratio');
    setFormStatus('active');
    setFormSessionsPerWeek(4);
    setFormNotes('');
    setShowAddModal(true);
  };

  const handleOpenEdit = (client: ClientProfile, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingClient(client);
    setFormName(client.name);
    setFormEmail(client.email);
    setFormCondition(client.condition);
    setFormProtocol(client.assignedProtocol);
    setFormStatus(client.status);
    setFormSessionsPerWeek(client.prescribedSessionsPerWeek || 4);
    setFormNotes(client.notes || '');
    setShowAddModal(true);
  };

  const handleDelete = (clientId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to remove this patient from the roster?')) {
      if (onDeleteClient) onDeleteClient(clientId);
    }
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    if (editingClient && onUpdateClient) {
      onUpdateClient({
        ...editingClient,
        name: formName,
        email: formEmail || editingClient.email,
        condition: formCondition,
        assignedProtocol: formProtocol,
        status: formStatus,
        prescribedSessionsPerWeek: Number(formSessionsPerWeek),
        notes: formNotes,
      });
    } else {
      onAddClient({
        name: formName,
        email: formEmail,
        condition: formCondition,
        status: formStatus,
        assignedProtocol: formProtocol,
        prescribedSessionsPerWeek: Number(formSessionsPerWeek),
        notes: formNotes,
      });
    }

    setShowAddModal(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header & Action */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className="font-body" style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Patient Roster
          </h1>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            {clients.length} Total Patients • {clients.filter((c) => c.status === 'active').length} Active Training
          </p>
        </div>
        <button
          onClick={handleOpenAdd}
          className="btn btn-dense"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '13px' }}
        >
          <Plus size={16} /> Enroll New Patient
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
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search patients, email, conditions..."
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

        {/* Cohort Toggle */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {[
            { id: 'all', label: 'All' },
            { id: 'real', label: 'Enrolled' },
            { id: 'demo', label: 'Sample' },
          ].map((c) => (
            <button
              key={c.id}
              onClick={() => setCohortFilter(c.id as any)}
              style={{
                background: cohortFilter === c.id ? '#3A4B58' : 'var(--surface-clinician-card)',
                color: cohortFilter === c.id ? '#FFFFFF' : 'var(--text-secondary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 10px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Filter Chips */}
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {(['all', 'active', 'paused', 'completed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              style={{
                background: statusFilter === f ? 'var(--surface-clinician-sidebar)' : 'transparent',
                color: statusFilter === f ? 'var(--text-primary)' : 'var(--text-secondary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: statusFilter === f ? 700 : 500,
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
              <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Capacity Score</th>
              <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Sessions</th>
              <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: 'var(--text-secondary)' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredClients.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  No patients match the selected filter.
                </td>
              </tr>
            ) : (
              filteredClients.map((client) => (
                <tr
                  key={client.id}
                  onClick={() => onSelectClient(client)}
                  style={{
                    borderBottom: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    transition: 'background-color 0.1s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-patient-base)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <td style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <img
                        src={client.avatarUrl}
                        alt={client.name}
                        style={{ width: '34px', height: '34px', borderRadius: '50%', objectFit: 'cover' }}
                      />
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>{client.name}</span>
                          {client.isDemo && (
                            <span
                              style={{
                                fontSize: '9px',
                                background: 'var(--surface-clinician-sidebar)',
                                color: 'var(--text-tertiary)',
                                padding: '1px 5px',
                                borderRadius: '4px',
                                fontWeight: 600,
                              }}
                            >
                              Sample
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 400 }}>
                          {client.email}
                        </div>
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
                  <td style={{ padding: '14px 16px' }}>
                    <span className="font-mono" style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>
                      {client.brainCapacityScore}%
                    </span>
                  </td>
                  <td style={{ padding: '14px 16px', fontWeight: 600 }}>
                    {client.completedSessionsCount}
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px' }}>
                      <button
                        onClick={(e) => handleOpenEdit(client, e)}
                        className="btn btn-ghost"
                        style={{ padding: '4px 6px', fontSize: '11px' }}
                        title="Edit Patient"
                      >
                        <Edit size={14} />
                      </button>
                      {onDeleteClient && (
                        <button
                          onClick={(e) => handleDelete(client.id, e)}
                          className="btn btn-ghost"
                          style={{ padding: '4px 6px', fontSize: '11px', color: 'var(--status-alert)' }}
                          title="Remove Patient"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Patient Cards List (iPhone < 768px) */}
      <div className="clinician-roster-mobile">
        {filteredClients.map((client) => (
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
                  <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span>{client.name}</span>
                    {client.isDemo && (
                      <span style={{ fontSize: '9px', background: 'var(--surface-clinician-sidebar)', color: 'var(--text-tertiary)', padding: '1px 5px', borderRadius: '4px' }}>
                        Sample
                      </span>
                    )}
                  </div>
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
              <button
                onClick={(e) => handleOpenEdit(client, e)}
                className="btn btn-ghost"
                style={{ padding: '4px 8px', fontSize: '11px' }}
              >
                <Edit size={12} /> Edit
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add / Edit Patient Modal */}
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
              maxWidth: '480px',
              backgroundColor: '#FFFFFF',
              borderRadius: 'var(--radius-md)',
              padding: '24px',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>
              {editingClient ? 'Edit Patient Clinical Profile' : 'Enroll New Patient'}
            </h3>
            <form onSubmit={handleSaveForm} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
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
                  Email Address
                </label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="patient@example.com"
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
                  value={formCondition}
                  onChange={(e) => setFormCondition(e.target.value as any)}
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
                  <option value="Stress / Insomnia">Stress / Insomnia</option>
                  <option value="Peak Performance">Peak Performance</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                    Assigned Protocol
                  </label>
                  <select
                    value={formProtocol}
                    onChange={(e) => setFormProtocol(e.target.value as any)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-default)',
                      fontSize: '13px',
                      background: '#FFFFFF',
                    }}
                  >
                    <option value="theta-beta-ratio">Theta/Beta (Lubar)</option>
                    <option value="smr-enhancement">SMR (Sterman)</option>
                    <option value="alpha-enhancement">Alpha (Hardt)</option>
                    <option value="alpha-theta-crossover">Alpha-Theta (Peniston)</option>
                    <option value="beta-downtraining">Beta Downtraining</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                    Status
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as any)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-default)',
                      fontSize: '13px',
                      background: '#FFFFFF',
                    }}
                  >
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                  Clinical Notes & Placement Guidance
                </label>
                <textarea
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="e.g. Ensure AF7/AF8 forehead electrodes are clean; 4 sessions per week on Muse S Athena."
                  style={{
                    width: '100%',
                    height: '54px',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-default)',
                    fontSize: '12px',
                    resize: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
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
                  {editingClient ? 'Save Changes' : 'Enroll Patient'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
