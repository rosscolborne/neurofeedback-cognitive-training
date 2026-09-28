import React, { useEffect, useRef, useState } from 'react';
import type { SessionRecord } from '../../types';
import { storageEngine } from '../../services/storageEngine';

interface Props {
  session: SessionRecord;
  onSaved: (sessionId: string, clinicianNotes: string | null) => void;
}

const fact = (value: unknown, suffix = '') =>
  typeof value === 'number' && Number.isFinite(value) ? `${value}${suffix}` : 'Not recorded';
const label = (value: string | undefined) => value ? value.replace(/-/g, ' ') : 'Not recorded';

/** Displays stored session facts. Threshold samples are not part of the session schema. */
export const ClinicianSessionDetail: React.FC<Props> = ({ session, onSaved }) => {
  const [draft, setDraft] = useState(session.clinicianNotes || '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const save = async (clear = false) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(false);
    const next = clear ? null : draft;
    try {
      await storageEngine.patchSessionNotes(session.id, { clinicianNotes: next });
      if (mounted.current) setDraft(next || '');
      onSaved(session.id, next);
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  };

  const points = Array.isArray(session.timeSeries) ? session.timeSeries : [];
  const device = session.device;
  const deviceText = device && [device.model, device.deviceId, device.firmwareVersion && `firmware ${device.firmwareVersion}`, typeof device.sampleRateHz === 'number' && Number.isFinite(device.sampleRateHz) && `${device.sampleRateHz} Hz`, device.transport].filter(Boolean).join(' · ');
  return <section aria-label={`Session ${session.id} details`} style={{ padding: '14px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', marginTop: '8px' }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px', fontSize: '12px' }}>
      <div><strong>Protocol:</strong> {label(session.protocol)}</div>
      <div><strong>Acquisition:</strong> {session.isDemo === true ? 'Training Demo · Synthetic acquisition' : session.isDemo === false ? 'Non-demo session' : 'Provenance not recorded'}</div>
      <div><strong>Device:</strong> {deviceText || 'Not recorded'}</div>
      <div><strong>Final threshold:</strong> {fact(session.finalThreshold)}</div>
      <div><strong>Adaptive adjustments:</strong> {fact(session.adaptiveAdjustmentsCount)}</div>
      <div><strong>Peak focus:</strong> {fact(session.peakFocusScore)}</div>
      <div><strong>Average training score:</strong> {fact(session.averageTrainingScore)}</div>
      <div><strong>Average coherence:</strong> {fact(session.averageCoherence, '%')}</div>
      <div><strong>Average mindfulness:</strong> {fact(session.averageMindfulness)}</div>
      <div><strong>Average valence:</strong> {fact(session.averageValence)}</div>
      <div><strong>Average arousal:</strong> {fact(session.averageArousal)}</div>
      <div><strong>Average band powers:</strong> {session.isDemo === true ? 'Not measured — synthetic Training Demo feedback' : session.averageBands
        ? `Theta ${fact(session.averageBands.theta)} · Alpha ${fact(session.averageBands.alpha)} · Beta ${fact(session.averageBands.beta)}`
        : 'Not recorded'}</div>
      <div><strong>Mood:</strong> {session.moodRating == null ? 'Not recorded' : `${session.moodRating}/5`}</div>
      <div><strong>Patient reflection:</strong> {session.patientNotes || 'Not recorded'}</div>
    </div>
    <h4 style={{ fontSize: '13px', marginBottom: '4px' }}>Recorded points</h4>
    {points.length === 0 ? <p>No recorded points for this session.</p> : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', fontSize: '12px', textAlign: 'left' }}>
      <thead><tr><th>Time (s)</th><th>Theta/beta ratio</th><th>Alpha</th><th>SMR</th><th>Beta</th><th>In zone</th></tr></thead>
      <tbody>{points.map((point, index) => <tr key={`${point.t}-${index}`}><td>{fact(point.t)}</td><td>{fact(point.thetaBetaRatio)}</td><td>{fact(point.alpha)}</td><td>{fact(point.smr)}</td><td>{fact(point.beta)}</td><td>{typeof point.inZone === 'boolean' ? (point.inZone ? 'Yes' : 'No') : 'Not recorded'}</td></tr>)}</tbody>
    </table></div>}
    <div style={{ marginTop: '12px' }}>
      <label htmlFor={`feedback-${session.id}`} style={{ display: 'block', fontWeight: 600, fontSize: '12px' }}>Clinician feedback</label>
      <textarea id={`feedback-${session.id}`} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={pending} style={{ width: '100%', minHeight: '64px' }} />
      <div style={{ display: 'flex', gap: '8px' }}><button type="button" className="btn btn-secondary" disabled={pending} onClick={() => save()}>Save feedback</button><button type="button" className="btn btn-ghost" disabled={pending || (!draft && !session.clinicianNotes)} onClick={() => save(true)}>Clear feedback</button></div>
      {error && <p role="alert">Feedback could not be saved. Your draft is still here; try again.</p>}
    </div>
  </section>;
};
