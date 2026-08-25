import React from 'react';

export interface BrandLogoProps {
  size?: number | 'sm' | 'md' | 'lg' | 'xl' | 'hero';
  variant?: 'terracotta' | 'light' | 'icon-only' | 'icon-only-cream';
  glow?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}

const SIZE_MAP: Record<string, number> = {
  sm: 28,
  md: 40,
  lg: 64,
  xl: 96,
  hero: 120,
};

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  variant = 'terracotta',
  glow = false,
  className = '',
  style = {},
  onClick,
}) => {
  const pixelSize = typeof size === 'number' ? size : SIZE_MAP[size] || 48;

  let imageSrc = '/app-logo.png';
  if (variant === 'light') {
    imageSrc = '/app-logo-light.png';
  } else if (variant === 'icon-only') {
    imageSrc = '/brain-mark-terracotta.png';
  } else if (variant === 'icon-only-cream') {
    imageSrc = '/brain-mark-cream.png';
  }

  return (
    <div
      className={className}
      onClick={onClick}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: pixelSize,
        height: pixelSize,
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
        flexShrink: 0,
        ...style,
      }}
    >
      {/* Subtle Zen Meditative Breathing Halo Glow */}
      {glow && (
        <>
          <div
            style={{
              position: 'absolute',
              inset: -14,
              borderRadius: Math.round(pixelSize * 0.28),
              background: 'radial-gradient(circle, rgba(209, 109, 77, 0.25) 0%, rgba(209, 109, 77, 0.06) 55%, transparent 75%)',
              animation: 'breathingPulse 4s ease-in-out infinite',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: -28,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(231, 151, 126, 0.18) 0%, transparent 65%)',
              animation: 'breathingPulse 6s ease-in-out infinite alternate',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
        </>
      )}

      {/* Main Logo Container */}
      <img
        src={imageSrc}
        alt="Brainswell App Logo"
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          zIndex: 1,
          display: 'block',
          filter: glow ? 'drop-shadow(0 10px 24px rgba(209, 109, 77, 0.35))' : undefined,
        }}
      />
    </div>
  );
};
