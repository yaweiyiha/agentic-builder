import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { mockRequest, getJsonResponse } from '@/lib/test-utils';
import prisma from '@/lib/prisma';
import { hash } from 'bcryptjs';

// Mock the prisma client and bcryptjs for this test file
vi.mock('@/lib/prisma');
vi.mock('bcryptjs');

const mockPrisma = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  userSettings: {
    create: ReturnType<typeof vi.fn>;
  };
};

const mockHash = hash as ReturnType<typeof vi.fn>;

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue(null); // Assume user does not exist by default
    mockPrisma.user.create.mockImplementation((data) =>
      Promise.resolve({
        id: 'new-user-id',
        email: data.data.email,
        password: data.data.password,
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: {
          id: 'settings-id',
          userId: 'new-user-id',
          workDurationMinutes: 25,
          shortBreakDurationMinutes: 5,
          longBreakDurationMinutes: 15,
          longBreakInterval: 4,
          notificationSoundEnabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    );
    mockPrisma.userSettings.create.mockResolvedValue({
      id: 'settings-id',
      userId: 'new-user-id',
      workDurationMinutes: 25,
      shortBreakDurationMinutes: 5,
      longBreakDurationMinutes: 15,
      longBreakInterval: 4,
      notificationSoundEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockHash.mockResolvedValue('hashed_password_123'); // Mock hashed password
  });

  it('should register a new user successfully with default settings', async () => {
    const req = mockRequest('POST', 'http://localhost/api/auth/register', {
      email: 'test@example.com',
      password: 'password123',
    });

    const res = await POST(req);
    const json = await getJsonResponse(res);

    expect(res.status).toBe(201);
    expect(json).toEqual({
      message: 'User registered successfully',
      user: expect.objectContaining({
        id: 'new-user-id',
        email: 'test@example.com',
        settings: expect.objectContaining({
          userId: 'new-user-id',
          workDurationMinutes: 25,
        }),
      }),
    });
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'test@example.com' } });
    expect(mockHash).toHaveBeenCalledWith('password123', 10);
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'test@example.com',
        password: 'hashed_password_123',
        settings: {
          create: {},
        },
      },
      include: {
        settings: true,
      },
    });
  });

  it('should return 400 if email or password is missing', async () => {
    const req1 = mockRequest('POST', 'http://localhost/api/auth/register', { email: 'test@example.com' });
    const res1 = await POST(req1);
    const json1 = await getJsonResponse(res1);
    expect(res1.status).toBe(400);
    expect(json1).toEqual({ message: 'Email and password are required' });

    const req2 = mockRequest('POST', 'http://localhost/api/auth/register', { password: 'password123' });
    const res2 = await POST(req2);
    const json2 = await getJsonResponse(res2);
    expect(res2.status).toBe(400);
    expect(json2).toEqual({ message: 'Email and password are required' });
  });

  it('should return 409 if user with email already exists', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'existing-user-id',
      email: 'existing@example.com',
      password: 'hashed_password',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const req = mockRequest('POST', 'http://localhost/api/auth/register', {
      email: 'existing@example.com',
      password: 'password123',
    });

    const res = await POST(req);
    const json = await getJsonResponse(res);

    expect(res.status).toBe(409);
    expect(json).toEqual({ message: 'User with this email already exists' });
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'existing@example.com' } });
    expect(mockPrisma.user.create).not.toHaveBeenCalled(); // Ensure create is not called
  });

  it('should return 500 for internal server errors', async () => {
    mockPrisma.user.create.mockRejectedValue(new Error('Database error'));

    const req = mockRequest('POST', 'http://localhost/api/auth/register', {
      email: 'error@example.com',
      password: 'password123',
    });

    const res = await POST(req);
    const json = await getJsonResponse(res);

    expect(res.status).toBe(500);
    expect(json).toEqual({ message: 'Something went wrong during registration' });
  });
});
