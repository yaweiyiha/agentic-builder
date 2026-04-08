import { useState, useEffect, useRef, useCallback } from 'react';

interface PomodoroSettings {
  workDuration: number; // minutes
  shortBreakDuration: number; // minutes
  longBreakDuration: number; // minutes
  longBreakInterval: number; // number of work sessions before long break
}

type SessionType = 'work' | 'shortBreak' | 'longBreak';
type TimerStatus = 'idle' | 'running' | 'paused';

interface PomodoroTimer {
  timeLeft: number; // seconds
  sessionType: SessionType;
  status: TimerStatus;
  currentCycle: number; // 1-based index of current work session in the cycle
  start: () => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  skip: () => void;
}

const getInitialTime = (sessionType: SessionType, settings: PomodoroSettings): number => {
  switch (sessionType) {
    case 'work':
      return settings.workDuration * 60;
    case 'shortBreak':
      return settings.shortBreakDuration * 60;
    case 'longBreak':
      return settings.longBreakDuration * 60;
    default:
      return 0;
  }
};

export const usePomodoroTimer = (
  settings: PomodoroSettings,
  onSessionComplete?: (sessionType: SessionType, durationMinutes: number) => void
): PomodoroTimer => {
  const [sessionType, setSessionType] = useState<SessionType>('work');
  const [status, setStatus] = useState<TimerStatus>('idle');
  const [timeLeft, setTimeLeft] = useState<number>(getInitialTime('work', settings));
  const [currentCycle, setCurrentCycle] = useState<number>(1); // Tracks work sessions in a cycle
  const intervalRef = useRef<number | null>(null);

  // Effect to update timeLeft when settings change or sessionType changes
  useEffect(() => {
    setTimeLeft(getInitialTime(sessionType, settings));
  }, [sessionType, settings]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const clearTimerInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startCountdown = useCallback(() => {
    if (status === 'running') return;

    setStatus('running');
    clearTimerInterval(); // Ensure any existing interval is cleared

    intervalRef.current = setInterval(() => {
      setTimeLeft((prevTime) => {
        if (prevTime <= 1) {
          // Session ends
          clearTimerInterval();
          onSessionComplete?.(sessionType, getInitialTime(sessionType, settings) / 60); // Pass configured duration in minutes

          // Determine next session
          let nextSession: SessionType;
          let nextCycle = currentCycle;

          if (sessionType === 'work') {
            if (currentCycle % settings.longBreakInterval === 0) {
              nextSession = 'longBreak';
              nextCycle = 1; // Reset cycle after long break
            } else {
              nextSession = 'shortBreak';
              nextCycle = currentCycle + 1;
            }
          } else if (sessionType === 'shortBreak') {
            nextSession = 'work';
          } else { // longBreak
            nextSession = 'work';
          }

          setSessionType(nextSession);
          setCurrentCycle(nextCycle);
          setStatus('idle'); // PRD FR-TM05 (Auto-start) is P1, so for now, transition to idle.
          return getInitialTime(nextSession, settings);
        }
        return prevTime - 1;
      });
    }, 1000);
  }, [status, sessionType, currentCycle, settings, onSessionComplete, clearTimerInterval]);

  const pause = useCallback(() => {
    if (status === 'running') {
      clearTimerInterval();
      setStatus('paused');
    }
  }, [status, clearTimerInterval]);

  const resume = useCallback(() => {
    if (status === 'paused') {
      startCountdown();
    }
  }, [status, startCountdown]);

  const start = useCallback(() => {
    if (status === 'idle' || status === 'paused') {
      startCountdown();
    }
  }, [status, startCountdown]);

  const reset = useCallback(() => {
    clearTimerInterval();
    setSessionType('work');
    setStatus('idle');
    setCurrentCycle(1);
    setTimeLeft(getInitialTime('work', settings));
  }, [settings, clearTimerInterval]);

  const skip = useCallback(() => {
    clearTimerInterval();
    onSessionComplete?.(sessionType, getInitialTime(sessionType, settings) / 60); // Mark current as completed

    let nextSession: SessionType;
    let nextCycle = currentCycle;

    if (sessionType === 'work') {
      if (currentCycle % settings.longBreakInterval === 0) {
        nextSession = 'longBreak';
        nextCycle = 1; // Reset cycle after long break
      } else {
        nextSession = 'shortBreak';
        nextCycle = currentCycle + 1;
      }
    } else if (sessionType === 'shortBreak') {
      nextSession = 'work';
    } else { // longBreak
      nextSession = 'work';
    }

    setSessionType(nextSession);
    setCurrentCycle(nextCycle);
    setStatus('idle');
    setTimeLeft(getInitialTime(nextSession, settings));
  }, [sessionType, currentCycle, settings, onSessionComplete, clearTimerInterval]);

  return {
    timeLeft,
    sessionType,
    status,
    currentCycle,
    start,
    pause,
    resume,
    reset,
    skip,
  };
};
