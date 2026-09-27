import React, { useEffect, useState } from 'react';
import { ClientProfile, PatientInvitation, ProtocolType } from '../../types';
import { timestampToMillis } from '../../services/dataMappers';
import { resolvePatientProtocol } from '../../services/protocols';
import { getClinicalProtocolTemplate } from '../../services/clinicalProtocolTemplates';
import { PatientAvatar } from './PatientAvatar';
import { formatLastSessionDate } from './formatLastSessionDate';
import {
  Search,
  Plus,
  MoreVertical,
  Edit,
  Trash2,
  Calendar,
  MessageSquare,
  FileText,
  Clock3,
  Copy,
  CheckCircle2,
} from 'lucide-react';

interface ClientRosterViewProps {
  clients: ClientProfile[];
  invitations: PatientInvitation[];
  onSelectClient: (client: ClientProfile) => void;
  onAddClient: (newClient: Partial<ClientProfile>) => Promise<PatientInvitation>;
  onCancelInvitation: (invitationId: string) => Promise<void>;
  onUpdateClient?: (updated: ClientProfile) => Promise<void>;
  onDeleteClient?: (id: string) => void | Promise<void>;
  onScheduleClient?: (clientId: string) => void;
  onMessageClient?: (clientId: string) => void;
}

const invitationUrl = (id: string) => `${window.location.origin}/connect/${id}`;
const currentTime = () => Date.now();

const invitationMillis = (value: PatientInvitation['expiresAt']): number | null => {
  try {
    const millis = timestampToMillis(value);
    return millis != null && !Number.isNaN(new Date(millis).getTime()) ? millis : null;
  } catch {
    return null;
  }
};

const invitationDate = (value: PatientInvitation['expiresAt']): string | null => {
  const millis = invitationMillis(value);
  if (millis == null) return null;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(millis));
};

export const ClientRosterView: React.FC<ClientRosterViewProps> = ({
  clients,
  invitations,
  onSelectClient,
  onAddClient,
  onCancelInvitation,
  onUpdateClient,
  onDeleteClient,
  onScheduleClient,
  onMessageClient,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused' | 'completed'>('all');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientProfile | null>(null);

  // Form State
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formCondition, setFormCondition] = useState<ClientProfile['condition']>(undefined);
  const [formProtocol, setFormProtocol] = useState<ProtocolType | undefined>(undefined);
  const [formStatus, setFormStatus] = useState<'active' | 'paused' | 'completed'>('active');
  const [formSessionsPerWeek, setFormSessionsPerWeek] = useState<number | ''>('');
  const [formNotes, setFormNotes] = useState('');
  const [createdInvitation, setCreatedInvitation] = useState<PatientInvitation | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [showHistory, setShowHistory] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<{ id: string; error: boolean } | null>(null);
  const effectiveNow = Math.max(clockNow, currentTime());

  useEffect(() => {
    const refreshClock = () => setClockNow(currentTime());
    if (typeof window !== 'undefined') window.addEventListener?.('focus', refreshClock);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', refreshClock);
    return () => {
      if (typeof window !== 'undefined') window.removeEventListener?.('focus', refreshClock);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', refreshClock);
    };
  }, []);

  useEffect(() => {
    const nextExpiry = invitations
      .filter((invitation) => invitation.status === 'pending')
      .map((invitation) => invitationMillis(invitation.expiresAt))
      .filter((expiry): expiry is number => expiry != null && expiry > effectiveNow)
      .reduce((soonest, expiry) => Math.min(soonest, expiry), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(() => setClockNow(currentTime()), Math.min(Math.max(nextExpiry - currentTime(), 0), 2_147_483_647));
    return () => clearTimeout(timer);
  }, [invitations, effectiveNow]);

  const invitationStatus = (invitation: PatientInvitation) =>
    invitation.status === 'pending' && (invitationMillis(invitation.expiresAt) ?? Number.POSITIVE_INFINITY) <= effectiveNow
      ? 'expired' : invitation.status;
  const pendingInvitations = invitations.filter((invitation) => invitationStatus(invitation) === 'pending');
  const historicalInvitations = invitations
    .filter((invitation) => invitationStatus(invitation) !== 'pending')
    .sort((a, b) => (invitationMillis(b.createdAt) ?? 0) - (invitationMillis(a.createdAt) ?? 0));

  const handleCopyInvitation = async (invitation: PatientInvitation) => {
    if (invitationStatus(invitation) !== 'pending' ||
      (invitationMillis(invitation.expiresAt) ?? Number.POSITIVE_INFINITY) <= currentTime()) {
      setClockNow(currentTime());
      return;
    }
    try {
      await navigator.clipboard.writeText(invitationUrl(invitation.id));
      setCopyFeedback({ id: invitation.id, error: false });
    } catch {
      setCopyFeedback({ id: invitation.id, error: true });
    }
  };

  const filteredClients = clients.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.condition ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleOpenAdd = () => {
    setEditingClient(null);
    setFormName('');
    setFormEmail('');
    setFormCondition(undefined);
    setFormProtocol(undefined);
    setFormStatus('active');
    setFormSessionsPerWeek('');
    setFormNotes('');
    setCreatedInvitation(null);
    setFormError(null);
    setCopiedCode(false);
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
    setFormSessionsPerWeek(client.prescribedSessionsPerWeek ?? '');
    setFormNotes(client.notes || '');
    setShowAddModal(true);
  };

  const handleDelete = async (clientId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to remove this patient from the roster?')) {
      if (!onDeleteClient) return;
      setActionError(null);
      setPendingActionId(clientId);
      try {
        await onDeleteClient(clientId);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Could not remove this patient. Try again.');
      } finally {
        setPendingActionId(null);
      }
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    const invitation = invitations.find((candidate) => candidate.id === invitationId);
    if (!invitation || invitationStatus(invitation) !== 'pending' ||
      (invitationMillis(invitation.expiresAt) ?? Number.POSITIVE_INFINITY) <= currentTime()) {
      setClockNow(currentTime());
      return;
    }
    setActionError(null);
    setPendingActionId(invitationId);
    try {
      await onCancelInvitation(invitationId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not cancel this invitation. Try again.');
    } finally {
      setPendingActionId(null);
    }
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;
    if (!editingClient && (!formCondition || !formProtocol || formSessionsPerWeek === '')) {
      setFormError('Select a clinical indication, protocol, and weekly target before creating the invitation.');
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      if (editingClient && onUpdateClient) {
        await onUpdateClient({
          ...editingClient,
          name: formName,
          email: formEmail || editingClient.email,
          condition: formCondition,
          assignedProtocol: formProtocol,
          customProtocolConfig: formProtocol === editingClient.assignedProtocol
            ? editingClient.customProtocolConfig
            : undefined,
          status: formStatus,
          prescribedSessionsPerWeek: formSessionsPerWeek === '' ? undefined : Number(formSessionsPerWeek),
          notes: formNotes,
        });
        setShowAddModal(false);
      } else {
        const invitation = await onAddClient({
          name: formName,
          email: formEmail,
          condition: formCondition,
          status: formStatus,
          assignedProtocol: formProtocol,
          prescribedSessionsPerWeek: formSessionsPerWeek === '' ? undefined : Number(formSessionsPerWeek),
          notes: formNotes,
        });
        setCreatedInvitation(invitation);
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not create the invitation.');
    } finally {
      setIsSaving(false);
    }
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
          <Plus size={16} /> Invite Patient
        </button>
      </div>

      {actionError && <div role="alert" style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--status-alert-bg)', color: 'var(--status-alert)', fontSize: '12px' }}>{actionError}</div>}

      {pendingInvitations.length > 0 && (
        <section className="card-clinician" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 700 }}>
            <Clock3 size={16} color="var(--brand-primary)" /> Pending invitations
          </div>
          {pendingInvitations.map((invitation) => {
            const expiry = invitationDate(invitation.expiresAt);
            return (
              <div key={invitation.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-clinician-sidebar)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>{invitation.patientName}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{invitation.patientEmail}</div>
                  <div className="font-mono" style={{ marginTop: '3px', fontSize: '11px', color: 'var(--brand-primary)' }}>{invitation.id}</div>
                  <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {expiry ? `Expires ${expiry}` : 'Expiry unavailable'}
                  </div>
                  {copyFeedback?.id === invitation.id && copyFeedback.error && <div role="alert" style={{ marginTop: '4px', fontSize: '12px', color: 'var(--status-alert)' }}>Copy was blocked by your browser. Select the code above and copy it manually.</div>}
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => void handleCopyInvitation(invitation)} className="btn btn-secondary" style={{ fontSize: '12px' }}>
                    <Copy size={14} /> {copyFeedback?.id === invitation.id && !copyFeedback.error ? 'Link copied' : 'Copy link'}
                  </button>
                  <button onClick={() => void handleCancelInvitation(invitation.id)} disabled={pendingActionId === invitation.id} className="btn btn-ghost" style={{ fontSize: '12px' }}>
                    {pendingActionId === invitation.id ? 'Cancelling…' : 'Cancel'}
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section className="card-clinician" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button type="button" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory} className="btn btn-ghost" style={{ alignSelf: 'flex-start', fontSize: '13px', fontWeight: 700 }}>
          Invitation history ({historicalInvitations.length})
        </button>
        {showHistory && historicalInvitations.length === 0 && <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>No past invitations yet.</div>}
        {showHistory && historicalInvitations.map((invitation) => {
          const status = invitationStatus(invitation);
          const date = status === 'accepted' ? invitation.acceptedAt : invitation.expiresAt;
          const label = status === 'accepted' ? 'Accepted' : status === 'cancelled' ? 'Cancelled' : 'Expired';
          const dateLabel = status === 'cancelled' ? 'Cancellation date unavailable' : invitationDate(date) ?? 'Date unavailable';
          return <div key={invitation.id} style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-clinician-sidebar)', fontSize: '12px' }}>
            <div style={{ fontWeight: 600 }}>{invitation.patientName}</div>
            <div style={{ color: 'var(--text-secondary)' }}>{invitation.patientEmail}</div>
            <div style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>{label} · {dateLabel}</div>
          </div>;
        })}
      </section>

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
              <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Sessions</th>
              <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: 'var(--text-secondary)' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredClients.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
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
                      <PatientAvatar avatarUrl={client.avatarUrl} size={34} />
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>{client.name}</span>
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
                    <div style={{ fontWeight: 500 }}>{client.condition || 'Condition unavailable'}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {getClinicalProtocolTemplate(resolvePatientProtocol(client))?.name ?? resolvePatientProtocol(client).replace(/-/g, ' ')}
                    </div>
                  </td>
                  <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>
                    {formatLastSessionDate(client.lastSessionDate)}
                  </td>
                  <td style={{ padding: '14px 16px', fontWeight: 600 }}>
                    {client.completedSessionsCount ?? 0}
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px' }}>
                      {onMessageClient && <button type="button" onClick={(e) => { e.stopPropagation(); onMessageClient(client.id); }} className="btn btn-ghost" style={{ padding: '4px 6px', fontSize: '11px' }} aria-label={`Message ${client.name}`} title={`Message ${client.name}`}><MessageSquare size={14} /></button>}
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
                          onClick={(e) => void handleDelete(client.id, e)}
                          disabled={pendingActionId === client.id}
                          className="btn btn-ghost"
                          style={{ padding: '4px 6px', fontSize: '11px', color: 'var(--status-alert)' }}
                          title="Remove Patient"
                        >
                          {pendingActionId === client.id ? 'Removing…' : <Trash2 size={14} />}
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
                <PatientAvatar avatarUrl={client.avatarUrl} size={42} />
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span>{client.name}</span>
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
                {client.condition || 'Condition unavailable'}
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>
                Protocol: <strong>{getClinicalProtocolTemplate(resolvePatientProtocol(client))?.name ?? resolvePatientProtocol(client).replace(/-/g, ' ')}</strong>
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px', fontSize: '12px' }}>
              <div>
                <span style={{ color: 'var(--text-tertiary)' }}>Sessions: </span>
                <span style={{ fontWeight: 600 }}>{client.completedSessionsCount ?? 0}</span>
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {onMessageClient && <button type="button" onClick={(e) => { e.stopPropagation(); onMessageClient(client.id); }} className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '11px' }} aria-label={`Message ${client.name}`}><MessageSquare size={12} /> Message</button>}
                <button
                  onClick={(e) => handleOpenEdit(client, e)}
                  className="btn btn-ghost"
                  style={{ padding: '4px 8px', fontSize: '11px' }}
                >
                  <Edit size={12} /> Edit
                </button>
              </div>
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
              {editingClient ? 'Edit Patient Clinical Profile' : createdInvitation ? 'Invitation created' : 'Invite Patient'}
            </h3>
            {createdInvitation ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '14px', borderRadius: 'var(--radius-md)', background: 'var(--status-active-bg)', color: 'var(--status-active)' }}>
                  <CheckCircle2 size={20} />
                  <div style={{ fontSize: '13px' }}>Share this secure link with {createdInvitation.patientName}. They must sign in with {createdInvitation.patientEmail}. The invitation expires after 14 days.</div>
                </div>
                <div className="font-mono" style={{ padding: '16px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', textAlign: 'center', fontSize: '20px', letterSpacing: '0.08em' }}>{createdInvitation.id}</div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(invitationUrl(createdInvitation.id));
                      setCopiedCode(true);
                    } catch {
                      setFormError('Copy was blocked by your browser. Select the code above and copy it manually.');
                    }
                  }}
                  className="btn btn-secondary"
                >
                  <Copy size={15} /> {copiedCode ? 'Link copied' : 'Copy invitation link'}
                </button>
                {formError && <div role="alert" style={{ color: 'var(--status-alert)', fontSize: '12px' }}>{formError}</div>}
                <button type="button" onClick={() => setShowAddModal(false)} className="btn btn-dense">Done</button>
              </div>
            ) : <form onSubmit={handleSaveForm} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
                  required={!editingClient}
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
                  value={formCondition ?? ''}
                  onChange={(e) => setFormCondition((e.target.value || undefined) as ClientProfile['condition'])}
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
                  <option value="">Unavailable</option>
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
                    value={formProtocol ?? ''}
                    onChange={(e) => setFormProtocol((e.target.value || undefined) as ProtocolType | undefined)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-default)',
                      fontSize: '13px',
                      background: '#FFFFFF',
                    }}
                  >
                    <option value="">Use default (Theta/Beta)</option>
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
                  Weekly Training Target
                </label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={formSessionsPerWeek}
                  onChange={(e) => setFormSessionsPerWeek(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="Unavailable"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' }}
                />
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
                  disabled={isSaving}
                  className="btn btn-dense"
                  style={{ padding: '8px 16px', fontSize: '13px', opacity: isSaving ? 0.7 : 1 }}
                >
                  {isSaving ? 'Saving…' : editingClient ? 'Save Changes' : 'Create Invitation'}
                </button>
              </div>
              {formError && <div role="alert" style={{ color: 'var(--status-alert)', fontSize: '12px' }}>{formError}</div>}
            </form>}
          </div>
        </div>
      )}
    </div>
  );
};
