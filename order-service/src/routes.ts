import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  getAllOrders,
  getOrderById,
  getOrderByNumber,
  getOrdersByCustomer,
  getOrdersByStatus,
  insertOrder,
  updateOrderStatus,
  deleteOrder,
} from './db.js';
import { getCustomer, getProduct, reserveStock, restoreStock } from './clients.js';
import type { CreateOrderRequest, OrderItemRow } from './types.js';

const router = Router();

const CreateOrderSchema = z.object({
  customerId: z.number(),
  items: z
    .array(
      z.object({
        productId: z.number(),
        quantity: z.number().int().min(1),
      }),
    )
    .nonempty(),
  shippingAddress: z.string().optional(),
  shippingCity: z.string().optional(),
  shippingState: z.string().optional(),
  shippingZip: z.string().optional(),
  shippingCountry: z.string().optional(),
});

const UpdateStatusSchema = z.object({
  status: z.enum(['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isCircuitOpen(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.includes('open') || err.constructor.name === 'OpenCircuitError')
  );
}

function mapErrorToStatus(err: unknown): { status: number; message: string } {
  if (!(err instanceof Error)) return { status: 500, message: 'Internal server error' };

  if (isCircuitOpen(err)) return { status: 503, message: 'Service temporarily unavailable' };
  if (err.message.includes('not found') || err.message.includes('not found'))
    return { status: 404, message: err.message };
  if (err.message.toLowerCase().includes('not found')) return { status: 404, message: err.message };
  if (err.message.toLowerCase().includes('insufficient stock'))
    return { status: 400, message: err.message };

  return { status: 500, message: err.message };
}

// ─── Saga ────────────────────────────────────────────────────────────────────

async function createOrderSaga(body: CreateOrderRequest) {
  const customer = await getCustomer(body.customerId);
  if (!customer) throw new Error(`Customer not found: ${body.customerId}`);

  const reservedItems: Array<{ productId: number; quantity: number }> = [];
  const orderItems: OrderItemRow[] = [];

  try {
    for (const item of body.items) {
      const product = await getProduct(item.productId);
      if (!product) throw new Error(`Product ${item.productId} not found`);

      const reserved = await reserveStock(item.productId, item.quantity);
      if (!reserved) throw new Error(`Insufficient stock for product ${item.productId}`);

      reservedItems.push({ productId: item.productId, quantity: item.quantity });
      orderItems.push({
        productId: item.productId,
        productName: product.name,
        productSku: product.sku,
        quantity: item.quantity,
        unitPrice: product.price,
        subtotal: item.quantity * product.price,
      });
    }

    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const totalAmount = orderItems.reduce((sum, i) => sum + i.subtotal, 0);

    return insertOrder({
      customerId: body.customerId,
      orderNumber,
      status: 'CONFIRMED',
      totalAmount,
      shippingAddress: body.shippingAddress,
      shippingCity: body.shippingCity,
      shippingState: body.shippingState,
      shippingZip: body.shippingZip,
      shippingCountry: body.shippingCountry,
      createdAt: new Date().toISOString(),
      items: orderItems,
    });
  } catch (err) {
    for (const reserved of reservedItems) {
      try {
        await restoreStock(reserved.productId, reserved.quantity);
      } catch (restoreErr) {
        console.error(`Failed to restore stock for product ${reserved.productId}:`, restoreErr);
      }
    }
    throw err;
  }
}

// ─── Routes (specific before parameterised) ──────────────────────────────────

router.get('/order-number/:orderNumber', (req: Request, res: Response) => {
  const order = getOrderByNumber(req.params.orderNumber);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  return res.json(order);
});

router.get('/customer/:customerId', (req: Request, res: Response) => {
  const orders = getOrdersByCustomer(Number(req.params.customerId));
  return res.json(orders);
});

router.get('/status/:status', (req: Request, res: Response) => {
  const orders = getOrdersByStatus(req.params.status.toUpperCase());
  return res.json(orders);
});

router.get('/', (_req: Request, res: Response) => {
  return res.json(getAllOrders());
});

router.get('/:id', (req: Request, res: Response) => {
  const order = getOrderById(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found' });
  return res.json(order);
});

router.post('/', async (req: Request, res: Response) => {
  const parsed = CreateOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }

  try {
    const order = await createOrderSaga(parsed.data as CreateOrderRequest);
    return res.status(201).json(order);
  } catch (err) {
    const { status, message } = mapErrorToStatus(err);
    return res.status(status).json({ error: message });
  }
});

router.patch('/:id/status', (req: Request, res: Response) => {
  const parsed = UpdateStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }

  const order = updateOrderStatus(Number(req.params.id), parsed.data.status);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  return res.json(order);
});

router.delete('/:id', (req: Request, res: Response) => {
  const deleted = deleteOrder(Number(req.params.id));
  if (!deleted) return res.status(404).json({ error: 'Order not found' });
  return res.status(204).send();
});

export default router;
