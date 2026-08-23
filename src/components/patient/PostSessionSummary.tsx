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

  const handleSave = () => {
    session.moodRating = selectedMood;
    session.patientNotes = patientNotes;
    storageEngine.saveSession(session);
    setIsSaved(true);
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const timeSeries = session.timeSeries || [];
  const points = timeSeries.map((d, i) => {
    const x = (i / Math.max(1, timeSeries.length - 1)) * 340 + 20;
    const y = 130 - (d.inZone ? 75 : 35) + Math.sin(i * 0.8) * 12;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        maxWidth: '520px',
        margin: '0 auto',
        backgroundColor: 'var(--surface-patient-base)',
        padding: '24px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
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
          Session data synchronized with your clinician portal.
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

      {/* Key Insights Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sparkles size={16} color="var(--brand-primary)" />
          <span>Session Neuroplastic Insights</span>
        </div>
        <div className="card-patient-recessed" style={{ fontSize: '13px', lineHeight: 1.5, color: 'var(--text-primary)' }}>
          • Theta band suppression remained consistent throughout the mid-session window.<br />
          • Reached peak focus stability for 8 consecutive minutes without threshold relaxation.<br />
          • SMR rhythm showed a 14% elevation above baseline calibration.
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

      {/* Bottom Action Buttons */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '10px', marginBottom: '20px' }}>
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
