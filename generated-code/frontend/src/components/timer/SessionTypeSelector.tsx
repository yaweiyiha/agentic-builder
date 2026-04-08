import React from 'react';
import { SessionType } from '../../store/timerStore';

interface SessionTypeSelectorProps {
  currentSessionType: SessionType;
  onSelectType: (type: SessionType) => void;
  isTimerActive: boolean; // To disable selection when timer is running/paused
}

const SessionTypeSelector: React.FC<SessionTypeSelectorProps> = ({
  currentSessionType,
  onSelectType,
  isTimerActive,
}) => {
  const sessionTypes: SessionType[] = ['work', 'shortBreak', 'longBreak'];

  const sessionTypeLabels: Record<SessionType, string> = {
    work: 'Work',
    shortBreak: 'Short Break',
    longBreak: 'Long Break',
  };

  return (
    <div className="flex justify-center gap-2 mb-8">
      {sessionTypes.map((type) => (
        <button
          key={type}
          onClick={() => onSelectType(type)}
          disabled={isTimerActive}
          className={`
            px-4 py-2 rounded-full text-sm font-medium transition duration-200 ease-in-out
            ${currentSessionType === type
              ? 'bg-indigo-500 text-white shadow-md'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}
            ${isTimerActive ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          {sessionTypeLabels[type]}
        </button>
      ))}
    </div>
  );
};

export default SessionTypeSelector;
