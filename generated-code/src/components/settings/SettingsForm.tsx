import React, { useState, useEffect, FormEvent } from 'react';
import { useSettings, UpdateSettingsPayload, UserSettings } from '../../hooks/useSettings';
import { useNavigate } from 'react-router-dom'; // Assuming react-router-dom for navigation

interface SettingsFormProps {
  initialSettings: UserSettings;
}

const SettingsForm: React.FC<SettingsFormProps> = ({ initialSettings }) => {
  const navigate = useNavigate();
  const { updateSettings, isUpdating, isUpdateError, updateError } = useSettings();

  const [workDuration, setWorkDuration] = useState(initialSettings.workDurationMinutes);
  const [shortBreakDuration, setShortBreakDuration] = useState(initialSettings.shortBreakDurationMinutes);
  const [longBreakDuration, setLongBreakDuration] = useState(initialSettings.longBreakDurationMinutes);
  const [longBreakInterval, setLongBreakInterval] = useState(initialSettings.longBreakInterval);

  // Update local state if initialSettings prop changes (e.g., after a refetch)
  useEffect(() => {
    setWorkDuration(initialSettings.workDurationMinutes);
    setShortBreakDuration(initialSettings.shortBreakDurationMinutes);
    setLongBreakDuration(initialSettings.longBreakDurationMinutes);
    setLongBreakInterval(initialSettings.longBreakInterval);
  }, [initialSettings]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    // Basic client-side validation
    if (workDuration <= 0 || shortBreakDuration <= 0 || longBreakDuration <= 0 || longBreakInterval <= 0) {
      alert('All durations and intervals must be positive numbers.');
      return;
    }

    const payload: UpdateSettingsPayload = {
      workDurationMinutes: workDuration,
      shortBreakDurationMinutes: shortBreakDuration,
      longBreakDurationMinutes: longBreakDuration,
      longBreakInterval: longBreakInterval,
      // notificationSoundEnabled: true, // Assuming this is managed elsewhere or always true for now
    };

    updateSettings(payload);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-[24px] p-[24px] bg-[#FFFFFF] rounded-[12px] shadow-md w-full max-w-[500px]">
      <h2 className="text-[24px] font-bold text-[#18181b]">Settings</h2>

      <div className="flex flex-col gap-[16px]">
        {/* Work Duration */}
        <div className="flex flex-col">
          <label htmlFor="workDuration" className="text-[16px] font-medium text-[#18181b] mb-[4px]">
            Work Duration (minutes)
          </label>
          <input
            type="number"
            id="workDuration"
            value={workDuration}
            onChange={(e) => setWorkDuration(Math.max(1, parseInt(e.target.value) || 1))}
            className="p-[12px] border border-[#D1D5DB] rounded-[8px] text-[16px] text-[#18181b] focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
            min="1"
            required
          />
        </div>

        {/* Short Break Duration */}
        <div className="flex flex-col">
          <label htmlFor="shortBreakDuration" className="text-[16px] font-medium text-[#18181b] mb-[4px]">
            Short Break Duration (minutes)
          </label>
          <input
            type="number"
            id="shortBreakDuration"
            value={shortBreakDuration}
            onChange={(e) => setShortBreakDuration(Math.max(1, parseInt(e.target.value) || 1))}
            className="p-[12px] border border-[#D1D5DB] rounded-[8px] text-[16px] text-[#18181b] focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
            min="1"
            required
          />
        </div>

        {/* Long Break Duration */}
        <div className="flex flex-col">
          <label htmlFor="longBreakDuration" className="text-[16px] font-medium text-[#18181b] mb-[4px]">
            Long Break Duration (minutes)
          </label>
          <input
            type="number"
            id="longBreakDuration"
            value={longBreakDuration}
            onChange={(e) => setLongBreakDuration(Math.max(1, parseInt(e.target.value) || 1))}
            className="p-[12px] border border-[#D1D5DB] rounded-[8px] text-[16px] text-[#18181b] focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
            min="1"
            required
          />
        </div>

        {/* Long Break Interval */}
        <div className="flex flex-col">
          <label htmlFor="longBreakInterval" className="text-[16px] font-medium text-[#18181b] mb-[4px]">
            Long Break Interval (work sessions)
          </label>
          <input
            type="number"
            id="longBreakInterval"
            value={longBreakInterval}
            onChange={(e) => setLongBreakInterval(Math.max(1, parseInt(e.target.value) || 1))}
            className="p-[12px] border border-[#D1D5DB] rounded-[8px] text-[16px] text-[#18181b] focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
            min="1"
            required
          />
        </div>
      </div>

      {isUpdateError && (
        <p className="text-[14px] text-[#EF4444] mt-[8px]">Error saving settings: {updateError?.message}</p>
      )}

      <button
        type="submit"
        className="bg-[#2563eb] text-[#FFFFFF] text-[16px] font-semibold py-[12px] px-[24px] rounded-[8px] hover:bg-[#1D4ED8] disabled:bg-[#9CA3AF] disabled:cursor-not-allowed transition-colors"
        disabled={isUpdating}
      >
        {isUpdating ? 'Saving...' : 'Save Settings'}
      </button>
    </form>
  );
};

export default SettingsForm;
