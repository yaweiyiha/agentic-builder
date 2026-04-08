import React from 'react';

interface TimerDisplayProps {
  minutes: number;
  seconds: number;
  sessionType: 'Work' | 'Short Break' | 'Long Break';
  isRunning: boolean;
}

const TimerDisplay: React.FC<TimerDisplayProps> = ({ minutes, seconds, sessionType, isRunning }) => {
  const formatTime = (num: number) => num.toString().padStart(2, '0');

  return (
    <div className="flex flex-col items-center justify-center p-8 bg-card rounded-lg shadow-xl">
      <h2 className="text-4xl font-bold text-text mb-4">
        {sessionType}
      </h2>
      <div className="text-8xl font-mono font-extrabold text-primary mb-8">
        {formatTime(minutes)}:{formatTime(seconds)}
      </div>
      <div className={`text-lg font-medium ${isRunning ? 'text-green-400' : 'text-text-muted'}`}>
        {isRunning ? 'Running...' : 'Paused'}
      </div>
    </div>
  );
};

export default TimerDisplay;
