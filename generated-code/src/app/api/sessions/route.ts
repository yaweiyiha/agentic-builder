import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { SessionStatus, SessionType } from '@prisma/client';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.id) {
    return NextResponse.json({ message: 'Not authenticated' }, { status: 401 });
  }

  try {
    const userId = session.user.id;
    const { sessionType, durationMinutes, startTime, endTime, status } = await req.json();

    // Basic validation
    if (
      !Object.values(SessionType).includes(sessionType) ||
      typeof durationMinutes !== 'number' || durationMinutes <= 0 ||
      !startTime || !endTime ||
      !Object.values(SessionStatus).includes(status)
    ) {
      return NextResponse.json({ message: 'Invalid session data' }, { status: 400 });
    }

    const newSession = await prisma.pomodoroSession.create({
      data: {
        userId,
        sessionType,
        durationMinutes,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        status,
      },
    });

    return NextResponse.json({ message: 'Session saved successfully', session: newSession }, { status: 201 });
  } catch (error) {
    console.error('Error saving session:', error);
    return NextResponse.json({ message: 'Failed to save session' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.id) {
    return NextResponse.json({ message: 'Not authenticated' }, { status: 401 });
  }

  try {
    const userId = session.user.id;
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') as SessionType | null;
    const status = searchParams.get('status') as SessionStatus | null;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const where: any = { userId };
    if (type && Object.values(SessionType).includes(type)) {
      where.sessionType = type;
    }
    if (status && Object.values(SessionStatus).includes(status)) {
      where.status = status;
    }
    if (startDate || endDate) {
      where.startTime = {};
      if (startDate) where.startTime.gte = new Date(startDate);
      if (endDate) where.startTime.lte = new Date(endDate);
    }

    const sessions = await prisma.pomodoroSession.findMany({
      where,
      orderBy: { startTime: 'desc' },
    });

    return NextResponse.json(sessions, { status: 200 });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    return NextResponse.json({ message: 'Failed to fetch sessions' }, { status: 500 });
  }
}
