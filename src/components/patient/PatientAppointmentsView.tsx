import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Calendar, Clock, RefreshCw } from 'lucide-react';
import { appointmentRepository, type AppointmentRepository } from '../../features/appointments/appointmentRepository';
import { formatAppointmentDateTime } from '../../features/appointments/appointmentTime';
import { isCanonicalAppointment, type AppointmentRecord } from '../../features/appointments/appointmentTypes';
import { resolveAppointmentSurfaceState } from '../../features/appointments/appointmentViewState';

interface PatientAppointmentsViewProps { repository?: AppointmentRepository; }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Appointments could not be loaded';

export const PatientAppointmentsView: React.FC<PatientAppointmentsViewProps> = ({ repository = appointmentRepository }) => {
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const mountedRef = useRef(true);
  const loadRequestRef = useRef(0);
  const load = useCallback(async () => {
    const request = ++loadRequestRef.current;
    setState('loading'); setError('');
    try {
      const loaded = await repository.list('patient');
      if (!mountedRef.current || request !== loadRequestRef.current) return;
      setAppointments(loaded); setState('ready');
    } catch (reason) {
      if (!mountedRef.current || request !== loadRequestRef.current) return;
      setError(errorMessage(reason)); setState('error');
    }
  }, [repository]);
  useEffect(() => {
    const request = ++loadRequestRef.current;
    let active = true;
    repository.list('patient').then((loaded) => {
      if (!active || request !== loadRequestRef.current) return;
      setAppointments(loaded);
      setState('ready');
    }).catch((reason: unknown) => {
      if (!active || request !== loadRequestRef.current) return;
      setError(errorMessage(reason));
      setState('error');
    });
    return () => { active = false; };
  }, [repository]);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const surface = resolveAppointmentSurfaceState(state, appointments, error);
  if (surface.kind === 'loading') return <div role="status" className="patient-card" style={{ padding: 28, textAlign: 'center' }}>Loading appointments…</div>;
  if (surface.kind === 'error') return <div role="alert" className="patient-card" style={{ padding: 28, textAlign: 'center' }}><AlertCircle size={28} style={{ margin: '0 auto 8px' }} /><div>Appointments could not be loaded.</div><div style={{ marginTop: 4, fontSize: 12 }}>{surface.message}</div><button className="btn btn-dense" onClick={() => void load()} style={{ marginTop: 12 }}><RefreshCw size={14} /> Retry</button></div>;
  if (surface.kind === 'empty') return <div className="patient-card" style={{ padding: 32, textAlign: 'center' }}><Calendar size={34} style={{ opacity: 0.45, margin: '0 auto 8px' }} /><div style={{ fontWeight: 650 }}>No appointments scheduled</div><div style={{ fontSize: 12, marginTop: 4, opacity: 0.7 }}>New appointments from your linked clinician will appear here.</div></div>;

  return <section aria-label="Appointments" style={{ display: 'grid', gap: 12 }}><h1 style={{ margin: 0, fontSize: 22 }}>Appointments</h1>{appointments.map((appointment) => <article key={appointment.id} className="patient-card" style={{ padding: 16, opacity: appointment.status === 'cancelled' ? 0.68 : 1 }}><div style={{ fontWeight: 650, textTransform: 'capitalize' }}>{appointment.type?.replaceAll('-', ' ') ?? 'Legacy appointment'}</div>{isCanonicalAppointment(appointment) ? <><div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginTop: 6 }}><Clock size={14} /> {formatAppointmentDateTime(appointment.startsAtMillis, appointment.timezone)} · {appointment.durationMinutes} min</div><div style={{ fontSize: 12, marginTop: 5 }}>{appointment.timezone}</div>{appointment.clinicianDisplayName && <div style={{ fontSize: 12, marginTop: 5 }}>With {appointment.clinicianDisplayName}</div>}</> : <><div style={{ fontSize: 13, marginTop: 6 }}><Clock size={14} /> {appointment.legacyDate} {appointment.legacyTime}</div><div role="note" style={{ fontSize: 12, marginTop: 5 }}>{appointment.readOnlyReason}</div></>}<div style={{ fontSize: 12, marginTop: 5, textTransform: 'capitalize' }}>{appointment.status}</div>{appointment.notes && <div style={{ fontSize: 12, marginTop: 8, opacity: 0.75 }}>{appointment.notes}</div>}</article>)}</section>;
};
