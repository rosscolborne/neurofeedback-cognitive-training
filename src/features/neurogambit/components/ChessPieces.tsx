import React from 'react';

interface ChessPieceSvgProps {
  type: 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
  color: 'w' | 'b';
  size?: number;
}

export const ChessPieceSvg: React.FC<ChessPieceSvgProps> = ({ type, color, size = 48 }) => {
  const isWhite = color === 'w';
  const fill = isWhite ? '#FAF8F5' : '#222226';
  const stroke = isWhite ? '#44403C' : '#FFFFFF';
  const accent = isWhite ? '#D6D3D1' : '#3F3F46';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 45 45"
      style={{
        filter: isWhite
          ? 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.25))'
          : 'drop-shadow(0 2px 4px rgba(255, 255, 255, 0.15))',
        display: 'block',
        margin: 'auto',
        userSelect: 'none',
        pointerEvents: 'none',
      }}
    >
      <g fill={fill} stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {type === 'p' && (
          // PAWN
          <g>
            <path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" />
            <path d="M12 39.5h21" stroke={accent} strokeWidth="1" />
          </g>
        )}

        {type === 'n' && (
          // KNIGHT
          <g>
            <path d="M22 10c-3.5 0-6 2-7.5 5.5-1.5 3.5-.5 8.5-3.5 11.5-1.5 1.5-3 2-3 2s2 1.5 4.5 1.5c1.5 0 2.5-.5 3.5-1.5 1-1 1.5-1.5 3-1.5s2.5 1 3.5 2c1 1 2 2.5 3.5 2.5 1.5 0 2.5-1 3.5-2.5.5-.7 1-1.5 1.5-2.5 2-4 3.5-7.5 3.5-12.5 0-5.5-3.5-7-7-7z" />
            <circle cx="16" cy="16" r="1.5" fill={stroke} />
            <path d="M11 39.5h23" />
          </g>
        )}

        {type === 'b' && (
          // BISHOP
          <g>
            <path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.35.49-2.32.47-3-.5 1.35-1.46 3-2 3-2z" />
            <path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z" />
            <circle cx="22.5" cy="8" r="2" />
            <path d="M20 18l5 6m0-6l-5 6" stroke={accent} strokeWidth="1" />
          </g>
        )}

        {type === 'r' && (
          // ROOK
          <g>
            <path d="M9 39h27v-3H9v3zM12 36v-4h21v4H12zM11 14h23l-2 18H13L11 14zM9 14V9h4v3h6V9h6v3h6V9h4v5H9z" />
            <path d="M14 29.5h17" stroke={accent} strokeWidth="1" />
          </g>
        )}

        {type === 'q' && (
          // QUEEN
          <g>
            <path d="M9 26c8.5-1.5 21-1.5 27 0l2-12-7 11-8.5-15L14 25l-7-11 2 12z" />
            <path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 21 1 28 0 0 0 2-1 .5-2.5 0 0 0-1.5-1.5-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z" />
            <circle cx="6" cy="12" r="2" />
            <circle cx="14" cy="9" r="2" />
            <circle cx="22.5" cy="8" r="2" />
            <circle cx="31" cy="9" r="2" />
            <circle cx="39" cy="12" r="2" />
          </g>
        )}

        {type === 'k' && (
          // KING
          <g>
            <path d="M22.5 11.63V6M20 8h5" stroke={stroke} strokeWidth="1.5" />
            <path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" />
            <path d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V23v.5C20 16 10.5 13 6.5 19.5c-3 6 5 10.5 5 10.5v7z" />
            <path d="M11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0" stroke={accent} strokeWidth="1" />
          </g>
        )}
      </g>
    </svg>
  );
};
