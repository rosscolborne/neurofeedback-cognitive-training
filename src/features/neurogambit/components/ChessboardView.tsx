import React from 'react';
import { Chess, Square } from 'chess.js';
import { ChessPieceSvg } from './ChessPieces';
import { PieceChargeRing } from './PieceChargeRing';
import { PieceChargeState } from '../types';

interface ChessboardViewProps {
  chess: Chess;
  selectedSquare: Square | null;
  legalMoves: Square[];
  chargeState: PieceChargeState;
  isComposed: boolean;
  onSquareClick: (square: Square) => void;
  orientation?: 'w' | 'b';
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

export const ChessboardView: React.FC<ChessboardViewProps> = ({
  chess,
  selectedSquare,
  legalMoves,
  chargeState,
  isComposed,
  onSquareClick,
  orientation = 'w',
}) => {
  const displayFiles = orientation === 'w' ? FILES : [...FILES].reverse();
  const displayRanks = orientation === 'w' ? RANKS : [...RANKS].reverse();

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(8, 1fr)',
        gridTemplateRows: 'repeat(8, 1fr)',
        aspectRatio: '1 / 1',
        width: '100%',
        maxWidth: '460px',
        margin: '0 auto',
        backgroundColor: '#262421',
        userSelect: 'none',
        position: 'relative',
      }}
    >
      {displayRanks.map((rank, rIdx) =>
        displayFiles.map((file, fIdx) => {
          const square = `${file}${rank}` as Square;
          const isDark = (rIdx + fIdx) % 2 === 1;
          const piece = chess.get(square);

          const isSelected = selectedSquare === square;
          const isLegalTarget = legalMoves.includes(square);
          const isChargingThisPiece = isSelected && (chargeState.isCharging || chargeState.isLocked);

          // Square background color
          let bg = isDark ? '#B5A898' : '#EAE6DF';
          if (isSelected) {
            bg = isDark ? '#C79A63' : '#E0B888';
          }

          // Show coordinates on border squares
          const showRankCoord = fIdx === 0;
          const showFileCoord = rIdx === 7;

          return (
            <div
              key={square}
              onClick={() => onSquareClick(square)}
              style={{
                position: 'relative',
                backgroundColor: bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'background-color 0.15s ease',
              }}
            >
              {/* Rank Coordinate Label */}
              {showRankCoord && (
                <span
                  style={{
                    position: 'absolute',
                    top: '2px',
                    left: '3px',
                    fontSize: '9px',
                    fontWeight: 700,
                    color: isDark ? '#EAE6DF' : '#8C8578',
                    pointerEvents: 'none',
                    lineHeight: 1,
                  }}
                >
                  {rank}
                </span>
              )}

              {/* File Coordinate Label */}
              {showFileCoord && (
                <span
                  style={{
                    position: 'absolute',
                    bottom: '2px',
                    right: '3px',
                    fontSize: '9px',
                    fontWeight: 700,
                    color: isDark ? '#EAE6DF' : '#8C8578',
                    pointerEvents: 'none',
                    lineHeight: 1,
                  }}
                >
                  {file}
                </span>
              )}

              {/* Vector Piece Render */}
              {piece && (
                <ChessPieceSvg
                  type={piece.type}
                  color={piece.color}
                  size={42}
                />
              )}

              {/* Move-1 Radial Charge Ring over Candidate Piece */}
              {isChargingThisPiece && (
                <PieceChargeRing
                  progress={chargeState.progress}
                  isComplete={chargeState.isLocked}
                  isComposed={isComposed}
                  size={52}
                />
              )}

              {/* Destination Pip / Capture Ring */}
              {isLegalTarget && (
                <div
                  style={{
                    position: 'absolute',
                    width: piece ? '80%' : '26%',
                    height: piece ? '80%' : '26%',
                    borderRadius: '50%',
                    backgroundColor: piece ? 'transparent' : 'rgba(232, 150, 122, 0.85)',
                    border: piece ? '3px solid #E8967A' : 'none',
                    boxShadow: '0 0 8px rgba(232, 150, 122, 0.6)',
                    pointerEvents: 'none',
                    zIndex: 5,
                    transition: 'transform 0.15s ease',
                  }}
                />
              )}
            </div>
          );
        })
      )}
    </div>
  );
};
