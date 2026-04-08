import { PrismaClient } from '@prisma/client';

// Add prisma to the global type to prevent multiple instances in development
declare global {
  var prisma: PrismaClient | undefined;
}

// Initialize PrismaClient
// Use a global variable to reuse the PrismaClient instance across hot reloads
// in development, which can prevent issues with too many database connections.
const prisma = global.prisma || new PrismaClient();

if (process.env.NODE_ENV === 'development') {
  global.prisma = prisma;
}

export default prisma;
