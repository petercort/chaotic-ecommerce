import type { Pool as PgPool } from "pg";
import type { CustomerRow } from "./types";

/**
 * Build a connection pool.
 *
 * In test mode an in-memory PostgreSQL (pg-mem) backend is used so the suite
 * runs without an external database. In all other modes a real node-postgres
 * pool is created from environment configuration.
 */
function createPool(): PgPool {
  if (process.env.NODE_ENV === "test") {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { newDb } = require("pg-mem");
    const mem = newDb();
    const adapter = mem.adapters.createPg();
    return new adapter.Pool() as PgPool;
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require("pg");
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new Pool({ connectionString }) as PgPool;
  }
  return new Pool({
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? "postgres",
    password: process.env.DB_PASSWORD ?? "postgres",
    database: process.env.DB_NAME ?? "customers",
    max: Number(process.env.DB_POOL_SIZE ?? 10),
  }) as PgPool;
}

export const pool: PgPool = createPool();

// Prevent unhandled 'error' events on idle pool clients from crashing the
// process when the database becomes unreachable. The health endpoint reports
// the outage instead, and queries reconnect when the database returns.
pool.on("error", (err: Error) => {
  console.warn(`PostgreSQL pool error: ${err.message}`);
});

/** Idempotent schema creation. Safe to run on every startup. */
export async function runMigrations(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      first_name VARCHAR(255) NOT NULL,
      last_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      phone VARCHAR(50) NOT NULL,
      address VARCHAR(255),
      city VARCHAR(255),
      state VARCHAR(255),
      zip_code VARCHAR(50),
      country VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_customers_email ON customers (email);`
  );
}

/**
 * Seed default customers when the table is empty.
 * Controlled by SEED_DATA (default: enabled). Set SEED_DATA=false to skip.
 */
export async function seedDefaultCustomers(): Promise<void> {
  if ((process.env.SEED_DATA ?? "true").toLowerCase() === "false") {
    return;
  }

  const { rows } = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::int AS count FROM customers"
  );
  if (Number(rows[0]?.count ?? 0) > 0) {
    return;
  }

  const seed = [
    ["John", "Doe", "john.doe@example.com", "555-0101", "123 Main St", "Springfield", "IL", "62701", "USA"],
    ["Jane", "Smith", "jane.smith@example.com", "555-0102", "456 Oak Ave", "Chicago", "IL", "60601", "USA"],
    ["Bob", "Johnson", "bob.johnson@example.com", "555-0103", "789 Pine Rd", "Naperville", "IL", "60540", "USA"],
  ];

  for (const c of seed) {
    await pool.query(
      `INSERT INTO customers (first_name, last_name, email, phone, address, city, state, zip_code, country)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (email) DO NOTHING`,
      c
    );
  }
}

/** Connect with retry/backoff so startup tolerates a not-yet-ready database. */
export async function connectWithRetry(
  maxRetries = Number(process.env.DB_MAX_RETRIES ?? 10),
  delayMs = Number(process.env.DB_RETRY_DELAY_MS ?? 2000)
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      lastError = err;
      console.warn(
        `Database not ready (attempt ${attempt}/${maxRetries}): ${(err as Error).message}`
      );
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

/** Lightweight connectivity probe used by the health endpoint. */
export async function isDbHealthy(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

function toIso(value: string | Date | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export function rowToCustomer(row: CustomerRow) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    state: row.state,
    zipCode: row.zip_code,
    country: row.country,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export default pool;
