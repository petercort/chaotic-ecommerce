import Database from 'better-sqlite3';
import type { Product, ProductRow } from './types';

const db = new Database(':memory:');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    sku TEXT UNIQUE NOT NULL,
    price REAL NOT NULL,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL,
    reorder_level INTEGER DEFAULT 10,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT
  );
`);

function rowToProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sku: row.sku,
    price: row.price,
    stockQuantity: row.stock_quantity,
    category: row.category,
    reorderLevel: row.reorder_level,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    inStock: row.stock_quantity > 0,
    needsReorder: row.stock_quantity <= row.reorder_level,
  };
}

function seedData(): void {
  const count = (db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }).c;
  if (count > 0) return;

  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO products (name, description, sku, price, stock_quantity, category, reorder_level, active, created_at)
    VALUES (@name, @description, @sku, @price, @stock_quantity, @category, @reorder_level, 1, @created_at)
  `);

  const seeds = [
    { name: 'Laptop Computer', description: 'High-performance laptop', sku: 'LAPTOP-001', price: 1299.99, stock_quantity: 10000, category: 'Electronics', reorder_level: 5 },
    { name: 'Wireless Mouse', description: 'Ergonomic wireless mouse', sku: 'MOUSE-001', price: 29.99, stock_quantity: 10000, category: 'Electronics', reorder_level: 20 },
    { name: 'Mechanical Keyboard', description: 'Full-size mechanical keyboard', sku: 'KB-001', price: 149.99, stock_quantity: 10000, category: 'Electronics', reorder_level: 10 },
    { name: 'Office Chair', description: 'Ergonomic office chair', sku: 'CHAIR-001', price: 299.99, stock_quantity: 10000, category: 'Furniture', reorder_level: 3 },
    { name: 'Standing Desk', description: 'Height-adjustable standing desk', sku: 'DESK-001', price: 599.99, stock_quantity: 10000, category: 'Furniture', reorder_level: 2 },
    { name: 'Webcam HD', description: 'HD webcam for video conferencing', sku: 'CAM-001', price: 79.99, stock_quantity: 10000, category: 'Electronics', reorder_level: 10 },
  ];

  const insertMany = db.transaction((items: typeof seeds) => {
    for (const item of items) {
      insert.run({ ...item, created_at: now });
    }
  });
  insertMany(seeds);
}

seedData();

export { db, rowToProduct };
