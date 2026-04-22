import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db, rowToProduct } from './db';
import type { ProductRow } from './types';

const router = Router();

const productSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  sku: z.string().min(1),
  price: z.number().min(0),
  stockQuantity: z.number().int().min(0),
  category: z.string().min(1),
  reorderLevel: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

// GET /api/products/low-stock — must be before /:id
router.get('/low-stock', (req: Request, res: Response) => {
  const threshold = parseInt(req.query['threshold'] as string ?? '10', 10) || 10;
  const rows = db.prepare(
    'SELECT * FROM products WHERE stock_quantity <= ?'
  ).all(threshold) as ProductRow[];
  res.json(rows.map(rowToProduct));
});

// GET /api/products/sku/:sku — must be before /:id
router.get('/sku/:sku', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params['sku']) as ProductRow | undefined;
  if (!row) return res.status(404).json({ error: 'Product not found' });
  res.json(rowToProduct(row));
});

// GET /api/products/category/:category — must be before /:id
router.get('/category/:category', (req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM products WHERE category = ?').all(req.params['category']) as ProductRow[];
  res.json(rows.map(rowToProduct));
});

// GET /api/products
router.get('/', (req: Request, res: Response) => {
  const activeOnly = req.query['activeOnly'] === 'true';
  const rows = (
    activeOnly
      ? db.prepare('SELECT * FROM products WHERE active = 1').all()
      : db.prepare('SELECT * FROM products').all()
  ) as ProductRow[];
  res.json(rows.map(rowToProduct));
});

// GET /api/products/:id
router.get('/:id', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params['id']) as ProductRow | undefined;
  if (!row) return res.status(404).json({ error: 'Product not found' });
  res.json(rowToProduct(row));
});

// POST /api/products
router.post('/', (req: Request, res: Response) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });

  const { name, description, sku, price, stockQuantity, category, reorderLevel, active } = parsed.data;

  const existing = db.prepare('SELECT id FROM products WHERE sku = ?').get(sku);
  if (existing) return res.status(409).json({ error: 'SKU already exists' });

  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO products (name, description, sku, price, stock_quantity, category, reorder_level, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, description ?? null, sku, price, stockQuantity, category, reorderLevel ?? 10, active !== false ? 1 : 0, now);

  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid) as ProductRow;
  res.status(201).json(rowToProduct(row));
});

// PUT /api/products/:id
router.put('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params['id']) as ProductRow | undefined;
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });

  const { name, description, sku, price, stockQuantity, category, reorderLevel, active } = parsed.data;

  const skuConflict = db.prepare('SELECT id FROM products WHERE sku = ? AND id != ?').get(sku, req.params['id']);
  if (skuConflict) return res.status(409).json({ error: 'SKU already exists' });

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE products SET name=?, description=?, sku=?, price=?, stock_quantity=?, category=?, reorder_level=?, active=?, updated_at=?
    WHERE id=?
  `).run(name, description ?? null, sku, price, stockQuantity, category, reorderLevel ?? existing.reorder_level, active !== undefined ? (active ? 1 : 0) : existing.active, now, req.params['id']);

  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params['id']) as ProductRow;
  res.json(rowToProduct(row));
});

// POST /api/products/:id/reserve
router.post('/:id/reserve', (req: Request, res: Response) => {
  const quantity = parseInt(req.query['quantity'] as string ?? '1', 10);
  const now = new Date().toISOString();

  // Atomic check-and-decrement: avoids TOCTOU race under concurrent load.
  // The WHERE stock_quantity >= quantity guard ensures we never go negative.
  const result = db.prepare(
    'UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = ? WHERE id = ? AND stock_quantity >= ?'
  ).run(quantity, now, req.params['id'], quantity);

  if (result.changes === 0) {
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params['id']) as ProductRow | undefined;
    if (!row) return res.status(404).json({ error: 'Product not found' });
    return res.status(400).json({ error: 'Insufficient stock' });
  }

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params['id']) as ProductRow;
  res.json(rowToProduct(updated));
});

// POST /api/products/:id/restore
router.post('/:id/restore', (req: Request, res: Response) => {
  const quantity = parseInt(req.query['quantity'] as string ?? '1', 10);
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params['id']) as ProductRow | undefined;
  if (!row) return res.status(404).json({ error: 'Product not found' });

  const now = new Date().toISOString();
  db.prepare('UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE id = ?').run(quantity, now, req.params['id']);
  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params['id']) as ProductRow;
  res.json(rowToProduct(updated));
});

// DELETE /api/products/:id
router.delete('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params['id']);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params['id']);
  res.status(204).send();
});

export default router;
