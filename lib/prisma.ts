import { PrismaClient } from "@prisma/client";

// Prevent hot-reload in dev from spawning a new PrismaClient (and new DB
// connection pool) on every file save.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
