import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePomodoroTimer } from './usePomodoroTimer'; // Assuming this path

// Mock settings for tests
const defaultSettings = {
  workDuration: 1, // 1 minute
  shortBreakDuration: 0.5, // 30 seconds
  longBreakDuration: 2, // 2 minutes
  longBreakInterval: 2, // 2 work sessions before a long break
};

describe('usePomodoroTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers(); // Use fake timers for controlled time progression
  });

  afterEach(() => {
    vi.runOnlyPendingTimers(); // Ensure all pending timers are cleared
    vi.restoreAllMocks(); // Restore original timers
  });

  it('should initialize with default work session and idle status', () => {
    const { result } = renderHook(() => usePomodoroTimer(defaultSettings));

    expect(result.current.sessionType).toBe('work');
    expect(result.current.status).toBe('idle');
    expect(result.current.timeLeft).toBe(defaultSettings.workDuration * 60);
    expect(result.current.currentCycle).toBe(1);
  });

  it('should start the timer and decrement timeLeft', () => {
    const { result } = renderHook(() => usePomodoroTimer(defaultSettings));

    act(() => {
      result.current.start();
    });

    expect(result.current.status).toBe('running');
    expect(result.current.timeLeft).toBe(defaultSettings.workDuration * 60);

    act(() => {
      vi.advanceTimersByTime(1000); // Advance by 1 second
    });

    expect(result.current.timeLeft).toBe(defaultSettings.workDuration * 60 - 1);

    act(() => {
      vi.advanceTimersByTime(5000); // Advance by 5 more seconds
    });

    expect(result.current.timeLeft).toBe(defaultSettings.workDuration * 60 - 6);
  });

  it('should pause the timer', () => {
    const { result } = renderHook(() => usePomodoroTimer(defaultSettings));

    act(() => {
      result.current.start();
      vi.advanceTimersByTime(10000); // Let it run for 10 seconds
    });

    const timeLeftAfterRun = result.current.timeLeft;
    expect(result.current.status).toBe('running');

    act(() => {
      result.current.pause();
    });

    expect(result.current.status).toBe('paused');
    expect(result.current.timeLeft).toBe(timeLeftAfterRun); // Time should not change after pause

    act(() => {
      vi.advanceTimersByTime(5000); // Advance timers, but timer should not decrement
    });

    expect(result.current.timeLeft).toBe(timeLeftAfterRun);
  });

  it('should resume the timer from where it was paused', () => {
    const { result } = renderHook(() => usePomodoroTimer(defaultSettings));

    act(() => {
      result.current.start();
      vi.advanceTimersByTime(10000); // Run for 10 seconds
      result.current.pause();
    });

    const timeLeftWhenPaused = result.current.timeLeft;
    expect(result.current.status).toBe('paused');

    act(() => {
      result.current.resume();
    });

    expect(result.current.status).toBe('running');
    expect(result.current.timeLeft).toBe(timeLeftWhenPaused); // Should be same as when paused

    act(() => {
      vi.advanceTimersByTime(1000); // Run for 1 more second
    });

    expect(result.current.timeLeft).toBe(timeLeftWhenPaused - 1);
  });

  it('should reset the timer to initial work session state', () => {
    const { result } = renderHook(() => usePomodoroTimer(defaultSettings));

    act(() => {
      result.current.start();
      vi.advanceTimersByTime(30000); // Run for 30 seconds
    });

    expect(result.current.timeLeft).toBe(defaultSettings.workDuration * 60 - 30);
    expect(result.current.status).toBe('running');

    act(() => {
      result.current.reset();
    });

    expect(result.current.sessionType).toBe('work');
    expect(result.current.status).toBe('idle');
    expect(result.current.timeLeft).toBe(defaultSettings.workDuration * 60);
    expect(result.current.currentCycle).toBe(1);
  });

  it('should transition from work to short break after work session completes', () => {
    const { result } = renderHook(() => usePomodoroTimer(defaultSettings));

    act(() => {
      result.current.start();
      vi.advanceTimersByTime(defaultSettings.workDuration * 60 * 1000); // Advance to end of work session
    });

    expect(result.current.sessionType).toBe('shortBreak');
    expect(result.current.status).toBe('idle'); // Auto-start is P1, so it should be idle
    expect(result.current.timeLeft).toBe(defaultSettings.shortBreakDuration * 60);
    expect(result.current.currentCycle).toBe(2); // First work session completed, moving to second cycle
  });

  it('should transition from short break to work after short break completes', () => {
    const { result } = renderHook(() => usePomodoroTimer(defaultSettings));

    // Complete work session 1
    act(() => {
      result.current.start();
      vi.advanceTimersByTime(defaultSettings.workDuration * 60 * 1000);
    });
    // Start short break 1
    act(() => {
      result.current.start();
      vi.advanceTimersByTime(defaultSettings.shortBreakDuration * 60 * 1000);
    });

    expect(result.current.sessionType).toBe('work');
    expect(result.current.status).toBe('idle');
    expect(result.current.timeLeft).toBe(defaultSettings.workDuration * 60);
    expect(result.current.currentCycle).toBe(2); // Still in second work session of the cycle
  });

  it('should transition to long break after `longBreakInterval` work sessions', () => {
    const { result } = renderHook(() => usePomodoroTimer(defaultSettings)); // longBreakInterval: 2

    // Work session 1 -> Short Break 1
    act(() => {
      result.current.start();
      vi.advanceTimersByTime(defaultSettings.workDuration * 60 * 1000);
    });
    act(() => {
      result.current.start();
      vi.advanceTimersByTime(defaultSettings.shortBreakDuration * 60 * 1000);
    });
    expect(result.current.sessionType).toBe('work'); // Back to work session 2
    expect(result.current.currentCycle).toBe(2);

    // Work session 2 -> Long Break
    act(() => {
      result.current.start();
      vi.advanceTimersByTime(defaultSettings.workDuration * 60 * 1000);
    });

    expect(result.current.sessionType).toBe('longBreak');
    expect(result.current.status).toBe('idle');
    expect(result.current.timeLeft).toBe(defaultSettings.longBreakDuration * 60);
    expect(result.current.currentCycle).toBe(1); // Cycle resets after long break
  });

  it('should transition from long break to work after long break completes', () => {
    const { result } = renderHook(() => usePomodoroTimer(defaultSettings)); // longBreakInterval: 2

    // Complete Work 1 -> Short Break 1 -> Work 2 -> Long Break
    act(() => {
      result.current.start(); vi.advanceTimersByTime(defaultSettings.workDuration * 60 * 1000);
      result.current.start(); vi.advanceTimersByTime(defaultSettings.shortBreakDuration * 60 * 1000);
      result.current.start(); vi.advanceTimersByTime(defaultSettings.workDuration * 60 * 1000);
    });
    expect(result.current.sessionType).toBe('longBreak');
    expect(result.current.currentCycle).toBe(1);

    // Start Long Break
    act(() => {
      result.current.start();
      vi.advanceTimersByTime(defaultSettings.longBreakDuration * 60 * 1000);
    });

    expect(result.current.sessionType).toBe('work');
    expect(result.current.status).toBe('idle');
    expect(result.current.timeLeft).toBe(defaultSettings.workDuration * 60);
    expect(result.current.currentCycle).toBe(1); // Should be back to first work session of new cycle
  });

  it('should skip the current session and move to the next', () => {
    const { result } = renderHook(() => usePomodoroTimer(defaultSettings));

    act(() => {
      result.current.start();
      vi.advanceTimersByTime(10000); // Run for 10 seconds
    });
    expect(result.current.sessionType).toBe('work');
    expect(result.current.timeLeft).toBe(defaultSettings.workDuration * 60 - 10);

    act(() => {
      result.current.skip();
    });

    expect(result.current.sessionType).toBe('shortBreak');
    expect(result.current.status).toBe('idle');
    expect(result.current.timeLeft).toBe(defaultSettings.shortBreakDuration * 60);
    expect(result.current.currentCycle).toBe(2); // Skipped work session 1, so cycle increments
  });

  it('should call onSessionComplete callback when a session ends', () => {
    const onSessionCompleteMock = vi.fn();
    const { result } = renderHook(() => usePomodoroTimer(defaultSettings, onSessionCompleteMock));

    act(() => {
      result.current.start();
      vi.advanceTimersByTime(defaultSettings.workDuration * 60 * 1000); // Complete work session
    });

    expect(onSessionCompleteMock).toHaveBeenCalledTimes(1);
    expect(onSessionCompleteMock).toHaveBeenCalledWith('work', defaultSettings.workDuration);

    // Continue to short break and complete it
    act(() => {
      result.current.start();
      vi.advanceTimersByTime(defaultSettings.shortBreakDuration * 60 * 1000);
    });

    expect(onSessionCompleteMock).toHaveBeenCalledTimes(2);
    expect(onSessionCompleteMock).toHaveBeenCalledWith('shortBreak', defaultSettings.shortBreakDuration);
  });

  it('should call onSessionComplete callback when a session is skipped', () => {
    const onSessionCompleteMock = vi.fn();
    const { result } = renderHook(() => usePomodoroTimer(defaultSettings, onSessionCompleteMock));

    act(() => {
      result.current.start();
      vi.advanceTimersByTime(10000); // Run for 10 seconds
      result.current.skip(); // Skip work session
    });

    expect(onSessionCompleteMock).toHaveBeenCalledTimes(1);
    expect(onSessionCompleteMock).toHaveBeenCalledWith('work', defaultSettings.workDuration); // Should report original duration

    act(() => {
      result.current.skip(); // Skip short break
    });

    expect(onSessionCompleteMock).toHaveBeenCalledTimes(2);
    expect(onSessionCompleteMock).toHaveBeenCalledWith('shortBreak', defaultSettings.shortBreakDuration);
  });

  it('should update timeLeft when settings change for the current session type', () => {
    const initialSettings = { ...defaultSettings, workDuration: 1 }; // 1 min work
    const { result, rerender } = renderHook(({ settings }) => usePomodoroTimer(settings), {
      initialProps: { settings: initialSettings },
    });

    expect(result.current.timeLeft).toBe(60); // 1 minute

    const newSettings = { ...defaultSettings, workDuration: 2 }; // 2 min work
    rerender({ settings: newSettings });

    expect(result.current.timeLeft).toBe(120); // Should update to 2 minutes
  });

  it('should not update timeLeft when settings change for a different session type while idle', () => {
    const initialSettings = { ...defaultSettings, workDuration: 1, shortBreakDuration: 0.5 };
    const { result, rerender } = renderHook(({ settings }) => usePomodoroTimer(settings), {
      initialProps: { settings: initialSettings },
    });

    expect(result.current.sessionType).toBe('work');
    expect(result.current.timeLeft).toBe(60);

    // Change short break duration, but current session is work
    const newSettings = { ...initialSettings, shortBreakDuration: 1 };
    rerender({ settings: newSettings });

    expect(result.current.sessionType).toBe('work');
    expect(result.current.timeLeft).toBe(60); // Should remain 60, as work duration didn't change
  });

  it('should update timeLeft for the next session type when settings change', () => {
    const initialSettings = { ...defaultSettings, workDuration: 1, shortBreakDuration: 0.5 };
    const { result, rerender } = renderHook(({ settings }) => usePomodoroTimer(settings), {
      initialProps: { settings: initialSettings },
    });

    // Complete work session to move to short break
    act(() => {
      result.current.start();
      vi.advanceTimersByTime(initialSettings.workDuration * 60 * 1000);
    });
    expect(result.current.sessionType).toBe('shortBreak');
    expect(result.current.timeLeft).toBe(initialSettings.shortBreakDuration * 60); // 30 seconds

    // Now change short break duration and rerender
    const newSettings = { ...initialSettings, shortBreakDuration: 1 }; // 1 minute short break
    rerender({ settings: newSettings });

    expect(result.current.sessionType).toBe('shortBreak');
    expect(result.current.timeLeft).toBe(newSettings.shortBreakDuration * 60); // Should update to 60 seconds
  });
});
