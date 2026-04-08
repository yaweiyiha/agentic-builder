import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import * as authModule from "@/lib/auth"; // Import the actual module for type inference

// Define a type for the mocked NextResponse to include custom properties for testing
type MockedNextResponse = NextResponse & {
  _json: any;
  cookies: {
    set: vi.Mock;
  };
  _cookie?: { name: string; value: string; options: Record<string, any> };
};

// Mock prisma client
vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock auth utilities
vi.mock("@/lib/auth", () => ({
  verifyPassword: vi.fn(),
  generateSessionToken: vi.fn(),
  setSessionCookie: vi.fn(),
}));

// Use vi.mocked to get the correctly typed mock functions
const { verifyPassword, generateSessionToken, setSessionCookie } =
  vi.mocked(authModule);

// Mock NextResponse to capture status and JSON body
vi.mock("next/server", () => {
  return {
    NextResponse: {
      json: vi.fn((data, init) => {
        const response: MockedNextResponse = {
          status: init?.status || 200,
          _json: data, // Store the JSON data for inspection
          cookies: {
            set: vi.fn(), // Mock cookies.set method
          },
        } as MockedNextResponse; // Cast to ensure type compatibility

        // Simulate setSessionCookie behavior for successful login
        if (init?.status === 200) {
          (response.cookies.set as vi.Mock).mockImplementation(
            (name: string, value: string, options: Record<string, any>) => {
              (response as any)._cookie = { name, value, options }; // Capture cookie details
            },
          );
        }
        return response;
      }),
    },
    NextRequest: vi.fn(), // Will be mocked per test
  };
});

describe("POST /api/auth/login", () => {
  const mockEmail = "test@example.com";
  const mockPassword = "password123";
  const mockHashedPassword = "hashed_password_123";
  const mockUserId = "user-id-123";
  const mockSessionToken = "mock_session_token";

  const mockUser = {
    id: mockUserId,
    email: mockEmail,
    password_hash: mockHashedPassword,
  };

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    (prisma.user.findUnique as vi.Mock).mockResolvedValue(null); // Reset default for findUnique
    verifyPassword.mockResolvedValue(true); // Assume password verification passes by default
    generateSessionToken.mockReturnValue(mockSessionToken);
    setSessionCookie.mockImplementation(
      (res: MockedNextResponse, token: string) => {
        // Simulate setting cookie on the mocked NextResponse
        res.cookies.set("sessionToken", token, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: 604800,
        });
      },
    );
  });

  it("should log in a user and return 200 with session cookie", async () => {
    (prisma.user.findUnique as vi.Mock).mockResolvedValue(mockUser);

    const mockRequest = {
      json: () => Promise.resolve({ email: mockEmail, password: mockPassword }),
    } as NextRequest;

    const response = (await POST(mockRequest)) as MockedNextResponse;

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: mockEmail },
    });
    expect(verifyPassword).toHaveBeenCalledWith(
      mockPassword,
      mockHashedPassword,
    );
    expect(generateSessionToken).toHaveBeenCalledWith(mockUserId);
    expect(setSessionCookie).toHaveBeenCalledWith(
      expect.any(Object),
      mockSessionToken,
    );

    expect(response.status).toBe(200);
    expect(response._json).toEqual({
      message: "Login successful",
      user: { id: mockUserId, email: mockEmail },
    });
    expect(response.cookies.set).toHaveBeenCalledWith(
      "sessionToken",
      mockSessionToken,
      {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 604800,
      },
    );
    expect(response._cookie).toEqual({
      name: "sessionToken",
      value: mockSessionToken,
      options: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 604800,
      },
    });
  });

  it("should return 401 for invalid credentials (user not found)", async () => {
    (prisma.user.findUnique as vi.Mock).mockResolvedValue(null); // No user found

    const mockRequest = {
      json: () =>
        Promise.resolve({
          email: "nonexistent@example.com",
          password: mockPassword,
        }),
    } as NextRequest;

    const response = (await POST(mockRequest)) as MockedNextResponse;

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "nonexistent@example.com" },
    });
    expect(verifyPassword).not.toHaveBeenCalled(); // Password verification should not be called if user not found
    expect(generateSessionToken).not.toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();

    expect(response.status).toBe(401);
    expect(response._json).toEqual({ message: "Invalid credentials" });
  });

  it("should return 401 for invalid credentials (incorrect password)", async () => {
    (prisma.user.findUnique as vi.Mock).mockResolvedValue(mockUser);
    verifyPassword.mockResolvedValue(false); // Incorrect password

    const mockRequest = {
      json: () =>
        Promise.resolve({ email: mockEmail, password: "wrongpassword" }),
    } as NextRequest;

    const response = (await POST(mockRequest)) as MockedNextResponse;

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: mockEmail },
    });
    expect(verifyPassword).toHaveBeenCalledWith(
      "wrongpassword",
      mockHashedPassword,
    );
    expect(generateSessionToken).not.toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();

    expect(response.status).toBe(401);
    expect(response._json).toEqual({ message: "Invalid credentials" });
  });

  it("should return 400 if email is missing", async () => {
    const mockRequest = {
      json: () => Promise.resolve({ password: mockPassword }),
    } as NextRequest;

    const response = (await POST(mockRequest)) as MockedNextResponse;

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(generateSessionToken).not.toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();

    expect(response.status).toBe(400);
    expect(response._json).toEqual({
      message: "Email and password are required",
    });
  });

  it("should return 400 if password is missing", async () => {
    const mockRequest = {
      json: () => Promise.resolve({ email: mockEmail }),
    } as NextRequest;

    const response = (await POST(mockRequest)) as MockedNextResponse;

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(generateSessionToken).not.toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();

    expect(response.status).toBe(400);
    expect(response._json).toEqual({
      message: "Email and password are required",
    });
  });

  it("should handle internal server errors", async () => {
    (prisma.user.findUnique as vi.Mock).mockRejectedValue(
      new Error("Database error"),
    );

    const mockRequest = {
      json: () => Promise.resolve({ email: mockEmail, password: mockPassword }),
    } as NextRequest;

    const response = (await POST(mockRequest)) as MockedNextResponse;

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: mockEmail },
    });
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(generateSessionToken).not.toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();

    expect(response.status).toBe(500);
    expect(response._json).toEqual({ message: "Internal server error" });
  });
});
