import React, { useEffect, useRef, useState } from 'react';
import type { SessionRecord } from '../../types';
import { storageEngine } from '../../services/storageEngine';
import { protocolDisplayName } from '../displayLabels';

interface Props {
  session: SessionRecord;
  onSaved: (sessionId: string, clinicianNotes: string | null) => void;
}

/** Stored values keep full precision; the review shows at most two decimals. */
const fact = (value: unknown, suffix = '') =>
  typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100) / 100}${suffix}` : 'Not recorded';

const sectionLabel: React.CSSProperties = { marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' };
const tableHeading: React.CSSProperties = { position: 'sticky', top: 0, padding: '6px 10px', background: 'var(--surface-clinician-sidebar)', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' };
const tableCell: React.CSSProperties = { padding: '4px 10px' };

const Fact: React.FC<{ term: string; wide?: boolean; children: React.ReactNode }> = ({ term, wide, children }) => (
  <div style={{ minWidth: 0, gridColumn: wide ? '1 / -1' : undefined }}>
    <dt style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{term}</dt>
    <dd style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{children}</dd>
  </div>
);

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
  const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  // Recorded facts form the grid; absent ones are named once in a muted line instead of a wall of "Not recorded".
  const facts: Array<{ term: string; value: React.ReactNode; recorded: boolean; wide?: boolean }> = [
    { term: 'Protocol', value: session.protocol ? protocolDisplayName(session.protocol) : 'Not recorded', recorded: !!session.protocol },
    { term: 'Acquisition', value: session.isDemo === true ? 'Training Demo · Synthetic acquisition' : session.isDemo === false ? 'Non-demo session' : 'Provenance not recorded', recorded: true },
    { term: 'Mood', value: session.moodRating == null ? 'Not recorded' : `${session.moodRating}/5`, recorded: session.moodRating != null },
    { term: 'Final threshold', value: fact(session.finalThreshold), recorded: isNumber(session.finalThreshold) },
    { term: 'Adaptive adjustments', value: fact(session.adaptiveAdjustmentsCount), recorded: isNumber(session.adaptiveAdjustmentsCount) },
    { term: 'Average training score', value: fact(session.averageTrainingScore), recorded: isNumber(session.averageTrainingScore) },
    { term: 'Average coherence', value: fact(session.averageCoherence, '%'), recorded: isNumber(session.averageCoherence) },
    { term: 'Peak focus', value: fact(session.peakFocusScore), recorded: isNumber(session.peakFocusScore) },
    { term: 'Average mindfulness', value: fact(session.averageMindfulness), recorded: isNumber(session.averageMindfulness) },
    { term: 'Average valence', value: fact(session.averageValence), recorded: isNumber(session.averageValence) },
    { term: 'Average arousal', value: fact(session.averageArousal), recorded: isNumber(session.averageArousal) },
    { term: 'Average band powers', wide: true, recorded: session.isDemo === true || !!session.averageBands, value: session.isDemo === true ? 'Not measured — synthetic Training Demo feedback' : session.averageBands
      ? `Theta ${fact(session.averageBands.theta)} · Alpha ${fact(session.averageBands.alpha)} · Beta ${fact(session.averageBands.beta)}`
      : 'Not recorded' },
    { term: 'Device', value: deviceText || 'Not recorded', recorded: !!deviceText, wide: true },
  ];
  const recordedFacts = facts.filter((item) => item.recorded);
  const missingFacts = facts.filter((item) => !item.recorded).map((item) => item.term);
  return <section aria-label={`Session ${session.id} details`} style={{ padding: '16px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: 'var(--surface-clinician-card)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
    <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px 16px', margin: 0 }}>
      {recordedFacts.map((item) => (
        <Fact key={item.term} term={item.term} wide={item.wide}>{item.value}</Fact>
      ))}
    </dl>
    {missingFacts.length > 0 && (
      <p style={{ margin: '-4px 0 0', fontSize: '12px', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
        <span style={{ fontWeight: 600 }}>Not recorded:</span> {missingFacts.join(', ')}
      </p>
    )}
    <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-clinician-sidebar)' }}>
      <div style={sectionLabel}>Patient reflection</div>
      <p style={{ margin: 0, maxWidth: '72ch', fontSize: '13px', lineHeight: 1.55, color: session.patientNotes ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{session.patientNotes || 'Not recorded'}</p>
    </div>
    <div>
      <h4 style={{ ...sectionLabel, margin: '0 0 6px' }}>Recorded points{points.length > 0 ? ` (${points.length})` : ''}</h4>
      {points.length === 0 ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-tertiary)' }}>No recorded points for this session.</p> : <div className="scroll-x" style={{ overflow: 'auto', maxHeight: '280px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        <thead><tr>{['Time (s)', 'Theta/beta', 'Alpha', 'SMR', 'Beta', 'In zone'].map((heading) => <th key={heading} scope="col" style={tableHeading}>{heading}</th>)}</tr></thead>
        <tbody>{points.map((point, index) => <tr key={`${point.t}-${index}`} style={{ borderTop: '1px solid var(--border-subtle)' }}><td style={tableCell}>{fact(point.t)}</td><td style={tableCell}>{fact(point.thetaBetaRatio)}</td><td style={tableCell}>{fact(point.alpha)}</td><td style={tableCell}>{fact(point.smr)}</td><td style={tableCell}>{fact(point.beta)}</td><td style={tableCell}>{typeof point.inZone === 'boolean' ? (point.inZone ? 'Yes' : 'No') : 'Not recorded'}</td></tr>)}</tbody>
      </table></div>}
    </div>
    <div>
      <label htmlFor={`feedback-${session.id}`} style={{ ...sectionLabel, display: 'block' }}>Clinician feedback</label>
      <textarea id={`feedback-${session.id}`} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={pending} style={{ width: '100%', minHeight: '72px', padding: '10px 12px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', font: 'inherit', fontSize: '13px', resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}><button type="button" className="btn btn-dense" disabled={pending} onClick={() => save()}>Save feedback</button><button type="button" className="btn btn-ghost" style={{ fontSize: '13px' }} disabled={pending || (!draft && !session.clinicianNotes)} onClick={() => save(true)}>Clear feedback</button></div>
      {error && <p role="alert" style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--status-alert)' }}>Feedback could not be saved. Your draft is still here; try again.</p>}
    </div>
  </section>;
};
