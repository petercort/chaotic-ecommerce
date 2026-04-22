import Database from 'better-sqlite3';
import type { Order, OrderItem } from './types.js';

const db = new Database(':memory:');

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    order_number TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    total_amount REAL NOT NULL DEFAULT 0,
    shipping_address TEXT,
    shipping_city TEXT,
    shipping_state TEXT,
    shipping_zip TEXT,
    shipping_country TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    product_sku TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    subtotal REAL NOT NULL
  );
`);

interface OrderRow {
  id: number;
  customer_id: number;
  order_number: string;
  status: string;
  total_amount: number;
  shipping_address: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_zip: string | null;
  shipping_country: string | null;
  created_at: string;
  updated_at: string | null;
}

interface OrderItemRow {
  id: number;
  order_id: number;
  product_id: number;
  product_name: string;
  product_sku: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

function mapOrder(row: OrderRow, items: OrderItemRow[]): Order {
  return {
    id: row.id,
    customerId: row.customer_id,
    orderNumber: row.order_number,
    status: row.status,
    totalAmount: row.total_amount,
    shippingAddress: row.shipping_address,
    shippingCity: row.shipping_city,
    shippingState: row.shipping_state,
    shippingZip: row.shipping_zip,
    shippingCountry: row.shipping_country,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map((i) => ({
      id: i.id,
      productId: i.product_id,
      productName: i.product_name,
      productSku: i.product_sku,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      subtotal: i.subtotal,
    })),
  };
}

function getItemsForOrder(orderId: number): OrderItemRow[] {
  return db
    .prepare('SELECT * FROM order_items WHERE order_id = ?')
    .all(orderId) as OrderItemRow[];
}

export function getAllOrders(): Order[] {
  const rows = db.prepare('SELECT * FROM orders ORDER BY id').all() as OrderRow[];
  return rows.map((r) => mapOrder(r, getItemsForOrder(r.id)));
}

export function getOrderById(id: number): Order | null {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as OrderRow | undefined;
  if (!row) return null;
  return mapOrder(row, getItemsForOrder(row.id));
}

export function getOrderByNumber(orderNumber: string): Order | null {
  const row = db
    .prepare('SELECT * FROM orders WHERE order_number = ?')
    .get(orderNumber) as OrderRow | undefined;
  if (!row) return null;
  return mapOrder(row, getItemsForOrder(row.id));
}

export function getOrdersByCustomer(customerId: number): Order[] {
  const rows = db
    .prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY id')
    .all(customerId) as OrderRow[];
  return rows.map((r) => mapOrder(r, getItemsForOrder(r.id)));
}

export function getOrdersByStatus(status: string): Order[] {
  const rows = db
    .prepare('SELECT * FROM orders WHERE status = ? ORDER BY id')
    .all(status) as OrderRow[];
  return rows.map((r) => mapOrder(r, getItemsForOrder(r.id)));
}

export interface InsertOrderParams {
  customerId: number;
  orderNumber: string;
  status: string;
  totalAmount: number;
  shippingAddress?: string;
  shippingCity?: string;
  shippingState?: string;
  shippingZip?: string;
  shippingCountry?: string;
  createdAt: string;
  items: Array<{
    productId: number;
    productName: string;
    productSku: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }>;
}

export function insertOrder(params: InsertOrderParams): Order {
  const insertOrderStmt = db.prepare(`
    INSERT INTO orders (customer_id, order_number, status, total_amount,
      shipping_address, shipping_city, shipping_state, shipping_zip, shipping_country, created_at)
    VALUES (@customerId, @orderNumber, @status, @totalAmount,
      @shippingAddress, @shippingCity, @shippingState, @shippingZip, @shippingCountry, @createdAt)
  `);

  const insertItemStmt = db.prepare(`
    INSERT INTO order_items (order_id, product_id, product_name, product_sku, quantity, unit_price, subtotal)
    VALUES (@orderId, @productId, @productName, @productSku, @quantity, @unitPrice, @subtotal)
  `);

  const transaction = db.transaction((p: InsertOrderParams) => {
    const result = insertOrderStmt.run({
      customerId: p.customerId,
      orderNumber: p.orderNumber,
      status: p.status,
      totalAmount: p.totalAmount,
      shippingAddress: p.shippingAddress ?? null,
      shippingCity: p.shippingCity ?? null,
      shippingState: p.shippingState ?? null,
      shippingZip: p.shippingZip ?? null,
      shippingCountry: p.shippingCountry ?? null,
      createdAt: p.createdAt,
    });
    const orderId = result.lastInsertRowid as number;
    for (const item of p.items) {
      insertItemStmt.run({ orderId, ...item });
    }
    return orderId;
  });

  const orderId = transaction(params);
  return getOrderById(orderId)!;
}

export function updateOrderStatus(id: number, status: string): Order | null {
  const updatedAt = new Date().toISOString();
  const result = db
    .prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, updatedAt, id);
  if (result.changes === 0) return null;
  return getOrderById(id);
}

export function deleteOrder(id: number): boolean {
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);
  const result = db.prepare('DELETE FROM orders WHERE id = ?').run(id);
  return result.changes > 0;
}

export default db;
