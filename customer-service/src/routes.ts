import { Router, Request, Response } from "express";
import { z } from "zod";
import pool, { rowToCustomer } from "./db";
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
router.get("/", async (_req: Request, res: Response) => {
  const { rows } = await pool.query<CustomerRow>("SELECT * FROM customers ORDER BY id");
  res.json(rows.map(rowToCustomer));
});

// GET /api/customers/email/:email — must come before /:id
router.get("/email/:email", async (req: Request, res: Response) => {
  const { rows } = await pool.query<CustomerRow>("SELECT * FROM customers WHERE email = $1", [req.params.email]);
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json(rowToCustomer(row));
});

// GET /api/customers/:id
router.get("/:id", async (req: Request, res: Response) => {
  const { rows } = await pool.query<CustomerRow>("SELECT * FROM customers WHERE id = $1", [req.params.id]);
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json(rowToCustomer(row));
});

// POST /api/customers
router.post("/", async (req: Request, res: Response) => {
  const result = customerSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ errors: result.error.errors });
    return;
  }

  const { firstName, lastName, email, phone, address, city, state, zipCode, country } = result.data;
  const existing = await pool.query("SELECT id FROM customers WHERE email = $1", [email]);
  if (existing.rows.length > 0) {
    res.status(409).json({ error: "Email already exists" });
    return;
  }

  const { rows } = await pool.query<CustomerRow>(
    `INSERT INTO customers (first_name, last_name, email, phone, address, city, state, zip_code, country)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [firstName, lastName, email, phone, address ?? null, city ?? null, state ?? null, zipCode ?? null, country ?? null]
  );
  res.status(201).json(rowToCustomer(rows[0]));
});

// PUT /api/customers/:id
router.put("/:id", async (req: Request, res: Response) => {
  const existing = await pool.query<CustomerRow>("SELECT * FROM customers WHERE id = $1", [req.params.id]);
  if (existing.rows.length === 0) {
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
  const conflict = await pool.query("SELECT id FROM customers WHERE email = $1 AND id != $2", [email, req.params.id]);
  if (conflict.rows.length > 0) {
    res.status(409).json({ error: "Email already exists" });
    return;
  }

  const { rows } = await pool.query<CustomerRow>(
    `UPDATE customers
     SET first_name=$1, last_name=$2, email=$3, phone=$4, address=$5, city=$6, state=$7, zip_code=$8, country=$9, updated_at=NOW()
     WHERE id=$10
     RETURNING *`,
    [firstName, lastName, email, phone, address ?? null, city ?? null, state ?? null, zipCode ?? null, country ?? null, req.params.id]
  );
  res.json(rowToCustomer(rows[0]));
});

// DELETE /api/customers/:id
router.delete("/:id", async (req: Request, res: Response) => {
  const result = await pool.query("DELETE FROM customers WHERE id = $1", [req.params.id]);
  if (result.rowCount === 0) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.status(204).send();
});

export default router;
