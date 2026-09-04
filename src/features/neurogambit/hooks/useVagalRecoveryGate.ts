import { useState, useEffect, useRef, useCallback } from 'react';
import { BrainStateEvent } from '../types';

interface UseVagalRecoveryGateOptions {
  onUnlock?: (recoveryLatency: number) => void;
  minDuration?: number; // default 6s
  maxDuration?: number; // default 20s
  consecutiveRecoveryRequired?: number; // default 1.5s
}

export function useVagalRecoveryGate(
  brainState: BrainStateEvent,
  options: UseVagalRecoveryGateOptions = {}
) {
  const {
    onUnlock,
    minDuration = 6.0,
    maxDuration = 20.0,
    consecutiveRecoveryRequired = 1.5,
  } = options;

  const [isActive, setIsActive] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [recoveryLatency, setRecoveryLatency] = useState<number | null>(null);

  // Consecutive recovery time accumulator (in seconds)
  const [consecutiveRecovery, setConsecutiveRecovery] = useState(0);

  const startTimeRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const isUnlockedRef = useRef(false);

  // 4s Inhale, 6s Exhale = 10s cycle
  const cycleSeconds = 10.0;
  const currentCycleTime = elapsedSeconds % cycleSeconds;
  const pacerPhase: 'inhale' | 'exhale' = currentCycleTime < 4.0 ? 'inhale' : 'exhale';
  const pacerProgress = pacerPhase === 'inhale'
    ? currentCycleTime / 4.0
    : (currentCycleTime - 4.0) / 6.0;

  const startCircuitBreaker = useCallback(() => {
    setIsActive(true);
    setIsUnlocked(false);
    isUnlockedRef.current = false;
    setElapsedSeconds(0);
    setConsecutiveRecovery(0);
    setRecoveryLatency(null);
    startTimeRef.current = performance.now();
    lastTickRef.current = performance.now();
  }, []);

  const resetCircuitBreaker = useCallback(() => {
    setIsActive(false);
    setIsUnlocked(false);
    isUnlockedRef.current = false;
    setElapsedSeconds(0);
    setConsecutiveRecovery(0);
  }, []);

  useEffect(() => {
    if (!isActive || isUnlockedRef.current) return;

    const interval = setInterval(() => {
      const now = performance.now();
      const last = lastTickRef.current || now;
      const dt = (now - last) / 1000;
      lastTickRef.current = now;

      const totalElapsed = (now - (startTimeRef.current || now)) / 1000;
      setElapsedSeconds(totalElapsed);

      // Check if current brain state meets recovery criteria (normalized composure >= 1.0 without EMG clench)
      const isRecoveredNow = brainState.normalizedComposure >= 1.0 && !brainState.isClenching;

      let newConsecutive = 0;
      if (isRecoveredNow) {
        newConsecutive = consecutiveRecovery + dt;
        setConsecutiveRecovery(newConsecutive);
      } else {
        setConsecutiveRecovery(0);
      }

      // Early unlock condition:
      // Must pass minimum floor (6.0s), AND have sustained recovery for >= 1.5s
      // OR hit maximum ceiling (20.0s)
      const canEarlyUnlock = totalElapsed >= minDuration && newConsecutive >= consecutiveRecoveryRequired;
      const hitCeiling = totalElapsed >= maxDuration;

      if ((canEarlyUnlock || hitCeiling) && !isUnlockedRef.current) {
        isUnlockedRef.current = true;
        setIsUnlocked(true);
        setIsActive(false);
        const latency = Number(totalElapsed.toFixed(1));
        setRecoveryLatency(latency);
        if (onUnlock) {
          onUnlock(latency);
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [
    isActive,
    brainState.normalizedComposure,
    brainState.isClenching,
    consecutiveRecovery,
    minDuration,
    maxDuration,
    consecutiveRecoveryRequired,
    onUnlock,
  ]);

  return {
    isActive,
    elapsedSeconds,
    pacerPhase,
    pacerProgress,
    recoveryProgress: Math.min(1.0, consecutiveRecovery / consecutiveRecoveryRequired),
    isUnlocked,
    recoveryLatency,
    startCircuitBreaker,
    resetCircuitBreaker,
  };
}
