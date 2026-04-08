import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.id) {
    return NextResponse.json({ message: 'Not authenticated' }, { status: 401 });
  }

  try {
    const userId = session.user.id;
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
    });

    if (!settings) {
      // If no settings exist, create default ones
      const defaultSettings = await prisma.userSettings.create({
        data: {
          userId,
          workDurationMinutes: 25,
          shortBreakDurationMinutes: 5,
          longBreakDurationMinutes: 15,
          longBreakInterval: 4,
          notificationSoundEnabled: true,
        },
      });
      return NextResponse.json(defaultSettings, { status: 200 });
    }

    return NextResponse.json(settings, { status: 200 });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return NextResponse.json({ message: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.id) {
    return NextResponse.json({ message: 'Not authenticated' }, { status: 401 });
  }

  try {
    const userId = session.user.id;
    const {
      workDurationMinutes,
      shortBreakDurationMinutes,
      longBreakDurationMinutes,
      longBreakInterval,
      notificationSoundEnabled,
    } = await req.json();

    // Basic validation
    if (
      typeof workDurationMinutes !== 'number' || workDurationMinutes <= 0 ||
      typeof shortBreakDurationMinutes !== 'number' || shortBreakDurationMinutes <= 0 ||
      typeof longBreakDurationMinutes !== 'number' || longBreakDurationMinutes <= 0 ||
      typeof longBreakInterval !== 'number' || longBreakInterval <= 0 ||
      typeof notificationSoundEnabled !== 'boolean'
    ) {
      return NextResponse.json({ message: 'Invalid settings data' }, { status: 400 });
    }

    const updatedSettings = await prisma.userSettings.update({
      where: { userId },
      data: {
        workDurationMinutes,
        shortBreakDurationMinutes,
        longBreakDurationMinutes,
        longBreakInterval,
        notificationSoundEnabled,
      },
    });

    return NextResponse.json({ message: 'Settings updated successfully', settings: updatedSettings }, { status: 200 });
  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json({ message: 'Failed to update settings' }, { status: 500 });
  }
}
