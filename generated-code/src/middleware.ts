import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './lib/jwt';

/**
 * Middleware to authenticate requests using JWT tokens.
 * It expects a 'Bearer <token>' in the Authorization header.
 * If authentication is successful, it attaches the userId to the request object.
 * If authentication fails, it sends a 401 Unauthorized response.
 */
export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Extract token from "Bearer <token>"

  if (!token) {
    return res.status(401).json({ message: 'Authentication token required' });
  }

  try {
    const decoded = verifyToken(token);
    // Assuming the JWT payload contains a 'userId' field
    if (decoded && decoded.userId) {
      req.userId = decoded.userId;
      next(); // Proceed to the next middleware/route handler
    } else {
      return res.status(401).json({ message: 'Invalid token payload' });
    }
  } catch (error: any) {
    if (error.message === 'Token expired') {
      return res.status(401).json({ message: 'Authentication token expired' });
    }
    if (error.message === 'Invalid token') {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }
    console.error('Error verifying token:', error);
    return res.status(500).json({ message: 'Failed to authenticate token' });
  }
};
