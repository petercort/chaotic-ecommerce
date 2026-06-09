import type { Pool as PgPool } from 'pg';
import type { AuthUserRow } from './types.js';

function createPool(): PgPool {
  if (process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { newDb } = require('pg-mem');
    const mem = newDb();
    const adapter = mem.adapters.createPg();
    return new adapter.Pool() as PgPool;
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require('pg');
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new Pool({ connectionString }) as PgPool;
  }

  return new Pool({
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'auth',
    max: parseInt(process.env.DB_POOL_SIZE ?? '10', 10),
  }) as PgPool;
}

export const pool: PgPool = createPool();

pool.on('error', (err: Error) => {
  console.warn(`PostgreSQL pool error: ${err.message}`);
});

function toUser(row: AuthUserRow) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

export async function runMigrations(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) NOT NULL UNIQUE,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function createUser(input: {
  username: string;
  email: string;
  passwordHash: string;
}): Promise<{ id: number; username: string; email: string; createdAt: string }> {
  const { rows } = await pool.query<AuthUserRow>(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, username, email, password_hash, created_at`,
    [input.username, input.email, input.passwordHash],
  );

  const user = toUser(rows[0]);
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: new Date(user.createdAt).toISOString(),
  };
}

export async function findUserByUsername(username: string): Promise<AuthUserRow | null> {
  const { rows } = await pool.query<AuthUserRow>(
    'SELECT id, username, email, password_hash, created_at FROM users WHERE username = $1',
    [username],
  );
  return rows[0] ?? null;
}

export async function findUserByEmail(email: string): Promise<AuthUserRow | null> {
  const { rows } = await pool.query<AuthUserRow>(
    'SELECT id, username, email, password_hash, created_at FROM users WHERE email = $1',
    [email],
  );
  return rows[0] ?? null;
}

export async function closePool(): Promise<void> {
  await pool.end();
}