import React, { useEffect, useRef } from 'react';
import { useTimerStore, TimerStatus, SessionType } from '../store/timerStore';
import Navbar from '../components/Navbar';
import TimerDisplay from '../components/timer/TimerDisplay';
import TimerControls from '../components/timer/TimerControls';
import SessionTypeSelector from '../components/timer/SessionTypeSelector';

const TimerPage: React.FC = () => {
  const {
    timeLeft,
    currentSessionType,
    timerStatus,
    settings,
    startTimer,
    pauseTimer,
    resumeTimer,
    resetTimer,
    skipSession,
    decrementTime,
    setSessionType,
  } = useTimerStore();

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Timer interval effect
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (timerStatus === 'running') {
      interval = setInterval(() => {
        decrementTime();
      }, 1000);
    } else if (interval) {
      clearInterval(interval);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [timerStatus, decrementTime]);

  // Session end effect (when timeLeft hits 0)
  useEffect(() => {
    if (timeLeft === 0 && timerStatus === 'running') {
      if (settings.notificationSoundEnabled && audioRef.current) {
        audioRef.current.play();
      }
      // The decrementTime action already handles transitioning to the next session
      // and setting timerStatus based on isAutoStartEnabled.
      // We just need to ensure the sound plays here.
      console.log(`Session ${currentSessionType} completed!`);
      // Optionally, show a toast notification here.
    }
  }, [timeLeft, timerStatus, settings.notificationSoundEnabled, currentSessionType]);

  const handleSelectSessionType = (type: SessionType) => {
    // Only allow changing session type if timer is idle
    if (timerStatus === 'idle') {
      setSessionType(type);
    }
  };

  const isTimerActive = timerStatus === 'running' || timerStatus === 'paused';

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <Navbar />
      <main className="flex-grow flex flex-col items-center justify-center p-4">
        <h1 className="text-4xl font-extrabold mb-10 text-indigo-400">Pomodoro Timer</h1>

        <SessionTypeSelector
          currentSessionType={currentSessionType}
          onSelectType={handleSelectSessionType}
          isTimerActive={isTimerActive}
        />

        <TimerDisplay
          timeLeft={timeLeft}
          currentSessionType={currentSessionType}
        />

        <TimerControls
          timerStatus={timerStatus}
          onStart={startTimer}
          onPause={pauseTimer}
          onResume={resumeTimer}
          onReset={resetTimer}
          onSkip={skipSession}
        />

        {/* Audio element for notification sound */}
        <audio ref={audioRef} src="/sounds/notification.mp3" preload="auto" />
        {/* You would place your notification sound file in public/sounds/notification.mp3 */}

        <div className="mt-8 text-gray-400 text-sm">
          <p>Completed Pomodoros in cycle: {useTimerStore.getState().pomodoroCount}</p>
          <p>Next long break in: {settings.longBreakInterval - (useTimerStore.getState().pomodoroCount % settings.longBreakInterval)} pomodoros</p>
        </div>
      </main>
    </div>
  );
};

export default TimerPage;
