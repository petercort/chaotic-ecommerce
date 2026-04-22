import { Router, Request, Response } from "express";
import { z } from "zod";
import db, { rowToCustomer } from "./db";
import type { CustomerRow } from "./types";

const router = Router();

const customerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  country: z.string().optional(),
});

// GET /api/customers
router.get("/", (_req: Request, res: Response) => {
  const rows = db.prepare("SELECT * FROM customers ORDER BY id").all() as CustomerRow[];
  res.json(rows.map(rowToCustomer));
});

// GET /api/customers/email/:email — must come before /:id
router.get("/email/:email", (req: Request, res: Response) => {
  const row = db.prepare("SELECT * FROM customers WHERE email = ?").get(req.params.email) as CustomerRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json(rowToCustomer(row));
});

// GET /api/customers/:id
router.get("/:id", (req: Request, res: Response) => {
  const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id) as CustomerRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json(rowToCustomer(row));
});

// POST /api/customers
router.post("/", (req: Request, res: Response) => {
  const result = customerSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ errors: result.error.errors });
    return;
  }

  const { firstName, lastName, email, phone, address, city, state, zipCode, country } = result.data;
  const existing = db.prepare("SELECT id FROM customers WHERE email = ?").get(email);
  if (existing) {
    res.status(409).json({ error: "Email already exists" });
    return;
  }

  const createdAt = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO customers (first_name, last_name, email, phone, address, city, state, zip_code, country, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(firstName, lastName, email, phone, address ?? null, city ?? null, state ?? null, zipCode ?? null, country ?? null, createdAt);

  const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(info.lastInsertRowid) as CustomerRow;
  res.status(201).json(rowToCustomer(row));
});

// PUT /api/customers/:id
router.put("/:id", (req: Request, res: Response) => {
  const existing = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id) as CustomerRow | undefined;
  if (!existing) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  const result = customerSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ errors: result.error.errors });
    return;
  }

  const { firstName, lastName, email, phone, address, city, state, zipCode, country } = result.data;

  // Check email conflict with another customer
  const conflict = db.prepare("SELECT id FROM customers WHERE email = ? AND id != ?").get(email, req.params.id);
  if (conflict) {
    res.status(409).json({ error: "Email already exists" });
    return;
  }

  const updatedAt = new Date().toISOString();
  db.prepare(`
    UPDATE customers SET first_name=?, last_name=?, email=?, phone=?, address=?, city=?, state=?, zip_code=?, country=?, updated_at=?
    WHERE id=?
  `).run(firstName, lastName, email, phone, address ?? null, city ?? null, state ?? null, zipCode ?? null, country ?? null, updatedAt, req.params.id);

  const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id) as CustomerRow;
  res.json(rowToCustomer(row));
});

// DELETE /api/customers/:id
router.delete("/:id", (req: Request, res: Response) => {
  const existing = db.prepare("SELECT id FROM customers WHERE id = ?").get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  db.prepare("DELETE FROM customers WHERE id = ?").run(req.params.id);
  res.status(204).send();
});

export default router;
