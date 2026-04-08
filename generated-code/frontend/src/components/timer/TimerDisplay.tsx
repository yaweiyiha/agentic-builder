import React from 'react';
import { SessionType } from '../../store/timerStore';

interface TimerDisplayProps {
  timeLeft: number; // in seconds
  currentSessionType: SessionType;
}

const TimerDisplay: React.FC<TimerDisplayProps> = ({ timeLeft, currentSessionType }) => {
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  const formatTime = (num: number) => num.toString().padStart(2, '0');

  const sessionTypeMap: Record<SessionType, string> = {
    work: 'Work Time',
    shortBreak: 'Short Break',
    longBreak: 'Long Break',
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-4">
      <h2 className="text-gray-300 text-2xl font-semibold tracking-wide">
        {sessionTypeMap[currentSessionType]}
      </h2>
      <div className="text-white text-[96px] font-bold tracking-tighter tabular-nums">
        {formatTime(minutes)}:{formatTime(seconds)}
      </div>
    </div>
  );
};

export default TimerDisplay;
