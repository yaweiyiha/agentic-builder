import React, { useState, useEffect } from 'react';

interface UserSettings {
  workDurationMinutes: number;
  shortBreakDurationMinutes: number;
  longBreakDurationMinutes: number;
  longBreakInterval: number;
  notificationSoundEnabled: boolean;
}

const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<UserSettings>({
    workDurationMinutes: 25,
    shortBreakDurationMinutes: 5,
    longBreakDurationMinutes: 15,
    longBreakInterval: 4,
    notificationSoundEnabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = localStorage.getItem('authToken');
        if (!token) {
          throw new Error('Not authenticated.');
        }

        const response = await fetch(`${import.meta.env.VITE_APP_API_BASE_URL}/api/settings`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to fetch settings.');
        }

        const data: UserSettings = await response.json();
        setSettings(data);
      } catch (err: any) {
        setError(err.message || 'An error occurred while fetching settings.');
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setSettings((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : parseInt(value, 10),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    // Client-side validation
    if (settings.workDurationMinutes <= 0 || settings.shortBreakDurationMinutes <= 0 || settings.longBreakDurationMinutes <= 0 || settings.longBreakInterval <= 0) {
      setError('All durations and intervals must be greater than 0.');
      setSaving(false);
      return;
    }

    try {
      const token = localStorage.getItem('authToken');
      if (!token) {
        throw new Error('Not authenticated.');
      }

      const response = await fetch(`${import.meta.env.VITE_APP_API_BASE_URL}/api/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to save settings.');
      }

      setSuccessMessage('Settings saved successfully!');
      // Optionally, refetch settings to ensure consistency or update global state
    } catch (err: any) {
      setError(err.message || 'An error occurred while saving settings.');
    } finally {
      setSaving(false);
      setTimeout(() => setSuccessMessage(null), 3000); // Clear success message after 3 seconds
    }
  };

  if (loading) {
    return (
      <div className="text-center text-text-muted text-xl">Loading settings...</div>
    );
  }

  if (error && !saving) { // Display error only if not currently saving
    return (
      <div className="text-center text-red-500 text-xl">Error: {error}</div>
    );
  }

  return (
    <div className="flex flex-col items-center p-6 bg-card rounded-lg shadow-xl w-full max-w-md">
      <h1 className="text-4xl font-bold text-text mb-8">Settings</h1>

      {successMessage && (
        <div className="bg-green-500 text-white p-3 rounded-md mb-4 text-center w-full">
          {successMessage}
        </div>
      )}
      {error && (
        <div className="bg-red-500 text-white p-3 rounded-md mb-4 text-center w-full">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="w-full space-y-6">
        <div>
          <label htmlFor="workDurationMinutes" className="block text-text-muted text-sm font-bold mb-2">
            Work Duration (minutes)
          </label>
          <input
            type="number"
            id="workDurationMinutes"
            name="workDurationMinutes"
            value={settings.workDurationMinutes}
            onChange={handleChange}
            min="1"
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline bg-gray-200"
            disabled={saving}
          />
        </div>

        <div>
          <label htmlFor="shortBreakDurationMinutes" className="block text-text-muted text-sm font-bold mb-2">
            Short Break Duration (minutes)
          </label>
          <input
            type="number"
            id="shortBreakDurationMinutes"
            name="shortBreakDurationMinutes"
            value={settings.shortBreakDurationMinutes}
            onChange={handleChange}
            min="1"
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline bg-gray-200"
            disabled={saving}
          />
        </div>

        <div>
          <label htmlFor="longBreakDurationMinutes" className="block text-text-muted text-sm font-bold mb-2">
            Long Break Duration (minutes)
          </label>
          <input
            type="number"
            id="longBreakDurationMinutes"
            name="longBreakDurationMinutes"
            value={settings.longBreakDurationMinutes}
            onChange={handleChange}
            min="1"
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline bg-gray-200"
            disabled={saving}
          />
        </div>

        <div>
          <label htmlFor="longBreakInterval" className="block text-text-muted text-sm font-bold mb-2">
            Long Break Interval (work sessions)
          </label>
          <input
            type="number"
            id="longBreakInterval"
            name="longBreakInterval"
            value={settings.longBreakInterval}
            onChange={handleChange}
            min="1"
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline bg-gray-200"
            disabled={saving}
          />
        </div>

        <div className="flex items-center">
          <input
            type="checkbox"
            id="notificationSoundEnabled"
            name="notificationSoundEnabled"
            checked={settings.notificationSoundEnabled}
            onChange={handleChange}
            className="mr-2 h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded"
            disabled={saving}
          />
          <label htmlFor="notificationSoundEnabled" className="text-text-muted text-sm font-bold">
            Enable Notification Sound
          </label>
        </div>

        <button
          type="submit"
          className="bg-primary hover:bg-red-600 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline transition-colors w-full"
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
};

export default SettingsPage;
