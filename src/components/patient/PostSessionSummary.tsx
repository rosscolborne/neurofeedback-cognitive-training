import React, { useState } from 'react';
import { SessionRecord } from '../../types';
import { storageEngine } from '../../services/storageEngine';
import { CheckCircle, ArrowRight, Sparkles, Heart } from 'lucide-react';
import confetti from 'canvas-confetti';

interface PostSessionSummaryProps {
  session: SessionRecord;
  onViewProgress: () => void;
  onDone: () => void;
}

const MOODS: Array<{ value: 1 | 2 | 3 | 4 | 5; label: string; score: string }> = [
  { value: 1, label: 'Tense', score: '1/5' },
  { value: 2, label: 'Neutral', score: '2/5' },
  { value: 3, label: 'Calm', score: '3/5' },
  { value: 4, label: 'Focused', score: '4/5' },
  { value: 5, label: 'Flow State', score: '5/5' },
];

export const PostSessionSummary: React.FC<PostSessionSummaryProps> = ({
  session,
  onViewProgress,
  onDone,
}) => {
  const [selectedMood, setSelectedMood] = useState<1 | 2 | 3 | 4 | 5 | undefined>(session.moodRating || 4);
  const [patientNotes, setPatientNotes] = useState(session.patientNotes || '');
  const [isSaved, setIsSaved] = useState(false);

  React.useEffect(() => {
    confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.6 },
      colors: ['#E8967A', '#E4B87C', '#7B68AE', '#5C8C46'],
    });
  }, []);

  const handleSave = async () => {
    session.moodRating = selectedMood;
    session.patientNotes = patientNotes;
    await storageEngine.saveSession(session);
    setIsSaved(true);
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const timeSeries = session.timeSeries || [];

  // Compute chart from REAL recorded data — theta/beta ratio over time
  // Find min/max for proper Y-axis scaling
  const ratioValues = timeSeries.map(d => d.thetaBetaRatio);
  const dataMin = ratioValues.length > 0 ? Math.min(...ratioValues) : 0;
  const dataMax = ratioValues.length > 0 ? Math.max(...ratioValues) : 3;
  const yRange = Math.max(0.5, dataMax - dataMin); // Avoid division by zero
  const chartPadding = yRange * 0.1;

  const points = timeSeries.map((d, i) => {
    const x = (i / Math.max(1, timeSeries.length - 1)) * 340 + 20;
    // Map real thetaBetaRatio to Y pixel: lower ratio = higher on chart (better)
    const normalized = (d.thetaBetaRatio - (dataMin - chartPadding)) / (yRange + 2 * chartPadding);
    const y = 20 + normalized * 120; // 20px top margin, 120px chart height
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <div
      style={{
        width: '100%',
        height: '100dvh',
        maxWidth: '520px',
        margin: '0 auto',
        backgroundColor: 'var(--surface-patient-base)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header Banner */}
      <div style={{ textAlign: 'center', marginTop: '10px' }}>
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            backgroundColor: 'var(--brand-primary-subtle)',
            color: 'var(--brand-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px auto',
          }}
        >
          <CheckCircle size={32} />
        </div>
        <h1 className="font-display" style={{ fontSize: '28px', color: 'var(--text-primary)', fontWeight: 400 }}>
          Session Complete
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
          Your session data has been saved.
        </p>
      </div>

      {/* Primary Metrics Card */}
      <div className="card-patient" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Session duration</span>
          <span className="font-mono" style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
            {formatDuration(session.durationSeconds)}
          </span>
        </div>
        <div style={{ height: '1px', background: 'var(--border-subtle)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Time in target training zone</span>
          <span className="font-mono" style={{ fontSize: '16px', fontWeight: 700, color: 'var(--brand-primary)' }}>
            {session.timeInZonePercent}%
          </span>
        </div>
        {session.averageTrainingScore != null && (
          <>
            <div style={{ height: '1px', background: 'var(--border-subtle)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Training score (baseline-relative)</span>
              <span className="font-mono" style={{ fontSize: '16px', fontWeight: 700, color: '#7B68AE' }}>
                {session.averageTrainingScore}
              </span>
            </div>
          </>
        )}
        {session.averageMindfulness != null && (
          <>
            <div style={{ height: '1px', background: 'var(--border-subtle)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Average mindfulness</span>
              <span className="font-mono" style={{ fontSize: '16px', fontWeight: 600, color: '#7B68AE' }}>
                {session.averageMindfulness}
              </span>
            </div>
          </>
        )}
        {(session.averageValence != null || session.averageArousal != null) && (
          <>
            <div style={{ height: '1px', background: 'var(--border-subtle)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Valence / Arousal</span>
              <span className="font-mono" style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {session.averageValence?.toFixed(2) ?? '—'} / {session.averageArousal?.toFixed(2) ?? '—'}
              </span>
            </div>
          </>
        )}
        <div style={{ height: '1px', background: 'var(--border-subtle)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Inter-hemispheric coherence</span>
          <span className="font-mono" style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
            {session.averageCoherence}%
          </span>
        </div>
      </div>

      {/* Performance Time-Series Chart */}
      <div className="card-patient" style={{ padding: '16px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
          Neural Stability Trajectory & In-Zone Windows
        </div>
        <svg viewBox="0 0 380 150" style={{ width: '100%', height: '130px', overflow: 'visible' }}>
          <defs>
            <linearGradient id="chartGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#E8967A" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#E8967A" stopOpacity="0.0" />
            </linearGradient>
          </defs>
          <polygon
            points={`20,140 ${points} 360,140`}
            fill="url(#chartGrad)"
          />
          <polyline
            fill="none"
            stroke="#E8967A"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
          />
          <line x1="20" y1="140" x2="360" y2="140" stroke="var(--border-default)" strokeWidth="1" />
        </svg>
      </div>

      {/* Key Insights Section — computed from real session data */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sparkles size={16} color="var(--brand-primary)" />
          <span>Session Summary</span>
        </div>
        <div className="card-patient-recessed" style={{ fontSize: '13px', lineHeight: 1.5, color: 'var(--text-primary)' }}>
          • Trained for {Math.round(session.durationSeconds / 60)} minutes using {session.protocol.replace(/-/g, ' ')} protocol.<br />
          • Spent {session.timeInZonePercent}% of active training time in the target neural zone.<br />
          • Average band powers: θ={session.averageBands.theta.toFixed(1)} µV, α={session.averageBands.alpha.toFixed(1)} µV, SMR={session.averageBands.smr.toFixed(1)} µV, β={session.averageBands.beta.toFixed(1)} µV.<br />
          {session.averageMindfulness != null && (
            <>• Average mindfulness score: {session.averageMindfulness}/100.<br /></>
          )}
          {session.averageTrainingScore != null && (
            <>• Training score (baseline-relative): {session.averageTrainingScore}/100.<br /></>
          )}
          {session.adaptiveAdjustmentsCount > 0 && (
            <>• Adaptive engine made {session.adaptiveAdjustmentsCount} threshold adjustment{session.adaptiveAdjustmentsCount > 1 ? 's' : ''} (final threshold: {session.finalThreshold.toFixed(2)}).<br /></>
          )}
          • {timeSeries.length} data points recorded over the session.
        </div>
      </div>

      {/* Clinical Subjective Mood Check-in */}
      <div className="card-patient" style={{ padding: '16px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Heart size={15} color="var(--brand-primary)" />
          <span>Subjective Mental State Rating</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
          {MOODS.map(m => (
            <button
              key={m.value}
              onClick={() => setSelectedMood(m.value)}
              style={{
                background: selectedMood === m.value ? 'var(--brand-primary-subtle)' : 'var(--surface-patient-recessed)',
                border: selectedMood === m.value ? '1.5px solid var(--brand-primary)' : '1px solid transparent',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 4px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <div className="font-mono" style={{ fontSize: '13px', fontWeight: 700, color: selectedMood === m.value ? 'var(--brand-primary)' : 'var(--text-primary)' }}>
                {m.score}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', fontWeight: 500 }}>
                {m.label}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Patient Notes */}
      <div className="card-patient" style={{ padding: '16px' }}>
        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
          Personal Training Journal (Optional)
        </label>
        <textarea
          value={patientNotes}
          onChange={e => setPatientNotes(e.target.value)}
          placeholder="Note any cognitive sensations, focus shifts, or ambient environment details..."
          style={{
            width: '100%',
            height: '65px',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 10px',
            fontFamily: 'var(--font-body)',
            fontSize: '13px',
            color: 'var(--text-primary)',
            backgroundColor: 'var(--surface-patient-recessed)',
            resize: 'none',
            outline: 'none',
          }}
        />
      </div>

      </div>

      {/* Bottom Action Buttons */}
      <div style={{ 
        padding: '16px 20px', 
        paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        background: 'var(--surface-patient-card)',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex', 
        gap: '12px',
        flexShrink: 0,
        zIndex: 10
      }}>
        <button
          onClick={handleSave}
          className="btn btn-secondary"
          style={{ flex: 1 }}
        >
          {isSaved ? 'Saved ✓' : 'Save Notes'}
        </button>
        <button
          onClick={onViewProgress}
          className="btn btn-primary"
          style={{ flex: 1.5 }}
        >
          View Progress <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};
