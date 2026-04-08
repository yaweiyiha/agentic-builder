import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { mockRequest, getJsonResponse, mockAuthenticatedSession, mockUnauthenticatedSession } from '@/lib/test-utils';
import { getServerSession } from 'next-auth';

// Mock getServerSession from next-auth
vi.mock('next-auth');

describe('GET /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return authenticated status and user info if session exists', async () => {
    const userId = 'user-id-123';
    const userEmail = 'test@example.com';
    mockAuthenticatedSession(userId, userEmail);

    const req = mockRequest('GET', 'http://localhost/api/auth/login');
    const res = await GET(req);
    const json = await getJsonResponse(res);

    expect(res.status).toBe(200);
    expect(json).toEqual({
      authenticated: true,
      user: {
        id: userId,
        email: userEmail,
      },
    });
    expect(getServerSession).toHaveBeenCalledTimes(1);
  });

  it('should return unauthenticated status if no session exists', async () => {
    mockUnauthenticatedSession();

    const req = mockRequest('GET', 'http://localhost/api/auth/login');
    const res = await GET(req);
    const json = await getJsonResponse(res);

    expect(res.status).toBe(401);
    expect(json).toEqual({
      authenticated: false,
      message: 'Not authenticated',
    });
    expect(getServerSession).toHaveBeenCalledTimes(1);
  });
});
