import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { getDateRange, aggregateDailyStats } from '@/lib/utils';

/**
 * GET /api/statistics
 * Fetches aggregated productivity statistics for the authenticated user.
 * Supports date range filtering via query parameters.
 *
 * Query Parameters:
 * - range: 'today' | 'last_7_days' | 'last_30_days' | 'custom' (default: 'last_7_days')
 * - startDate: ISO date string (required if range='custom')
 * - endDate: ISO date string (required if range='custom')
 *
 * Response:
 * {
 *   totalWorkSessions: number,
 *   totalBreakSessions: number,
 *   totalWorkMinutes: number,
 *   totalBreakMinutes: number,
 *   dailyStats: Array<{
 *     date: string,
 *     totalWorkSessions: number,
 *     totalWorkMinutes: number,
 *     totalBreakSessions: number,
 *     totalBreakMinutes: number
 *   }>
 * }
 */
export async function GET(req: NextRequest) {
  return withAuth(req, async (request, userId) => {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') || 'last_7_days';
    const customStartDate = searchParams.get('startDate');
    const customEndDate = searchParams.get('endDate');

    try {
      const { startDate, endDate } = getDateRange(range, customStartDate, customEndDate);

      // Fetch all relevant sessions for the user within the date range
      const sessions = await prisma.pomodoroSession.findMany({
        where: {
          user_id: userId,
          start_time: {
            gte: startDate,
            lte: endDate,
          },
          status: 'completed', // Only consider completed sessions for statistics
        },
        orderBy: {
          start_time: 'asc',
        },
      });

      // Aggregate overall totals
      let totalWorkSessions = 0;
      let totalBreakSessions = 0;
      let totalWorkMinutes = 0;
      let totalBreakMinutes = 0;

      sessions.forEach(session => {
        if (session.session_type === 'work') {
          totalWorkSessions++;
          totalWorkMinutes += session.duration_minutes;
        } else { // short_break or long_break
          totalBreakSessions++;
          totalBreakMinutes += session.duration_minutes;
        }
      });

      // Aggregate daily statistics for trends
      const dailyStats = aggregateDailyStats(sessions, startDate, endDate);

      return NextResponse.json({
        totalWorkSessions,
        totalBreakSessions,
        totalWorkMinutes,
        totalBreakMinutes,
        dailyStats,
      }, { status: 200 });

    } catch (error: any) {
      console.error('Error fetching statistics:', error);
      return NextResponse.json({ message: error.message || 'Failed to fetch statistics.' }, { status: 500 });
    }
  });
}
