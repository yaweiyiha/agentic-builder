import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Define the interface for user settings
export interface UserSettings {
  id: string;
  userId: string;
  workDurationMinutes: number;
  shortBreakDurationMinutes: number;
  longBreakDurationMinutes: number;
  longBreakInterval: number;
  notificationSoundEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// Define the interface for updating settings (partial as not all fields are always updated)
export type UpdateSettingsPayload = Partial<Omit<UserSettings, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>;

const SETTINGS_QUERY_KEY = ['userSettings'];

export const useSettings = () => {
  const queryClient = useQueryClient();

  // Query to fetch user settings
  const {
    data: settings,
    isLoading,
    isError,
    error,
  }
    = useQuery<UserSettings, Error>({
      queryKey: SETTINGS_QUERY_KEY,
      queryFn: async () => {
        const response = await fetch('/api/settings');
        if (!response.ok) {
          throw new Error('Failed to fetch settings');
        }
        return response.json();
      },
      // Stale time to prevent refetching on every re-render if data is fresh
      staleTime: 1000 * 60 * 5, // 5 minutes
      // Cache time to keep data in cache even if not used
      gcTime: 1000 * 60 * 60, // 1 hour
    });

  // Mutation to update user settings
  const {
    mutate: updateSettings,
    isPending: isUpdating,
    isError: isUpdateError,
    error: updateError,
  } = useMutation<UserSettings, Error, UpdateSettingsPayload>({
    mutationFn: async (newSettings: UpdateSettingsPayload) => {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newSettings),
      });
      if (!response.ok) {
        throw new Error('Failed to update settings');
      }
      return response.json();
    },
    onSuccess: (updatedSettings) => {
      // Invalidate and refetch the settings query to ensure UI is up-to-date
      queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
      // Optionally, you can directly update the cache instead of refetching
      queryClient.setQueryData(SETTINGS_QUERY_KEY, updatedSettings);
      console.log('Settings updated successfully:', updatedSettings);
      // In a real app, you might want to show a toast notification here
    },
    onError: (error) => {
      console.error('Error updating settings:', error);
      // In a real app, you might want to show an error toast notification here
    },
  });

  return {
    settings,
    isLoading,
    isError,
    error,
    updateSettings,
    isUpdating,
    isUpdateError,
    updateError,
  };
};
