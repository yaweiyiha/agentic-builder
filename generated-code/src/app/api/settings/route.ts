import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { authenticateApiRequest } from '@/lib/auth';

// Default settings for a new user
const DEFAULT_SETTINGS = {
  workDurationMinutes: 25,
  shortBreakDurationMinutes: 5,
  longBreakDurationMinutes: 15,
  longBreakInterval: 4,
  notificationSoundEnabled: true,
};

/**
 * GET /api/settings
 * Retrieves the authenticated user's Pomodoro settings.
 */
export async function GET(req: NextRequest) {
  const authResult = await authenticateApiRequest(req);
  if (authResult.response) {
    return authResult.response; // Unauthorized response
  }
  const userId = authResult.userId!;

  try {
    let userSettings = await prisma.userSettings.findUnique({
      where: { userId: userId },
    });

    if (!userSettings) {
      // If settings don't exist, create default settings for the user
      userSettings = await prisma.userSettings.create({
        data: {
          userId: userId,
          ...DEFAULT_SETTINGS,
        },
      });
    }

    return NextResponse.json(userSettings, { status: 200 });
  } catch (error) {
    console.error('Failed to retrieve user settings:', error);
    return NextResponse.json({ message: 'Failed to retrieve settings' }, { status: 500 });
  }
}

/**
 * PUT /api/settings
 * Updates the authenticated user's Pomodoro settings.
 */
export async function PUT(req: NextRequest) {
  const authResult = await authenticateApiRequest(req);
  if (authResult.response) {
    return authResult.response; // Unauthorized response
  }
  const userId = authResult.userId!;

  try {
    const body = await req.json();

    // Validate input data
    const {
      workDurationMinutes,
      shortBreakDurationMinutes,
      longBreakDurationMinutes,
      longBreakInterval,
      notificationSoundEnabled,
    } = body;

    // Basic validation for numbers and boolean
    if (
      (workDurationMinutes !== undefined && (!Number.isInteger(workDurationMinutes) || workDurationMinutes <= 0)) ||
      (shortBreakDurationMinutes !== undefined && (!Number.isInteger(shortBreakDurationMinutes) || shortBreakDurationMinutes <= 0)) ||
      (longBreakDurationMinutes !== undefined && (!Number.isInteger(longBreakDurationMinutes) || longBreakDurationMinutes <= 0)) ||
      (longBreakInterval !== undefined && (!Number.isInteger(longBreakInterval) || longBreakInterval <= 0)) ||
      (notificationSoundEnabled !== undefined && typeof notificationSoundEnabled !== 'boolean')
    ) {
      return NextResponse.json({ message: 'Invalid input for settings' }, { status: 400 });
    }

    // Prepare data for update, only include fields that are present in the request body
    const updateData: {
      workDurationMinutes?: number;
      shortBreakDurationMinutes?: number;
      longBreakDurationMinutes?: number;
      longBreakInterval?: number;
      notificationSoundEnabled?: boolean;
    } = {};

    if (workDurationMinutes !== undefined) updateData.workDurationMinutes = workDurationMinutes;
    if (shortBreakDurationMinutes !== undefined) updateData.shortBreakDurationMinutes = shortBreakDurationMinutes;
    if (longBreakDurationMinutes !== undefined) updateData.longBreakDurationMinutes = longBreakDurationMinutes;
    if (longBreakInterval !== undefined) updateData.longBreakInterval = longBreakInterval;
    if (notificationSoundEnabled !== undefined) updateData.notificationSoundEnabled = notificationSoundEnabled;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ message: 'No valid fields provided for update' }, { status: 400 });
    }

    const updatedSettings = await prisma.userSettings.upsert({
      where: { userId: userId },
      update: updateData,
      create: {
        userId: userId,
        ...DEFAULT_SETTINGS, // Use defaults for creation
        ...updateData, // Override with provided update data
      },
    });

    return NextResponse.json(updatedSettings, { status: 200 });
  } catch (error) {
    console.error('Failed to update user settings:', error);
    return NextResponse.json({ message: 'Failed to update settings' }, { status: 500 });
  }
}
