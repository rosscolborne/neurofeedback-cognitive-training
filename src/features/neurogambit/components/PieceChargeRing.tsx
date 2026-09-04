import React from 'react';

interface PieceChargeRingProps {
  progress: number; // 0.0 to 1.0
  isComplete: boolean;
  isComposed: boolean;
  size?: number;
}

export const PieceChargeRing: React.FC<PieceChargeRingProps> = ({
  progress,
  isComplete,
  isComposed,
  size = 64,
}) => {
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - progress * circumference;

  const strokeColor = isComplete
    ? '#10B981' // Bright green / gold on completion
    : isComposed
    ? '#E8967A' // Warm brand coral / gold when composed
    : '#F59E0B'; // Amber when slightly tense

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{
          transform: 'rotate(-90deg)',
          filter: `drop-shadow(0 0 6px ${strokeColor}88)`,
        }}
      >
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255, 255, 255, 0.25)"
          strokeWidth={strokeWidth}
        />
        {/* Active charge stroke */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 40ms linear' }}
        />
      </svg>

      {/* Visual pulse hint */}
      {!isComplete && (
        <span
          style={{
            position: 'absolute',
            bottom: -18,
            fontSize: '9px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: strokeColor,
            whiteSpace: 'nowrap',
            backgroundColor: 'rgba(26, 26, 26, 0.85)',
            padding: '1px 6px',
            borderRadius: '4px',
          }}
        >
          {isComposed ? 'Holding Composure...' : 'Calm Mind to Charge'}
        </span>
      )}
    </div>
  );
};
