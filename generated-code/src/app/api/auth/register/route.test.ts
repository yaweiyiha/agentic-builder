import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { hashPassword, generateSessionToken, setSessionCookie } from '@/lib/auth';

// Mock prisma client
vi.mock('@/lib/prisma', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// Mock auth utilities
vi.mock('@/lib/auth', () => ({
  hashPassword: vi.fn(),
  generateSessionToken: vi.fn(),
  setSessionCookie: vi.fn(),
}));

// Mock NextResponse to capture status and JSON body
vi.mock('next/server', () => {
  return {
    NextResponse: {
      json: vi.fn((data, init) => {
        const response = {
          status: init?.status || 200,
          _json: data, // Store the JSON data for inspection
          cookies: {
            set: vi.fn(), // Mock cookies.set method
          },
        };
        // Mock the setSessionCookie behavior
        if (init?.status === 201) {
          (response.cookies.set as vi.Mock).mockImplementation((name, value, options) => {
            (response as any)._cookie = { name, value, options }; // Capture cookie details
          });
        }
        return response;
      }),
    },
    NextRequest: vi.fn(), // Will be mocked per test
  };
});

describe('POST /api/auth/register', () => {
  const mockEmail = 'test@example.com';
  const mockPassword = 'password123';
  const mockHashedPassword = 'hashed_password_123';
  const mockUserId = 'user-id-123';
  const mockSessionToken = 'mock_session_token';

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    (hashPassword as vi.Mock).mockResolvedValue(mockHashedPassword);
    (generateSessionToken as vi.Mock).mockReturnValue(mockSessionToken);
    (setSessionCookie as vi.Mock).mockImplementation((res, token) => {
      // Simulate setting cookie on the mocked NextResponse
      res.cookies.set('sessionToken', token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 604800 });
    });
  });

  it('should register a new user and return 201 with session cookie', async () => {
    (prisma.user.findUnique as vi.Mock).mockResolvedValue(null); // User does not exist
    (prisma.user.create as vi.Mock).mockResolvedValue({ id: mockUserId, email: mockEmail, password_hash: mockHashedPassword });

    const mockRequest = {
      json: () => Promise.resolve({ email: mockEmail, password: mockPassword }),
    } as NextRequest;

    const response = await POST(mockRequest);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: mockEmail } });
    expect(hashPassword).toHaveBeenCalledWith(mockPassword);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: mockEmail,
        password_hash: mockHashedPassword,
      },
    });
    expect(generateSessionToken).toHaveBeenCalledWith(mockUserId);
    expect(setSessionCookie).toHaveBeenCalledWith(expect.any(Object), mockSessionToken);

    expect(response.status).toBe(201);
    expect(response._json).toEqual({ message: 'Registration successful', userId: mockUserId });
    expect(response.cookies.set).toHaveBeenCalledWith(
      'sessionToken',
      mockSessionToken,
      expect.objectContaining({ httpOnly: true, secure: expect.any(Boolean), sameSite: 'lax', path: '/', maxAge: 604800 })
    );
  });

  it('should return 409 if user with email already exists', async () => {
    (prisma.user.findUnique as vi.Mock).mockResolvedValue({ id: mockUserId, email: mockEmail }); // User already exists

    const mockRequest = {
      json: () => Promise.resolve({ email: mockEmail, password: mockPassword }),
    } as NextRequest;

    const response = await POST(mockRequest);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: mockEmail } });
    expect(prisma.user.create).not.toHaveBeenCalled(); // Should not create a new user
    expect(hashPassword).not.toHaveBeenCalled();
    expect(generateSessionToken).not.toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();

    expect(response.status).toBe(409);
    expect(response._json).toEqual({ message: 'User with this email already exists' });
  });

  it('should return 400 if email is missing', async () => {
    const mockRequest = {
      json: () => Promise.resolve({ password: mockPassword }),
    } as NextRequest;

    const response = await POST(mockRequest);

    expect(response.status).toBe(400);
    expect(response._json).toEqual({ message: 'Email and password are required' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('should return 400 if password is missing', async () => {
    const mockRequest = {
      json: () => Promise.resolve({ email: mockEmail }),
    } as NextRequest;

    const response = await POST(mockRequest);

    expect(response.status).toBe(400);
    expect(response._json).toEqual({ message: 'Email and password are required' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('should return 400 for invalid email format', async () => {
    const mockRequest = {
      json: () => Promise.resolve({ email: 'invalid-email', password: mockPassword }),
    } as NextRequest;

    const response = await POST(mockRequest);

    expect(response.status).toBe(400);
    expect(response._json).toEqual({ message: 'Invalid email format' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('should return 400 if password is too short', async () => {
    const mockRequest = {
      json: () => Promise.resolve({ email: mockEmail, password: 'short' }),
    } as NextRequest;

    const response = await POST(mockRequest);

    expect(response.status).toBe(400);
    expect(response._json).toEqual({ message: 'Password must be at least 8 characters long' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('should return 500 for internal server errors', async () => {
    (prisma.user.findUnique as vi.Mock).mockRejectedValue(new Error('Database error'));

    const mockRequest = {
      json: () => Promise.resolve({ email: mockEmail, password: mockPassword }),
    } as NextRequest;

    const response = await POST(mockRequest);

    expect(response.status).toBe(500);
    expect(response._json).toEqual({ message: 'Internal server error' });
    expect(prisma.user.findUnique).toHaveBeenCalled(); // Error occurred during DB operation
  });
});
