import Database from "better-sqlite3";
import type { CustomerRow } from "./types";

const db = new Database(":memory:");

db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL,
    address TEXT,
    city TEXT,
    state TEXT,
    zip_code TEXT,
    country TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
  );
`);

const count = (db.prepare("SELECT COUNT(*) as count FROM customers").get() as { count: number }).count;

if (count === 0) {
  const insert = db.prepare(`
    INSERT INTO customers (first_name, last_name, email, phone, address, city, state, zip_code, country, created_at)
    VALUES (@first_name, @last_name, @email, @phone, @address, @city, @state, @zip_code, @country, @created_at)
  `);

  const now = new Date().toISOString();
  insert.run({ first_name: "John", last_name: "Doe", email: "john.doe@example.com", phone: "555-0101", address: "123 Main St", city: "Springfield", state: "IL", zip_code: "62701", country: "USA", created_at: now });
  insert.run({ first_name: "Jane", last_name: "Smith", email: "jane.smith@example.com", phone: "555-0102", address: "456 Oak Ave", city: "Chicago", state: "IL", zip_code: "60601", country: "USA", created_at: now });
  insert.run({ first_name: "Bob", last_name: "Johnson", email: "bob.johnson@example.com", phone: "555-0103", address: "789 Pine Rd", city: "Naperville", state: "IL", zip_code: "60540", country: "USA", created_at: now });
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default db;
