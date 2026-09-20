import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Calendar, Clock, Edit3, Plus, RefreshCw, XCircle } from 'lucide-react';
import type { CalendarAppointment, ClientProfile, AppointmentType } from '../../types';
import { appointmentRepository, createAppointmentRequestId, createCancellationRequestId, type AppointmentRepository } from '../../features/appointments/appointmentRepository';
import { formatAppointmentDateTime, getDefaultTimezone, getLocalAppointmentParts } from '../../features/appointments/appointmentTime';
import { isCanonicalAppointment, type AppointmentDraft, type AppointmentRecord, type AppointmentTimeDisambiguation, type ProductionAppointment } from '../../features/appointments/appointmentTypes';
import { applyConfirmedAppointment, resolveAppointmentSurfaceState } from '../../features/appointments/appointmentViewState';

interface ClinicalCalendarViewProps {
  clients: ClientProfile[];
  /** @deprecated A1 reads canonical appointments from its repository. */
  appointments?: CalendarAppointment[];
  /** @deprecated A1 persists through its repository and awaits confirmation. */
  onSaveAppointment?: (appointment: CalendarAppointment) => void;
  /** @deprecated Cancellation preserves an auditable appointment record. */
  onDeleteAppointment?: (id: string) => void;
  onSelectClient?: (client: ClientProfile) => void;
  onOpenMessages?: (clientId: string) => void;
  preSelectedClientId?: string;
  repository?: AppointmentRepository;
  initialTimezone?: string;
}

const APPOINTMENT_TYPES: Array<{ value: AppointmentType; label: string }> = [
  { value: 'remote-training', label: 'Remote training' },
  { value: 'in-clinic-evaluation', label: 'In-clinic evaluation' },
  { value: 'qeeg-mapping', label: 'QEEG mapping' },
  { value: 'protocol-review', label: 'Protocol review' },
  { value: 'consultation', label: 'Consultation' },
];
const fieldStyle: React.CSSProperties = { width: '100%', padding: '9px 10px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', background: '#fff', color: 'var(--text-primary)', fontSize: '13px' };

function todayInTimezone(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts()
    .reduce<Record<string, string>>((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function getErrorMessage(error: unknown): string { return error instanceof Error ? error.message : 'The appointment operation failed. Try again'; }

export const ClinicalCalendarView: React.FC<ClinicalCalendarViewProps> = ({ clients, preSelectedClientId, repository = appointmentRepository, initialTimezone = getDefaultTimezone() }) => {
  const productionClients = useMemo(() => clients.filter((client) => !client.isDemo && !client.id.startsWith('demo-')), [clients]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [saving, setSaving] = useState(false);
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(() => new Set());
  const [cancelErrors, setCancelErrors] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ProductionAppointment | null>(null);
  const mountedRef = useRef(true);
  const loadRequestRef = useRef(0);
  const viewGenerationRef = useRef(0);
  const cancellationOperations = useRef(new Map<string, { expectedRevision: number; requestId: string }>());
  const [draft, setDraft] = useState<AppointmentDraft>(() => ({ requestId: '', patientId: preSelectedClientId ?? '', localDate: todayInTimezone(initialTimezone), localTime: '10:00', timezone: initialTimezone, timeDisambiguation: 'reject', durationMinutes: 45, type: 'remote-training', notes: '' }));

  const load = useCallback(async () => {
    const request = ++loadRequestRef.current;
    ++viewGenerationRef.current;
    setLoadState('loading'); setLoadError(''); setCancellingIds(new Set());
    try {
      const loaded = await repository.list('clinician');
      if (!mountedRef.current || request !== loadRequestRef.current) return;
      cancellationOperations.current.clear(); setCancelErrors({}); setAppointments(loaded); setLoadState('ready');
    } catch (error) {
      if (!mountedRef.current || request !== loadRequestRef.current) return;
      setLoadError(getErrorMessage(error)); setLoadState('error');
    }
  }, [repository]);
  useEffect(() => {
    const request = ++loadRequestRef.current;
    ++viewGenerationRef.current;
    let active = true;
    repository.list('clinician').then((loaded) => {
      if (!active || request !== loadRequestRef.current) return;
      setAppointments(loaded);
      setLoadState('ready');
    }).catch((error: unknown) => {
      if (!active || request !== loadRequestRef.current) return;
      setLoadError(getErrorMessage(error));
      setLoadState('error');
    });
    return () => { active = false; };
  }, [repository]);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const openCreate = () => {
    const patient = productionClients.find((client) => client.id === preSelectedClientId) ?? productionClients[0];
    let requestId: string;
    try { requestId = createAppointmentRequestId(); }
    catch (error) { setActionError(getErrorMessage(error)); return; }
    setEditing(null);
    setDraft({ requestId, patientId: patient?.id ?? '', localDate: todayInTimezone(initialTimezone), localTime: '10:00', timezone: initialTimezone, timeDisambiguation: 'reject', durationMinutes: 45, type: 'remote-training', notes: '' });
    setActionError(''); setShowForm(true);
  };
  const openEdit = (appointment: ProductionAppointment) => {
    const local = getLocalAppointmentParts(appointment.startsAtMillis, appointment.timezone);
    setEditing(appointment);
    setDraft({ requestId: appointment.id, patientId: appointment.patientId, localDate: local.date, localTime: local.time, timezone: appointment.timezone, timeDisambiguation: 'reject', durationMinutes: appointment.durationMinutes, type: appointment.type, notes: appointment.notes ?? '' });
    setActionError(''); setShowForm(true);
  };
  const save = async (event: React.FormEvent) => {
    const generation = viewGenerationRef.current;
    event.preventDefault(); setSaving(true); setActionError('');
    try {
      const saved = editing ? await repository.edit(editing.id, draft, editing.revision) : await repository.create(draft);
      if (!mountedRef.current || generation !== viewGenerationRef.current) return;
      setAppointments((current) => applyConfirmedAppointment(current, saved));
      setShowForm(false); setEditing(null);
    } catch (error) { if (mountedRef.current && generation === viewGenerationRef.current) setActionError(getErrorMessage(error)); }
    finally { if (mountedRef.current && generation === viewGenerationRef.current) setSaving(false); }
  };
  const cancel = async (appointment: ProductionAppointment) => {
    if (!window.confirm('Cancel this appointment? It will remain visible as cancelled for both participants.')) return;
    let operation = cancellationOperations.current.get(appointment.id);
    if (!operation) {
      try { operation = { expectedRevision: appointment.revision, requestId: createCancellationRequestId() }; }
      catch (error) { setCancelErrors((current) => ({ ...current, [appointment.id]: getErrorMessage(error) })); return; }
    }
    cancellationOperations.current.set(appointment.id, operation);
    const generation = viewGenerationRef.current;
    setCancellingIds((current) => new Set(current).add(appointment.id));
    setCancelErrors((current) => { const next = { ...current }; delete next[appointment.id]; return next; });
    try {
      const saved = await repository.cancel(appointment.id, operation.expectedRevision, operation.requestId);
      if (!mountedRef.current || generation !== viewGenerationRef.current) return;
      cancellationOperations.current.delete(appointment.id);
      setAppointments((current) => applyConfirmedAppointment(current, saved));
    } catch (error) {
      if (mountedRef.current && generation === viewGenerationRef.current) setCancelErrors((current) => ({ ...current, [appointment.id]: getErrorMessage(error) }));
    } finally {
      if (mountedRef.current && generation === viewGenerationRef.current) setCancellingIds((current) => { const next = new Set(current); next.delete(appointment.id); return next; });
    }
  };

  const surface = resolveAppointmentSurfaceState(loadState, appointments, loadError);
  if (surface.kind === 'loading') return <div className="card-clinician" role="status" style={{ padding: 32, textAlign: 'center' }}>Loading appointments…</div>;
  if (surface.kind === 'error') return <div className="card-clinician" role="alert" style={{ padding: 32, textAlign: 'center' }}><AlertCircle size={28} style={{ margin: '0 auto 8px' }} /><div>Appointments could not be loaded.</div><div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>{surface.message}</div><button className="btn btn-dense" onClick={() => void load()} style={{ marginTop: 12 }}><RefreshCw size={14} /> Retry</button></div>;

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><div><h1 style={{ margin: 0, fontSize: 22 }}>Clinical appointments</h1><p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 12 }}>Times are stored as exact instants and displayed in each appointment’s timezone.</p></div><button className="btn btn-dense" onClick={openCreate} disabled={productionClients.length === 0}><Plus size={16} /> Schedule appointment</button></div>
    {actionError && !showForm && <div role="alert" className="card-clinician" style={{ padding: 12, color: 'var(--status-alert)' }}><AlertCircle size={14} /> {actionError}</div>}
    {appointments.length === 0 ? <div className="card-clinician" style={{ padding: 36, textAlign: 'center' }}><Calendar size={34} style={{ opacity: 0.45, margin: '0 auto 8px' }} /><div style={{ fontWeight: 600 }}>No appointments scheduled</div><div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>{productionClients.length ? 'Schedule the first appointment when you are ready.' : 'Link a production patient before scheduling an appointment.'}</div></div> : appointments.map((appointment) => <article key={appointment.id} className="card-clinician" style={{ padding: 16, opacity: appointment.status === 'cancelled' ? 0.7 : 1 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}><div><div style={{ fontWeight: 650 }}>{appointment.patientDisplayName}</div>{isCanonicalAppointment(appointment) ? <><div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, color: 'var(--text-secondary)', fontSize: 12 }}><Clock size={13} /> {formatAppointmentDateTime(appointment.startsAtMillis, appointment.timezone)} · {appointment.durationMinutes} min</div><div style={{ marginTop: 5, fontSize: 12 }}>{APPOINTMENT_TYPES.find((item) => item.value === appointment.type)?.label} · {appointment.timezone}</div></> : <><div style={{ marginTop: 5, fontSize: 12 }}><Clock size={13} /> {appointment.legacyDate} {appointment.legacyTime}{appointment.durationMinutes ? ` · ${appointment.durationMinutes} min` : ''}</div><div role="note" style={{ marginTop: 5, color: 'var(--status-alert)', fontSize: 12 }}>{appointment.readOnlyReason}</div></>}<div style={{ marginTop: 6, fontSize: 11, textTransform: 'capitalize', color: appointment.status === 'cancelled' ? 'var(--status-alert)' : 'var(--text-secondary)' }}>{appointment.status}</div>{appointment.notes && <div style={{ marginTop: 7, fontSize: 12, color: 'var(--text-secondary)' }}>{appointment.notes}</div>}{cancelErrors[appointment.id] && <div role="alert" style={{ marginTop: 7, fontSize: 12, color: 'var(--status-alert)' }}>{cancelErrors[appointment.id]} <button className="btn btn-ghost" onClick={() => void load()}>Reload calendar</button></div>}</div><div style={{ display: 'flex', gap: 8 }}>{isCanonicalAppointment(appointment) && appointment.status === 'scheduled' && <><button className="btn btn-ghost" onClick={() => openEdit(appointment)}><Edit3 size={14} /> Edit</button><button className="btn btn-ghost" disabled={cancellingIds.has(appointment.id)} onClick={() => void cancel(appointment)} style={{ color: 'var(--status-alert)' }}><XCircle size={14} /> {cancellingIds.has(appointment.id) ? 'Cancelling…' : 'Cancel'}</button></>}</div></div></article>)}
    {showForm && <div role="dialog" aria-modal="true" aria-label={editing ? 'Edit appointment' : 'Schedule appointment'} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(20,20,20,.55)', display: 'grid', placeItems: 'center', padding: 16 }}><form onSubmit={(event) => void save(event)} className="card-clinician" style={{ background: '#fff', width: 'min(560px, 100%)', maxHeight: '90vh', overflow: 'auto', padding: 24, display: 'grid', gap: 13 }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2 style={{ margin: 0, fontSize: 18 }}>{editing ? 'Edit appointment' : 'Schedule appointment'}</h2><button type="button" className="btn btn-ghost" disabled={saving} onClick={() => setShowForm(false)}>✕</button></div>
      <label style={{ fontSize: 12, fontWeight: 600 }}>Patient<select style={fieldStyle} value={draft.patientId} disabled={Boolean(editing)} required onChange={(event) => setDraft((current) => ({ ...current, patientId: event.target.value }))}><option value="">Select a linked patient</option>{productionClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}><label style={{ fontSize: 12, fontWeight: 600 }}>Date<input style={fieldStyle} type="date" required value={draft.localDate} onChange={(event) => setDraft((current) => ({ ...current, localDate: event.target.value }))} /></label><label style={{ fontSize: 12, fontWeight: 600 }}>Local time<input style={fieldStyle} type="time" required value={draft.localTime} onChange={(event) => setDraft((current) => ({ ...current, localTime: event.target.value }))} /></label></div>
      <label style={{ fontSize: 12, fontWeight: 600 }}>IANA timezone<input style={fieldStyle} required value={draft.timezone} onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))} placeholder="America/Toronto" /></label>
      <label style={{ fontSize: 12, fontWeight: 600 }}>If the clock repeats this time<select style={fieldStyle} value={draft.timeDisambiguation} onChange={(event) => setDraft((current) => ({ ...current, timeDisambiguation: event.target.value as AppointmentTimeDisambiguation }))}><option value="reject">Ask me to choose</option><option value="earlier">Use first occurrence</option><option value="later">Use second occurrence</option></select></label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}><label style={{ fontSize: 12, fontWeight: 600 }}>Duration (minutes)<input style={fieldStyle} type="number" min={15} max={240} step={5} required value={draft.durationMinutes} onChange={(event) => setDraft((current) => ({ ...current, durationMinutes: Number(event.target.value) }))} /></label><label style={{ fontSize: 12, fontWeight: 600 }}>Type<select style={fieldStyle} value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value as AppointmentType }))}>{APPOINTMENT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
      <label style={{ fontSize: 12, fontWeight: 600 }}>Notes<textarea style={{ ...fieldStyle, minHeight: 76, resize: 'vertical' }} maxLength={2000} value={draft.notes ?? ''} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
      {actionError && <div role="alert" style={{ color: 'var(--status-alert)', fontSize: 12 }}><AlertCircle size={14} /> {actionError}</div>}<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button type="button" className="btn btn-ghost" disabled={saving} onClick={() => setShowForm(false)}>Close</button><button className="btn btn-dense" disabled={saving || !draft.patientId}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create appointment'}</button></div>
    </form></div>}
  </div>;
};
