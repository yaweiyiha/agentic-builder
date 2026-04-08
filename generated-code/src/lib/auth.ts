import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

/**
 * Extracts and verifies the JWT token from the request to get the user ID.
 * @param req The NextRequest object.
 * @returns The user ID if authentication is successful.
 * @throws {Error} If the token is missing or invalid.
 */
export function getUserIdFromRequest(req: NextRequest): string {
  const token = req.cookies.get('token')?.value || req.headers.get('authorization')?.split(' ')[1];

  if (!token) {
    throw new Error('Unauthorized: No token provided.');
  }

  try {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not defined in environment variables.');
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET) as { userId: string };
    return decoded.userId;
  } catch (error) {
    console.error('JWT verification failed:', error);
    throw new Error('Unauthorized: Invalid token.');
  }
}

/**
 * Middleware-like function to protect API routes.
 * @param req The NextRequest object.
 * @param handler The actual API route handler function.
 * @returns A NextResponse or the result of the handler.
 */
export async function withAuth(req: NextRequest, handler: (req: NextRequest, userId: string) => Promise<NextResponse>) {
  try {
    const userId = getUserIdFromRequest(req);
    return await handler(req, userId);
  } catch (error: any) {
    return NextResponse.json({ message: error.message || 'Authentication failed.' }, { status: 401 });
  }
}
