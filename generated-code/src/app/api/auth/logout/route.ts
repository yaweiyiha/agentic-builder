import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function POST() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ message: 'No active session to log out from' }, { status: 400 });
  }

  // NextAuth handles the actual session invalidation via its signout function.
  // This API route would typically trigger a client-side signout.
  // For a server-side logout, NextAuth's /api/auth/signout endpoint is used.
  // This route can simply confirm that a session existed.
  return NextResponse.json({ message: 'Logout initiated (session existed)' }, { status: 200 });
}
