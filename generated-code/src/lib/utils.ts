import { startOfDay, endOfDay, subDays, format, parseISO } from 'date-fns';

/**
 * Calculates the start and end dates for a given date range string.
 * @param range The desired date range ('today', 'last_7_days', 'last_30_days', 'custom').
 * @param customStartDate Optional custom start date string (ISO format).
 * @param customEndDate Optional custom end date string (ISO format).
 * @returns An object containing `startDate` and `endDate` Date objects.
 * @throws {Error} If an invalid range or custom dates are provided.
 */
export function getDateRange(
  range: string,
  customStartDate?: string,
  customEndDate?: string
): { startDate: Date; endDate: Date } {
  const now = new Date();
  let startDate: Date;
  let endDate: Date;

  switch (range) {
    case 'today':
      startDate = startOfDay(now);
      endDate = endOfDay(now);
      break;
    case 'last_7_days':
      startDate = startOfDay(subDays(now, 6)); // Includes today
      endDate = endOfDay(now);
      break;
    case 'last_30_days':
      startDate = startOfDay(subDays(now, 29)); // Includes today
      endDate = endOfDay(now);
      break;
    case 'custom':
      if (!customStartDate || !customEndDate) {
        throw new Error('Custom date range requires both startDate and endDate.');
      }
      startDate = startOfDay(parseISO(customStartDate));
      endDate = endOfDay(parseISO(customEndDate));
      break;
    default:
      // Default to last 7 days if no valid range is provided
      startDate = startOfDay(subDays(now, 6));
      endDate = endOfDay(now);
      break;
  }

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new Error('Invalid date format provided.');
  }

  return { startDate, endDate };
}

/**
 * Processes a list of Pomodoro sessions to aggregate daily statistics.
 * @param sessions An array of PomodoroSession objects.
 * @param startDate The start date of the overall range.
 * @param endDate The end date of the overall range.
 * @returns An array of daily statistics, including days with no sessions.
 */
export function aggregateDailyStats(
  sessions: {
    id: string;
    session_type: 'work' | 'short_break' | 'long_break';
    duration_minutes: number;
    start_time: Date;
    end_time: Date;
    status: string;
  }[],
  startDate: Date,
  endDate: Date
) {
  const dailyStatsMap = new Map<string, {
    date: string;
    totalWorkSessions: number;
    totalWorkMinutes: number;
    totalBreakSessions: number;
    totalBreakMinutes: number;
  }>();

  // Initialize map with all days in the range, even if no sessions
  let currentDay = startOfDay(startDate);
  while (currentDay <= endOfDay(endDate)) {
    const dateKey = format(currentDay, 'yyyy-MM-dd');
    dailyStatsMap.set(dateKey, {
      date: dateKey,
      totalWorkSessions: 0,
      totalWorkMinutes: 0,
      totalBreakSessions: 0,
      totalBreakMinutes: 0,
    });
    currentDay = startOfDay(subDays(currentDay, -1)); // Move to next day
  }

  sessions.forEach(session => {
    const sessionDateKey = format(session.start_time, 'yyyy-MM-dd');
    const stats = dailyStatsMap.get(sessionDateKey);

    if (stats) {
      if (session.session_type === 'work') {
        stats.totalWorkSessions++;
        stats.totalWorkMinutes += session.duration_minutes;
      } else { // short_break or long_break
        stats.totalBreakSessions++;
        stats.totalBreakMinutes += session.duration_minutes;
      }
    }
  });

  return Array.from(dailyStatsMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}
