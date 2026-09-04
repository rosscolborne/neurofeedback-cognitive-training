import React from 'react';

interface PeripheralAmbientGlowProps {
  normalizedComposure: number;
  isClenching?: boolean;
  children: React.ReactNode;
}

export const PeripheralAmbientGlow: React.FC<PeripheralAmbientGlowProps> = ({
  normalizedComposure,
  isClenching = false,
  children,
}) => {
  // Composure states:
  // >= 1.1: In-zone flow state -> Ethereal warm gold / cyan halo
  // 0.8 - 1.1: Neutral composed state
  // < 0.8 or isClenching: High-beta tension / warning
  let borderColor = 'rgba(232, 230, 225, 0.8)';
  let glowBoxShadow = '0 8px 32px rgba(0, 0, 0, 0.12)';

  if (isClenching || normalizedComposure < 0.7) {
    borderColor = '#EF4444';
    glowBoxShadow = '0 0 28px rgba(239, 68, 68, 0.35)';
  } else if (normalizedComposure >= 1.1) {
    borderColor = '#E8967A';
    glowBoxShadow = '0 0 36px rgba(232, 150, 122, 0.45), 0 0 12px rgba(123, 104, 174, 0.25)';
  } else if (normalizedComposure >= 0.9) {
    borderColor = '#5C8C46';
    glowBoxShadow = '0 0 24px rgba(92, 140, 70, 0.3)';
  }

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: '16px',
        border: `3px solid ${borderColor}`,
        boxShadow: glowBoxShadow,
        transition: 'border-color 0.4s ease, box-shadow 0.4s ease',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
};
