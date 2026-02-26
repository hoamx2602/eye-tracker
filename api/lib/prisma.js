/**
 * Prisma client singleton for Vercel serverless.
 * Avoids creating a new client on every request (connection limit).
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;
if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
}
export const prisma = globalForPrisma.prisma;
