import { create } from 'zustand';

export type SessionType = 'work' | 'shortBreak' | 'longBreak';
export type TimerStatus = 'idle' | 'running' | 'paused';

export interface TimerSettings {
  workDuration: number; // minutes
  shortBreakDuration: number; // minutes
  longBreakDuration: number; // minutes
  longBreakInterval: number; // number of work sessions before long break
  notificationSoundEnabled: boolean;
}

interface TimerState {
  settings: TimerSettings;
  currentSessionType: SessionType;
  timerStatus: TimerStatus;
  timeLeft: number; // seconds
  pomodoroCount: number; // completed work sessions in current cycle
  isAutoStartEnabled: boolean; // FR-TM05
  // Actions
  setSettings: (newSettings: Partial<TimerSettings>) => void;
  startTimer: () => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  resetTimer: () => void;
  skipSession: () => void;
  decrementTime: () => void;
  setSessionType: (type: SessionType) => void;
  // For saving sessions (will be an API call)
  saveCompletedSession: (sessionType: SessionType, durationMinutes: number) => void;
}

export const useTimerStore = create<TimerState>((set, get) => ({
  settings: {
    workDuration: 25,
    shortBreakDuration: 5,
    longBreakDuration: 15,
    longBreakInterval: 4,
    notificationSoundEnabled: true,
  },
  currentSessionType: 'work',
  timerStatus: 'idle',
  timeLeft: 25 * 60, // Default work duration in seconds
  pomodoroCount: 0,
  isAutoStartEnabled: true, // Default to true as per PRD FR-TM05

  setSettings: (newSettings) => set((state) => {
    const updatedSettings = { ...state.settings, ...newSettings };
    // If work duration changes, reset timer to new work duration if current session is work
    if (newSettings.workDuration !== undefined && state.currentSessionType === 'work' && state.timerStatus === 'idle') {
      return {
        settings: updatedSettings,
        timeLeft: newSettings.workDuration * 60,
      };
    }
    // If short break duration changes, reset timer to new short break duration if current session is short break
    if (newSettings.shortBreakDuration !== undefined && state.currentSessionType === 'shortBreak' && state.timerStatus === 'idle') {
      return {
        settings: updatedSettings,
        timeLeft: newSettings.shortBreakDuration * 60,
      };
    }
    // If long break duration changes, reset timer to new long break duration if current session is long break
    if (newSettings.longBreakDuration !== undefined && state.currentSessionType === 'longBreak' && state.timerStatus === 'idle') {
      return {
        settings: updatedSettings,
        timeLeft: newSettings.longBreakDuration * 60,
      };
    }
    return { settings: updatedSettings };
  }),

  startTimer: () => set((state) => {
    if (state.timerStatus === 'idle' || state.timerStatus === 'paused') {
      const { currentSessionType, settings } = state;
      let initialTime = state.timeLeft; // If paused, resume from timeLeft

      if (state.timerStatus === 'idle') { // If starting from idle, set initial time based on session type
        if (currentSessionType === 'work') initialTime = settings.workDuration * 60;
        else if (currentSessionType === 'shortBreak') initialTime = settings.shortBreakDuration * 60;
        else if (currentSessionType === 'longBreak') initialTime = settings.longBreakDuration * 60;
      }

      return {
        timerStatus: 'running',
        timeLeft: initialTime,
      };
    }
    return {};
  }),

  pauseTimer: () => set((state) => {
    if (state.timerStatus === 'running') {
      return { timerStatus: 'paused' };
    }
    return {};
  }),

  resumeTimer: () => set((state) => {
    if (state.timerStatus === 'paused') {
      return { timerStatus: 'running' };
    }
    return {};
  }),

  resetTimer: () => set((state) => {
    const { currentSessionType, settings } = state;
    let initialTime = 0;
    if (currentSessionType === 'work') initialTime = settings.workDuration * 60;
    else if (currentSessionType === 'shortBreak') initialTime = settings.shortBreakDuration * 60;
    else if (currentSessionType === 'longBreak') initialTime = settings.longBreakDuration * 60;

    return {
      timerStatus: 'idle',
      timeLeft: initialTime,
    };
  }),

  skipSession: () => set((state) => {
    const { currentSessionType, settings, pomodoroCount, isAutoStartEnabled } = state;
    let nextSessionType: SessionType;
    let nextPomodoroCount = pomodoroCount;

    // For skipped sessions, we don't save them as completed.
    // The PRD says "current session marked as skipped (if applicable)",
    // but for v1.0, we only save 'completed' sessions.

    if (currentSessionType === 'work') {
      nextPomodoroCount++;
      if (nextPomodoroCount % settings.longBreakInterval === 0) {
        nextSessionType = 'longBreak';
      } else {
        nextSessionType = 'shortBreak';
      }
    } else if (currentSessionType === 'shortBreak') {
      nextSessionType = 'work';
    } else { // longBreak
      nextSessionType = 'work';
      nextPomodoroCount = 0; // Reset pomodoro count after long break
    }

    let nextTimeLeft = 0;
    if (nextSessionType === 'work') nextTimeLeft = settings.workDuration * 60;
    else if (nextSessionType === 'shortBreak') nextTimeLeft = settings.shortBreakDuration * 60;
    else nextTimeLeft = settings.longBreakDuration * 60;

    return {
      currentSessionType: nextSessionType,
      pomodoroCount: nextPomodoroCount,
      timeLeft: nextTimeLeft,
      timerStatus: isAutoStartEnabled ? 'running' : 'idle', // Auto-start next session if enabled
    };
  }),

  decrementTime: () => set((state) => {
    if (state.timerStatus === 'running' && state.timeLeft > 0) {
      return { timeLeft: state.timeLeft - 1 };
    }
    // If time runs out
    if (state.timerStatus === 'running' && state.timeLeft === 0) {
      const { currentSessionType, settings, pomodoroCount, isAutoStartEnabled } = state;
      let nextSessionType: SessionType;
      let nextPomodoroCount = pomodoroCount;
      const originalDurationMinutes = (currentSessionType === 'work' ? settings.workDuration :
                                       currentSessionType === 'shortBreak' ? settings.shortBreakDuration :
                                       settings.longBreakDuration);

      // Save the completed session
      get().saveCompletedSession(currentSessionType, originalDurationMinutes);

      if (currentSessionType === 'work') {
        nextPomodoroCount++;
        if (nextPomodoroCount % settings.longBreakInterval === 0) {
          nextSessionType = 'longBreak';
        } else {
          nextSessionType = 'shortBreak';
        }
      } else if (currentSessionType === 'shortBreak') {
        nextSessionType = 'work';
      } else { // longBreak
        nextSessionType = 'work';
        nextPomodoroCount = 0; // Reset pomodoro count after long break
      }

      let nextTimeLeft = 0;
      if (nextSessionType === 'work') nextTimeLeft = settings.workDuration * 60;
      else if (nextSessionType === 'shortBreak') nextTimeLeft = settings.shortBreakDuration * 60;
      else nextTimeLeft = settings.longBreakDuration * 60;

      // Notification sound will be handled by a useEffect in the page component
      // based on timeLeft hitting 0.

      return {
        currentSessionType: nextSessionType,
        pomodoroCount: nextPomodoroCount,
        timeLeft: nextTimeLeft,
        timerStatus: isAutoStartEnabled ? 'running' : 'idle', // Auto-start next session if enabled
      };
    }
    return {}; // No state change if not running or time is already 0
  }),

  setSessionType: (type) => set((state) => {
    const { settings } = state;
    let newTimeLeft = 0;
    if (type === 'work') newTimeLeft = settings.workDuration * 60;
    else if (type === 'shortBreak') newTimeLeft = settings.shortBreakDuration * 60;
    else newTimeLeft = settings.longBreakDuration * 60;

    return {
      currentSessionType: type,
      timeLeft: newTimeLeft,
      timerStatus: 'idle', // Reset status when manually changing session type
    };
  }),

  // Placeholder for saving session (will interact with TanStack Query later)
  saveCompletedSession: (sessionType, durationMinutes) => {
    console.log(`[API Call Placeholder] Saving completed session: ${sessionType} for ${durationMinutes} minutes.`);
    // TODO: Integrate with TanStack Query mutation for POST /api/sessions
    // This would typically involve a mutation hook like useMutation from TanStack Query
    // For now, it's a console log.
  },
}));
