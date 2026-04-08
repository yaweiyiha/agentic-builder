import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * Handles POST requests to log out a user by clearing the authentication cookie.
 * @returns {NextResponse} A response indicating successful logout.
 */
export async function POST() {
  try {
    // Clear the authentication cookie
    cookies().delete('token'); // Assuming 'token' is the name of your auth cookie

    return NextResponse.json({ message: 'Logged out successfully' }, { status: 200 });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ message: 'An unexpected error occurred during logout.' }, { status: 500 });
  }
}
