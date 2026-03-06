import dotenv from 'dotenv';
import { resolve } from 'node:path';

// Load .env from project root
dotenv.config({ path: resolve(import.meta.dirname, '..', '.env') });

export const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/opengeo',
  PORT: Number(process.env.PORT ?? 3000),
  HOST: process.env.HOST ?? '0.0.0.0',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? '*',
  HARVEST_CONCURRENCY: Number(process.env.HARVEST_CONCURRENCY ?? 3),
  HARVEST_REQUEST_TIMEOUT: Number(process.env.HARVEST_REQUEST_TIMEOUT ?? 30000),
  HARVEST_USER_AGENT: process.env.HARVEST_USER_AGENT ?? 'opengeo-harvester/1.0',
  NODE_ENV: process.env.NODE_ENV ?? 'development',
} as const;
