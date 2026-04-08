import React from 'react';
import { TimerStatus } from '../../store/timerStore';

interface TimerControlsProps {
  timerStatus: TimerStatus;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onSkip: () => void;
}

const TimerControls: React.FC<TimerControlsProps> = ({
  timerStatus,
  onStart,
  onPause,
  onResume,
  onReset,
  onSkip,
}) => {
  return (
    <div className="flex flex-wrap justify-center gap-4 mt-8">
      {timerStatus === 'idle' && (
        <button
          onClick={onStart}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-8 rounded-lg shadow-lg transition duration-200 ease-in-out transform hover:scale-105"
        >
          Start
        </button>
      )}
      {timerStatus === 'running' && (
        <button
          onClick={onPause}
          className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 px-8 rounded-lg shadow-lg transition duration-200 ease-in-out transform hover:scale-105"
        >
          Pause
        </button>
      )}
      {timerStatus === 'paused' && (
        <button
          onClick={onResume}
          className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-lg shadow-lg transition duration-200 ease-in-out transform hover:scale-105"
        >
          Resume
        </button>
      )}
      <button
        onClick={onReset}
        className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-8 rounded-lg shadow-lg transition duration-200 ease-in-out transform hover:scale-105"
      >
        Reset
      </button>
      <button
        onClick={onSkip}
        className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-lg shadow-lg transition duration-200 ease-in-out transform hover:scale-105"
      >
        Skip
      </button>
    </div>
  );
};

export default TimerControls;
