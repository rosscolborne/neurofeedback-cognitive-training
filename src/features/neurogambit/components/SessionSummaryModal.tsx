import React from 'react';
import { jsPDF } from 'jspdf';
import { NGIScore, NeuroGambitTrack } from '../types';
import { Trophy, FileDown, RotateCcw } from 'lucide-react';

interface SessionSummaryModalProps {
  score: NGIScore;
  track: NeuroGambitTrack;
  playerName?: string;
  onRestart: () => void;
  onFinish: () => void;
}

export const SessionSummaryModal: React.FC<SessionSummaryModalProps> = ({
  score,
  track,
  playerName = 'Athlete',
  onRestart,
  onFinish,
}) => {
  const downloadCoachPdf = () => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    // Clean, executive styling
    doc.setFillColor(26, 26, 32);
    doc.rect(0, 0, 210, 32, 'F');

    // Header title
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('NEUROGAMBIT | COACH PERFORMANCE REPORT', 14, 18);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(232, 150, 122);
    doc.text('COGNITIVE NEUROFEEDBACK & TACTICAL COMPOSURE ASSESSMENT', 14, 25);

    // Metadata Bar
    doc.setTextColor(107, 101, 96);
    doc.setFontSize(10);
    const dateStr = new Date().toLocaleDateString('en-US', { dateStyle: 'medium' });
    doc.text(`Player: ${playerName}`, 14, 42);
    doc.text(`Track: ${track === 'composed-tactics' ? 'Composed Tactics' : 'Tilt Crucible (Post-Blunder)'}`, 80, 42);
    doc.text(`Date: ${dateStr}`, 150, 42);

    doc.setDrawColor(232, 230, 225);
    doc.line(14, 46, 196, 46);

    // Primary NGI Score Card
    doc.setFillColor(248, 247, 244);
    doc.roundedRect(14, 52, 182, 38, 3, 3, 'F');

    doc.setTextColor(26, 26, 26);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('NEUROGAMBIT INDEX (NGI)', 20, 62);

    doc.setFontSize(28);
    doc.setTextColor(232, 150, 122);
    doc.text(`${score.compositeScore}`, 20, 78);

    doc.setFontSize(11);
    doc.setTextColor(107, 101, 96);
    doc.setFont('helvetica', 'normal');
    doc.text('/ 100 Baseline Standard', 52, 78);

    doc.setFontSize(9);
    doc.setTextColor(92, 140, 70);
    doc.text(`Status: ${score.compositeScore >= 100 ? 'Optimal Composure' : 'Composure In Development'}`, 120, 78);

    // Detailed Metrics Table
    doc.setTextColor(26, 26, 26);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Telemetry & Tactical Breakdown', 14, 102);

    const metrics = [
      ['Tactical Accuracy', `${score.tacticalAccuracyPercent}%`, 'Percentage of correct candidate moves on first attempt'],
      ['High-Beta Panic Duration', `${score.timeInHighBetaPanicSeconds}s`, 'Time spent in sympathetic tension / time scramble stress'],
      ['Autonomic Recovery Latency (t_recover)', `${score.recoveryLatencySeconds}s`, 'Speed to restore baseline Alpha/Beta post-blunder (15s benchmark)'],
      ['Total Session Pacing', `${score.totalSessionTimeSeconds}s`, 'Total elapsed duration of tactical match sequence'],
      ['Puzzles Completed', `${score.puzzlesCompleted} / ${score.totalPuzzlesAttempted}`, 'Full tactical combinations or swindle resources resolved'],
    ];

    let startY = 110;
    doc.setFontSize(10);
    for (const [title, value, desc] of metrics) {
      doc.setFillColor(252, 251, 249);
      doc.roundedRect(14, startY, 182, 14, 2, 2, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(26, 26, 26);
      doc.text(title, 18, startY + 6);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(232, 150, 122);
      doc.text(value, 160, startY + 6, { align: 'right' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(107, 101, 96);
      doc.text(desc, 18, startY + 11);
      doc.setFontSize(10);

      startY += 17;
    }

    // Coach Interpretation Section
    startY += 8;
    doc.setTextColor(26, 26, 26);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Coach Tactical Interpretation', 14, startY);

    startY += 6;
    doc.setFillColor(248, 247, 244);
    doc.roundedRect(14, startY, 182, 24, 2, 2, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 65);
    const splitText = doc.splitTextToSize(score.interpretation, 172);
    doc.text(splitText, 18, startY + 8);

    // Regulatory Disclaimer Footer
    doc.setFontSize(7.5);
    doc.setTextColor(140, 133, 120);
    doc.text(
      'Regulatory Notice: NeuroGambit Index (NGI) is a cognitive biofeedback metric designed exclusively for athletic coaching, cognitive training, and peak performance analysis. It does not provide medical or clinical diagnosis.',
      14,
      285,
      { maxWidth: 182 }
    );

    doc.save(`NeuroGambit_Coach_Report_${playerName}_${Date.now()}.pdf`);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(26, 26, 26, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          backgroundColor: 'var(--surface-patient-card, #FFFFFF)',
          borderRadius: '24px',
          padding: '28px',
          boxShadow: '0 20px 48px rgba(0, 0, 0, 0.3)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '18px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            backgroundColor: 'var(--brand-primary-subtle, #FDF0EB)',
            color: 'var(--brand-primary, #E8967A)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Trophy size={32} />
        </div>

        <div>
          <h2 style={{ fontSize: '22px', fontWeight: 700, margin: '0 0 4px 0', color: 'var(--text-primary)' }}>
            NeuroGambit Performance Summary
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
            Session evaluated across tactical accuracy, time panic, and post-blunder recovery.
          </p>
        </div>

        {/* NGI Badge */}
        <div
          style={{
            width: '100%',
            padding: '16px',
            backgroundColor: 'var(--surface-patient-recessed, #F2F1EE)',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
          }}
        >
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 700 }}>
              Composite NGI
            </div>
            <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--brand-primary)' }}>
              {score.compositeScore}
            </div>
          </div>

          <div style={{ height: '40px', width: '1px', backgroundColor: 'var(--border-default)' }} />

          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 700 }}>
              Accuracy
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#5C8C46' }}>
              {score.tacticalAccuracyPercent}%
            </div>
          </div>

          <div style={{ height: '40px', width: '1px', backgroundColor: 'var(--border-default)' }} />

          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 700 }}>
              t_recover
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#7B68AE' }}>
              {score.recoveryLatencySeconds}s
            </div>
          </div>
        </div>

        {/* Interpretation Note */}
        <div style={{ backgroundColor: 'var(--surface-patient-base)', padding: '12px 14px', borderRadius: '12px', fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'left', lineHeight: 1.4 }}>
          <strong>Coach Assessment:</strong> {score.interpretation}
        </div>

        {/* Action Buttons */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            onClick={downloadCoachPdf}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px' }}
          >
            <FileDown size={18} />
            <span>Download Coach Report (PDF)</span>
          </button>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={onRestart}
              className="btn btn-outline"
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '10px' }}
            >
              <RotateCcw size={16} />
              <span>Retry Track</span>
            </button>
            <button
              onClick={onFinish}
              className="btn btn-secondary"
              style={{ flex: 1, padding: '10px' }}
            >
              Return to Menu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
