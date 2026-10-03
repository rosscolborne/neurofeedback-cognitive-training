import React, { useEffect, useRef, useState } from 'react';
import { SessionRecord } from '../../types';
import { storageEngine } from '../../services/storageEngine';
import { MOODS } from './sessionMoods';
import { FactGrid, type Fact } from '../ui/FactGrid';
import { CheckCircle, ArrowRight, Heart } from 'lucide-react';

interface PostSessionSummaryProps {
  session: SessionRecord;
  onViewProgress: () => void;
}

const PostSessionSummaryContent: React.FC<PostSessionSummaryProps> = ({
  session,
  onViewProgress,
}) => {
  const [selectedMood, setSelectedMood] = useState<1 | 2 | 3 | 4 | 5 | undefined>(session.moodRating);
  const [patientNotes, setPatientNotes] = useState(session.patientNotes || '');
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const [savedJournal, setSavedJournal] = useState({ moodRating: session.moodRating, patientNotes: session.patientNotes || '' });
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const hasJournalChanges = selectedMood !== savedJournal.moodRating || patientNotes !== savedJournal.patientNotes;

  const handleSave = async (navigate = false) => {
    if (pending.current) return;
    if (!hasJournalChanges) {
      if (navigate) onViewProgress();
      else setIsSaved(true);
      return;
    }
    pending.current = true;
    const savedSessionId = session.id;
    setIsSaving(true);
    setSaveError(null);
    try {
      await storageEngine.patchSessionNotes(savedSessionId, { moodRating: selectedMood, patientNotes });
      if (!mounted.current) return;
      setSavedJournal({ moodRating: selectedMood, patientNotes });
      setIsSaved(true);
      if (navigate) onViewProgress();
    } catch (error) {
      if (!mounted.current) return;
      console.error('Failed to save session notes:', error);
      setSaveError("We couldn't save your notes. Check your connection and try again.");
    } finally {
      if (mounted.current) {
        pending.current = false;
        setIsSaving(false);
      }
    }
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // The session's one EEG metric: average BrainFlow mindfulness (simulated in Demo).
  const metricFacts: Fact[] = session.averageMindfulness != null
    ? [{ label: session.isDemo ? 'Simulated mindfulness' : 'Mindfulness', value: `${session.averageMindfulness}/100` }]
    : [];

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
        {session.isDemo && (
          <p role="status" style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '8px' }}>
            Training Demo — these results are simulated, not measured EEG.
          </p>
        )}
      </div>

      {/* Primary result: the session's duration, with average mindfulness when it was measured or simulated. */}
      <div className="card-patient" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Duration</div>
          <div className="font-mono" style={{ fontSize: '40px', fontWeight: 700, lineHeight: 1.1, color: 'var(--brand-primary)' }}>
            {formatDuration(session.durationSeconds)}
          </div>
        </div>
        {metricFacts.length > 0 && (
          <FactGrid facts={metricFacts} minColumnWidth={110} style={{ paddingTop: '14px', borderTop: '1px solid var(--border-subtle)' }} />
        )}
      </div>

      {/* Mood check-in */}
      <div className="card-patient" style={{ padding: '16px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Heart size={15} color="var(--brand-primary)" />
          <span>How do you feel?</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '6px' }}>
          {MOODS.map(m => (
            <button
              key={m.value}
              onClick={() => { if (pending.current) return; setSelectedMood(m.value); setIsSaved(false); }}
              disabled={isSaving}
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
          Journal (optional)
        </label>
        <textarea
          value={patientNotes}
          onChange={e => { if (pending.current) return; setPatientNotes(e.target.value); setIsSaved(false); }}
          disabled={isSaving}
          placeholder="How did the session feel? Anything that helped or distracted you?"
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
          onClick={() => handleSave()}
          disabled={isSaving}
          className="btn btn-secondary"
          style={{ flex: 1, opacity: isSaving ? 0.7 : 1 }}
        >
          {isSaving ? 'Saving...' : isSaved ? 'Saved ✓' : 'Save Notes'}
        </button>
        <button
          onClick={() => handleSave(true)}
          disabled={isSaving}
          className="btn btn-primary"
          style={{ flex: 1.5, opacity: isSaving ? 0.7 : 1 }}
        >
          View Progress <ArrowRight size={16} />
        </button>
      </div>
      {saveError && (
        <div
          role="alert"
          style={{
            margin: '0 20px calc(12px + env(safe-area-inset-bottom, 0px))',
            color: '#D32F2F',
            fontSize: '13px',
            textAlign: 'center',
          }}
        >
          {saveError}
        </div>
      )}
    </div>
  );
};

export const PostSessionSummary: React.FC<PostSessionSummaryProps> = (props) =>
  <PostSessionSummaryContent key={`${props.session.patientId}:${props.session.id}`} {...props} />;
