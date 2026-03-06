import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { env } from '../env.js';

const sql = postgres(env.DATABASE_URL);
export const db = drizzle(sql, { schema });
export { sql as pgClient };
