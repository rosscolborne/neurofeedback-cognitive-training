import React from 'react';
import { Clock, Zap, AlertTriangle } from 'lucide-react';

interface TimeDilationClockProps {
  secondsRemaining: number;
  clockRate: number; // 0.7 (dilation), 1.0 (normal), 1.2 (leak)
  totalSeconds?: number;
}

export const TimeDilationClock: React.FC<TimeDilationClockProps> = ({
  secondsRemaining,
  clockRate,
  totalSeconds = 120,
}) => {
  const safeSeconds = Math.max(0, Math.floor(secondsRemaining));
  const m = Math.floor(safeSeconds / 60);
  const s = safeSeconds % 60;
  const timeFormatted = `${m}:${s.toString().padStart(2, '0')}`;

  const progressFraction = Math.max(0, Math.min(1, secondsRemaining / totalSeconds));

  const isDilation = clockRate <= 0.8;
  const isPanic = clockRate >= 1.15;

  let badgeBg = 'rgba(107, 101, 96, 0.12)';
  let badgeColor = 'var(--text-secondary)';
  let badgeText = '1.0x Standard';

  if (isDilation) {
    badgeBg = 'rgba(92, 140, 70, 0.16)';
    badgeColor = '#5C8C46';
    badgeText = '0.7x Time Dilation';
  } else if (isPanic) {
    badgeBg = 'rgba(239, 68, 68, 0.16)';
    badgeColor = '#EF4444';
    badgeText = '1.2x Time Panic';
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        backgroundColor: 'var(--surface-patient-card, #FFFFFF)',
        border: '1px solid var(--border-default, #E8E6E1)',
        borderRadius: '12px',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Clock size={18} color={badgeColor} />
        <div>
          <div style={{ fontSize: '10px', color: 'var(--text-tertiary, #8C8578)', textTransform: 'uppercase', fontWeight: 600 }}>
            Match Clock
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: '20px',
              fontWeight: 700,
              color: isPanic ? '#EF4444' : 'var(--text-primary, #1A1A1A)',
              letterSpacing: '0.05em',
            }}
          >
            {timeFormatted}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, maxWidth: '140px' }}>
        <div
          style={{
            width: '100%',
            height: '6px',
            backgroundColor: 'var(--surface-patient-recessed, #F2F1EE)',
            borderRadius: '999px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${progressFraction * 100}%`,
              height: '100%',
              backgroundColor: isPanic ? '#EF4444' : isDilation ? '#5C8C46' : 'var(--brand-primary, #E8967A)',
              transition: 'width 0.3s ease, background-color 0.3s ease',
            }}
          />
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '4px 10px',
          borderRadius: '999px',
          backgroundColor: badgeBg,
          color: badgeColor,
          fontSize: '11px',
          fontWeight: 700,
        }}
      >
        {isDilation && <Zap size={13} />}
        {isPanic && <AlertTriangle size={13} />}
        <span>{badgeText}</span>
      </div>
    </div>
  );
};
