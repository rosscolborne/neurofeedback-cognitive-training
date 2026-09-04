import { useState, useEffect, useRef, useCallback } from 'react';
import { Chess, Square } from 'chess.js';
import confetti from 'canvas-confetti';
import { BrainStateEvent, PuzzleItem, NeuroGambitTrack, PieceChargeState, NGIScore } from '../types';
import { PUZZLES } from '../data/puzzles';
import { computeNGIScore } from '../services/eegAdapter';
import { audioEngine } from '../../../services/audioEngine';

interface UseNeuroGambitEngineProps {
  track: NeuroGambitTrack;
  brainState: BrainStateEvent;
  onSessionComplete?: (score: NGIScore) => void;
}

export function useNeuroGambitEngine({
  track,
  brainState,
  onSessionComplete,
}: UseNeuroGambitEngineProps) {
  const trackPuzzles = PUZZLES.filter((p) => p.track === track);
  const [currentPuzzleIndex, setCurrentPuzzleIndex] = useState(0);
  const activePuzzle = trackPuzzles[currentPuzzleIndex] || trackPuzzles[0];

  // Chess game instance
  const [chess] = useState(() => new Chess(activePuzzle.fen));
  const [fen, setFen] = useState(activePuzzle.fen);

  // Turn and ply progression
  // plyIndex tracks moves within current puzzle (0 = Move 1, 1 = Opponent reply, 2 = Move 2, etc.)
  const [plyIndex, setPlyIndex] = useState(0);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [legalMoves, setLegalMoves] = useState<Square[]>([]);

  // Move-1 Charge State
  const [chargeState, setChargeState] = useState<PieceChargeState>({
    square: null,
    progress: 0,
    isCharging: false,
    isLocked: false,
  });

  // Track B Blunder Shock State
  const [isShockEventActive, setIsShockEventActive] = useState(false);
  const [isBoardLockedForBreaker, setIsBoardLockedForBreaker] = useState(false);

  // Tournament Clock (Time Dilation)
  const [clockSecondsRemaining, setClockSecondsRemaining] = useState(120); // 2 minutes base
  const [isClockRunning, setIsClockRunning] = useState(true);
  const [clockRate, setClockRate] = useState<number>(1.0); // 0.7x (in-zone) to 1.2x (panic)

  // Session Statistics & Metrics
  const [sessionStartTime] = useState<number>(() => Date.now());
  const [correctMovesCount, setCorrectMovesCount] = useState(0);
  const [totalAttemptsCount, setTotalAttemptsCount] = useState(0);
  const [puzzlesCompleted, setPuzzlesCompleted] = useState(0);
  const [timeInPanicSeconds, setTimeInPanicSeconds] = useState(0);
  const [recoveryLatencies, setRecoveryLatencies] = useState<number[]>([]);
  const [feedbackBanner, setFeedbackBanner] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const chargeTimerRef = useRef<number | null>(null);
  const chargeStartTimeRef = useRef<number | null>(null);
  const lastClockTickRef = useRef<number>(0);

  // Reset board when puzzle changes
  const loadPuzzle = useCallback((puzzle: PuzzleItem) => {
    chess.load(puzzle.fen);
    setFen(chess.fen());
    setPlyIndex(0);
    setSelectedSquare(null);
    setLegalMoves([]);
    setChargeState({ square: null, progress: 0, isCharging: false, isLocked: false });

    if (puzzle.track === 'tilt-crucible') {
      setIsShockEventActive(false);
      setIsBoardLockedForBreaker(false);

      // Trigger shock blunder after 1.2 seconds of viewing the initial position
      setTimeout(() => {
        setIsShockEventActive(true);
        setIsBoardLockedForBreaker(true);
        audioEngine.playBlip(320); // Warning / shock chord
        setFeedbackBanner({
          text: `BLUNDER ALERT: Evaluation dropped to ${puzzle.blunderEval?.after || '-4.0'}. Reset composure!`,
          type: 'error',
        });
      }, 1200);
    } else {
      setIsShockEventActive(false);
      setIsBoardLockedForBreaker(false);
    }
  }, [chess]);

  useEffect(() => {
    loadPuzzle(activePuzzle);
  }, [activePuzzle, loadPuzzle]);

  // Track B: Unlock board once vagal circuit breaker completes
  const handleCircuitBreakerUnlock = useCallback((latency: number) => {
    setIsBoardLockedForBreaker(false);
    setIsShockEventActive(false);
    setRecoveryLatencies((prev) => [...prev, latency]);
    audioEngine.playBlip(880); // Success harmonic chime
    setFeedbackBanner({
      text: `Autonomic Reset Complete (${latency}s). Swindle defense unlocked!`,
      type: 'success',
    });
  }, []);

  // Time-Dilation Clock Engine
  useEffect(() => {
    if (!isClockRunning) return;
    lastClockTickRef.current = Date.now();

    const interval = setInterval(() => {
      const now = Date.now();
      const last = lastClockTickRef.current || now;
      const dt = (now - last) / 1000;
      lastClockTickRef.current = now;

      // Rate scaling:
      // In-zone (normalizedComposure >= 1.1): 0.7x (time dilation)
      // High-beta panic (normalizedComposure <= 0.7 or highBeta > 7.0): 1.2x (time leaks faster)
      let rate = 1.0;
      if (brainState.normalizedComposure >= 1.1) {
        rate = 0.7;
      } else if (brainState.normalizedComposure <= 0.7) {
        rate = 1.2;
        setTimeInPanicSeconds((prev) => prev + dt);
      }
      setClockRate(rate);

      setClockSecondsRemaining((prev) => {
        const next = prev - dt * rate;
        if (next <= 0) {
          setIsClockRunning(false);
          return 0;
        }
        return next;
      });
    }, 250);

    return () => clearInterval(interval);
  }, [isClockRunning, brainState.normalizedComposure, brainState.frontalHighBeta]);

  // Cancel charging immediately if user taps away or changes mind
  const cancelCharge = useCallback(() => {
    if (chargeTimerRef.current) {
      clearInterval(chargeTimerRef.current);
      chargeTimerRef.current = null;
    }
    chargeStartTimeRef.current = null;
    setChargeState({ square: null, progress: 0, isCharging: false, isLocked: false });
  }, []);

  const finishSession = useCallback(() => {
    setIsClockRunning(false);
    const totalTime = (Date.now() - sessionStartTime) / 1000;
    const accuracy = totalAttemptsCount > 0 ? (correctMovesCount / totalAttemptsCount) * 100 : 100;

    const avgRecovery = recoveryLatencies.length > 0
      ? recoveryLatencies.reduce((a, b) => a + b, 0) / recoveryLatencies.length
      : 12.0;

    const score = computeNGIScore(
      accuracy,
      timeInPanicSeconds,
      totalTime,
      avgRecovery,
      puzzlesCompleted,
      trackPuzzles.length
    );

    if (onSessionComplete) {
      onSessionComplete(score);
    }
    return score;
  }, [
    sessionStartTime,
    totalAttemptsCount,
    correctMovesCount,
    recoveryLatencies,
    timeInPanicSeconds,
    puzzlesCompleted,
    trackPuzzles.length,
    onSessionComplete,
  ]);

  const handlePuzzleCompleted = useCallback(() => {
    setPuzzlesCompleted((prev) => prev + 1);
    setFeedbackBanner({ text: 'Tactical sequence solved with composure!', type: 'success' });

    // Reward triggers
    confetti({
      particleCount: 35,
      spread: 60,
      origin: { y: 0.7 },
      colors: ['#E8967A', '#5C8C46', '#7B68AE', '#FFFFFF'],
    });
    audioEngine.playBlip(880);

    // Advance to next puzzle after 1.2s
    setTimeout(() => {
      setFeedbackBanner(null);
      if (currentPuzzleIndex + 1 < trackPuzzles.length) {
        setCurrentPuzzleIndex((prev) => prev + 1);
      } else {
        // End of track reached -> Finish session
        finishSession();
      }
    }, 1200);
  }, [currentPuzzleIndex, trackPuzzles.length, finishSession]);

  // Handle Square Selection and Piece Charging
  const handleSquareClick = useCallback((square: Square) => {
    if (isBoardLockedForBreaker) {
      setFeedbackBanner({ text: 'Board locked during Autonomic Circuit Breaker. Breathe.', type: 'error' });
      return;
    }

    const piece = chess.get(square);
    const isPlayerPiece = piece && piece.color === activePuzzle.playerColor;

    // Case 1: Player clicks their own piece
    if (isPlayerPiece) {
      // If tapping the already locked piece, keep it selected
      if (chargeState.square === square && chargeState.isLocked) {
        return;
      }

      // Cancel any ongoing charge on previous piece
      cancelCharge();

      const moves = chess.moves({ square, verbose: true });
      const destinations = moves.map((m) => m.to as Square);

      // Move-1 Composure Gating:
      // Only Move 1 (plyIndex === 0) requires the 1.2s charge hold!
      // Subsequent plies (plyIndex >= 2) execute immediately!
      if (plyIndex === 0) {
        setSelectedSquare(square);
        setLegalMoves([]); // Hide destination dots until 1.2s charge finishes!
        setChargeState({ square, progress: 0, isCharging: true, isLocked: false });
        chargeStartTimeRef.current = performance.now();

        // Start progressive 1.2s charge loop (ticks every 40ms)
        const holdDurationMs = 1200;
        const interval = window.setInterval(() => {
          const now = performance.now();
          const start = chargeStartTimeRef.current || now;
          const elapsed = now - start;

          // Charge fills only if composure is solid and no jaw clench
          const isComposed = brainState.normalizedComposure >= 0.9 && !brainState.isClenching;
          if (!isComposed) {
            // Slight lag in charge filling when tense
            chargeStartTimeRef.current = start + 20;
          }

          const progress = Math.min(1.0, elapsed / holdDurationMs);
          setChargeState((prev) => ({ ...prev, progress }));

          if (progress >= 1.0) {
            clearInterval(interval);
            chargeTimerRef.current = null;
            setChargeState({ square, progress: 1.0, isCharging: false, isLocked: true });
            setLegalMoves(destinations);
            audioEngine.playBlip(720); // Soft haptic audio confirmation
          }
        }, 40);

        chargeTimerRef.current = interval;
      } else {
        // Plies 2+: Fast, snappy execution without 1.2s delay!
        setSelectedSquare(square);
        setLegalMoves(destinations);
        setChargeState({ square, progress: 1.0, isCharging: false, isLocked: true });
      }
      return;
    }

    // Case 2: Player clicks a destination square to make a move
    if (selectedSquare && legalMoves.includes(square)) {
      cancelCharge();
      setTotalAttemptsCount((prev) => prev + 1);

      // Verify if this matches the puzzle solution move
      const currentExpectedMove = activePuzzle.solutionMoves[plyIndex];

      // Execute candidate move on chess.js
      let moveResult = null;
      try {
        moveResult = chess.move({ from: selectedSquare, to: square, promotion: 'q' });
      } catch {
        moveResult = null;
      }

      if (!moveResult) {
        setFeedbackBanner({ text: 'Illegal move.', type: 'error' });
        return;
      }

      const playedSAN = moveResult.san;
      const isCorrect = playedSAN === currentExpectedMove || moveResult.lan === currentExpectedMove;

      if (!isCorrect) {
        // Undo incorrect move
        chess.undo();
        setFen(chess.fen());
        setSelectedSquare(null);
        setLegalMoves([]);
        setFeedbackBanner({ text: 'Inaccurate move. Pause, calculate candidate lines.', type: 'error' });
        audioEngine.playBlip(240);
        return;
      }

      // Correct move executed!
      setCorrectMovesCount((prev) => prev + 1);
      setFen(chess.fen());
      setSelectedSquare(null);
      setLegalMoves([]);
      audioEngine.playBlip(540); // Move piece knock sound

      const nextPly = plyIndex + 1;
      setPlyIndex(nextPly);

      // Check if opponent has a counter-move in solution
      if (nextPly < activePuzzle.solutionMoves.length) {
        const opponentMoveSAN = activePuzzle.solutionMoves[nextPly];
        // Human-like 400ms opponent reaction delay
        setTimeout(() => {
          try {
            chess.move(opponentMoveSAN);
            setFen(chess.fen());
            audioEngine.playBlip(440);
            setPlyIndex(nextPly + 1);

            // If this was the last move of the puzzle
            if (nextPly + 1 >= activePuzzle.solutionMoves.length) {
              handlePuzzleCompleted();
            }
          } catch (e) {
            console.error('Opponent move error:', e);
          }
        }, 400);
      } else {
        // Puzzle completed with player's move
        handlePuzzleCompleted();
      }
      return;
    }

    // Case 3: Player tapped empty / unrelated square -> Cancel selection
    cancelCharge();
    setSelectedSquare(null);
    setLegalMoves([]);
  }, [
    chess,
    activePuzzle,
    plyIndex,
    isBoardLockedForBreaker,
    chargeState,
    selectedSquare,
    legalMoves,
    brainState.normalizedComposure,
    brainState.isClenching,
    cancelCharge,
    handlePuzzleCompleted,
  ]);

  return {
    track,
    activePuzzle,
    puzzleIndex: currentPuzzleIndex,
    totalPuzzles: trackPuzzles.length,
    fen,
    chess,
    plyIndex,
    selectedSquare,
    legalMoves,
    chargeState,
    isShockEventActive,
    isBoardLockedForBreaker,
    clockSecondsRemaining,
    clockRate,
    feedbackBanner,
    handleSquareClick,
    cancelCharge,
    handleCircuitBreakerUnlock,
    finishSession,
  };
}
