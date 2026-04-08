import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { SessionType, SessionStatus } from '@prisma/client';
import { getUserIdFromRequest } from '@/lib/auth'; // Assuming this utility exists

// Helper function to validate session type
const isValidSessionType = (type: string): type is SessionType => {
  return Object.values(SessionType).includes(type as SessionType);
};

// Helper function to validate session status (for v1.0, only 'completed')
const isValidSessionStatus = (status: string): status is SessionStatus => {
  return status === SessionStatus.completed; // Only 'completed' for v1.0
};

/**
 * @route POST /api/sessions
 * @description Records a new completed Pomodoro session for the authenticated user.
 * @access Private
 */
export async function POST(req: Request) {
  try {
    const userId = await getUserIdFromRequest(); // Authenticate user
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { session_type, duration_minutes, start_time, end_time, status } = body;

    // 1. Basic Validation
    if (!session_type || !duration_minutes || !start_time || !end_time || !status) {
      return NextResponse.json({ message: 'Missing required fields' }, { status: 400 });
    }

    // 2. Type Validation
    if (!isValidSessionType(session_type)) {
      return NextResponse.json({ message: `Invalid session_type. Must be one of: ${Object.values(SessionType).join(', ')}` }, { status: 400 });
    }
    if (!isValidSessionStatus(status)) {
      return NextResponse.json({ message: `Invalid session status. For v1.0, must be '${SessionStatus.completed}'` }, { status: 400 });
    }

    // 3. Data Integrity Validation
    const parsedDuration = parseInt(duration_minutes, 10);
    if (isNaN(parsedDuration) || parsedDuration <= 0) {
      return NextResponse.json({ message: 'Duration must be a positive integer' }, { status: 400 });
    }

    const parsedStartTime = new Date(start_time);
    const parsedEndTime = new Date(end_time);

    if (isNaN(parsedStartTime.getTime()) || isNaN(parsedEndTime.getTime())) {
      return NextResponse.json({ message: 'Invalid start_time or end_time format. Must be valid ISO 8601 dates.' }, { status: 400 });
    }

    if (parsedEndTime <= parsedStartTime) {
      return NextResponse.json({ message: 'End time must be after start time' }, { status: 400 });
    }

    // Ensure the duration matches the time difference (allowing for minor discrepancies)
    const actualDurationMinutes = Math.round((parsedEndTime.getTime() - parsedStartTime.getTime()) / (1000 * 60));
    if (Math.abs(actualDurationMinutes - parsedDuration) > 1) { // Allow 1 minute discrepancy
      console.warn(`Duration mismatch: provided=${parsedDuration}min, actual=${actualDurationMinutes}min`);
      // Decide whether to reject or log a warning. For now, we'll allow a small diff.
      // return NextResponse.json({ message: 'Provided duration does not match start/end time difference' }, { status: 400 });
    }


    const newSession = await prisma.pomodoroSession.create({
      data: {
        user_id: userId,
        session_type: session_type as SessionType,
        duration_minutes: parsedDuration,
        start_time: parsedStartTime,
        end_time: parsedEndTime,
        status: status as SessionStatus,
      },
    });

    return NextResponse.json(newSession, { status: 201 });

  } catch (error) {
    console.error('Error recording Pomodoro session:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * @route GET /api/sessions
 * @description Retrieves an authenticated user's Pomodoro session history.
 * @access Private
 * @queryParam type (optional): Filter by session type ('work', 'short_break', 'long_break')
 * @queryParam startDate (optional): Filter sessions starting from this date (ISO 8601)
 * @queryParam endDate (optional): Filter sessions ending by this date (ISO 8601)
 * @queryParam limit (optional): Number of sessions to return (default: 10)
 * @queryParam offset (optional): Number of sessions to skip (default: 0)
 */
export async function GET(req: Request) {
  try {
    const userId = await getUserIdFromRequest(); // Authenticate user
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type');
    const startDateParam = searchParams.get('startDate');
    const endDateParam = searchParams.get('endDate');
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');

    const where: any = {
      user_id: userId,
    };

    if (type && isValidSessionType(type)) {
      where.session_type = type;
    } else if (type) {
      return NextResponse.json({ message: `Invalid session_type filter. Must be one of: ${Object.values(SessionType).join(', ')}` }, { status: 400 });
    }

    if (startDateParam) {
      const startDate = new Date(startDateParam);
      if (isNaN(startDate.getTime())) {
        return NextResponse.json({ message: 'Invalid startDate format. Must be a valid ISO 8601 date.' }, { status: 400 });
      }
      where.start_time = { ...where.start_time, gte: startDate };
    }

    if (endDateParam) {
      const endDate = new Date(endDateParam);
      if (isNaN(endDate.getTime())) {
        return NextResponse.json({ message: 'Invalid endDate format. Must be a valid ISO 8601 date.' }, { status: 400 });
      }
      where.end_time = { ...where.end_time, lte: endDate };
    }

    const limit = limitParam ? parseInt(limitParam, 10) : 10;
    const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

    if (isNaN(limit) || limit <= 0 || isNaN(offset) || offset < 0) {
      return NextResponse.json({ message: 'Invalid limit or offset parameters' }, { status: 400 });
    }

    const sessions = await prisma.pomodoroSession.findMany({
      where,
      orderBy: {
        start_time: 'desc', // Most recent sessions first
      },
      take: limit,
      skip: offset,
    });

    const totalSessions = await prisma.pomodoroSession.count({ where });

    return NextResponse.json({
      data: sessions,
      meta: {
        total: totalSessions,
        limit,
        offset,
      },
    }, { status: 200 });

  } catch (error) {
    console.error('Error fetching Pomodoro sessions:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

// Placeholder for authentication utility. In a real app, this would parse JWT from cookies/headers.
// For now, it returns a hardcoded ID or null.
// You would replace this with your actual authentication logic.
async function getUserIdFromRequest(): Promise<string | null> {
  // This is a mock implementation.
  // In a real Next.js app, you'd typically extract a JWT from a cookie or Authorization header,
  // verify it, and return the user ID from the payload.
  // For demonstration, we'll assume a user is logged in if a specific header is present,
  // or return a hardcoded ID.
  // const authHeader = req.headers.get('Authorization');
  // if (authHeader && authHeader.startsWith('Bearer ')) {
  //   const token = authHeader.substring(7);
  //   try {
  //     const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { userId: string };
  //     return decoded.userId;
  //   } catch (e) {
  //     console.error('JWT verification failed:', e);
  //     return null;
  //   }
  // }

  // For testing purposes, return a known user ID.
  // In a real scenario, you'd fetch this from a secure session or JWT.
  const MOCK_USER_ID = process.env.MOCK_USER_ID || '65c2b0c1e1b7c2a3d4e5f6a7'; // Replace with a valid ObjectId from your DB
  if (MOCK_USER_ID) {
    // You might want to verify this ID actually exists in your User model
    // const userExists = await prisma.user.findUnique({ where: { id: MOCK_USER_ID } });
    // if (userExists) return MOCK_USER_ID;
    return MOCK_USER_ID;
  }
  return null;
}
