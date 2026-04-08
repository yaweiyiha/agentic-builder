import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { SessionType, SessionStatus } from '@prisma/client';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.id) {
    return NextResponse.json({ message: 'Not authenticated' }, { status: 401 });
  }

  try {
    const userId = session.user.id;
    const { searchParams } = new URL(req.url);
    const range = searchParams.get('range') || '7d'; // e.g., 'today', '7d', '30d', 'all'

    let startDate: Date | undefined;
    const now = new Date();
    now.setHours(0, 0, 0, 0); // Start of today

    switch (range) {
      case 'today':
        startDate = now;
        break;
      case '7d':
        startDate = new Date(now.setDate(now.getDate() - 6)); // Last 7 days including today
        break;
      case '30d':
        startDate = new Date(now.setDate(now.getDate() - 29)); // Last 30 days including today
        break;
      case 'all':
      default:
        startDate = undefined; // No start date filter
        break;
    }

    const whereClause: any = {
      userId,
      status: SessionStatus.COMPLETED,
    };

    if (startDate) {
      whereClause.startTime = {
        gte: startDate,
      };
    }

    // Total counts and durations
    const totalWorkSessions = await prisma.pomodoroSession.count({
      where: { ...whereClause, sessionType: SessionType.WORK },
    });
    const totalBreakSessions = await prisma.pomodoroSession.count({
      where: { ...whereClause, OR: [{ sessionType: SessionType.SHORT_BREAK }, { sessionType: SessionType.LONG_BREAK }] },
    });

    const totalWorkTimeResult = await prisma.pomodoroSession.aggregate({
      _sum: { durationMinutes: true },
      where: { ...whereClause, sessionType: SessionType.WORK },
    });
    const totalBreakTimeResult = await prisma.pomodoroSession.aggregate({
      _sum: { durationMinutes: true },
      where: { ...whereClause, OR: [{ sessionType: SessionType.SHORT_BREAK }, { sessionType: SessionType.LONG_BREAK }] },
    });

    const totalWorkTime = totalWorkTimeResult._sum.durationMinutes || 0;
    const totalBreakTime = totalBreakTimeResult._sum.durationMinutes || 0;

    // Daily/Weekly/Monthly productivity graph data
    // This is a simplified aggregation. For real graphs, more complex grouping might be needed.
    const sessionsByDay = await prisma.pomodoroSession.findMany({
      where: whereClause,
      select: {
        startTime: true,
        sessionType: true,
        durationMinutes: true,
      },
      orderBy: { startTime: 'asc' },
    });

    const dailySummary: { date: string; workMinutes: number; breakMinutes: number; workSessions: number; breakSessions: number }[] = [];
    const dayMap = new Map<string, { workMinutes: number; breakMinutes: number; workSessions: number; breakSessions: number }>();

    sessionsByDay.forEach(session => {
      const dateKey = session.startTime.toISOString().split('T')[0]; // YYYY-MM-DD
      if (!dayMap.has(dateKey)) {
        dayMap.set(dateKey, { workMinutes: 0, breakMinutes: 0, workSessions: 0, breakSessions: 0 });
      }
      const data = dayMap.get(dateKey)!;
      if (session.sessionType === SessionType.WORK) {
        data.workMinutes += session.durationMinutes;
        data.workSessions += 1;
      } else {
        data.breakMinutes += session.durationMinutes;
        data.breakSessions += 1;
      }
    });

    dayMap.forEach((data, date) => {
      dailySummary.push({ date, ...data });
    });

    dailySummary.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());


    return NextResponse.json({
      totalWorkSessions,
      totalBreakSessions,
      totalWorkTime,
      totalBreakTime,
      dailySummary,
    }, { status: 200 });

  } catch (error) {
    console.error('Error fetching statistics:', error);
    return NextResponse.json({ message: 'Failed to fetch statistics' }, { status: 500 });
  }
}
