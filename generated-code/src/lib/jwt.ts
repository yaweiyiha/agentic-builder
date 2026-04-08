import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET is not defined. Please set it in your .env file.');
  process.exit(1);
}

/**
 * Signs a JWT token with the given payload.
 * @param payload The data to be stored in the token (e.g., { userId: string }).
 * @param expiresIn The duration for which the token will be valid (e.g., '1h', '7d'). Defaults to '1h'.
 * @returns The signed JWT token string.
 */
export const signToken = (payload: object, expiresIn: string = '1h'): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

/**
 * Verifies a JWT token and returns its decoded payload.
 * @param token The JWT token string to verify.
 * @returns The decoded payload if the token is valid.
 * @throws {Error} If the token is invalid or expired.
 */
export const verifyToken = (token: string): jwt.JwtPayload => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded as jwt.JwtPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token');
    }
    throw error; // Re-throw other unexpected errors
  }
};

// Extend the Request type to include userId
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}
