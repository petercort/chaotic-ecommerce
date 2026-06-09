"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const index_1 = __importDefault(require("../src/index"));
const db_1 = require("../src/db");
jest.mock('../src/eureka');
process.env.NODE_ENV = 'test';
const validProduct = {
    name: 'Test Widget',
    description: 'A test widget',
    sku: 'TEST-WIDGET-001',
    price: 19.99,
    stockQuantity: 50,
    category: 'Electronics',
    reorderLevel: 5,
    active: true,
};
function cleanupTestProduct() {
    db_1.db.prepare("DELETE FROM products WHERE sku = ?").run(validProduct.sku);
}
describe('inventory-service', () => {
    beforeEach(() => {
        cleanupTestProduct();
    });
    afterAll(() => {
        cleanupTestProduct();
    });
    // ── Health ────────────────────────────────────────────────────────────────
    it('GET /actuator/health returns UP', async () => {
        const res = await (0, supertest_1.default)(index_1.default).get('/actuator/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'UP' });
    });
    // ── GET /api/products ─────────────────────────────────────────────────────
    it('GET /api/products returns seeded products', async () => {
        const res = await (0, supertest_1.default)(index_1.default).get('/api/products');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThanOrEqual(6);
    });
    it('GET /api/products?activeOnly=true returns only active', async () => {
        const res = await (0, supertest_1.default)(index_1.default).get('/api/products?activeOnly=true');
        expect(res.status).toBe(200);
        res.body.forEach((p) => expect(p.active).toBe(true));
    });
    // ── GET /api/products/low-stock ───────────────────────────────────────────
    it('GET /api/products/low-stock returns products at or below threshold', async () => {
        // Insert a low stock product
        db_1.db.prepare(`INSERT INTO products (name, sku, price, stock_quantity, category, reorder_level, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)`).run('Low Item', 'LOW-001', 5.00, 2, 'Test', 10, new Date().toISOString());
        const res = await (0, supertest_1.default)(index_1.default).get('/api/products/low-stock?threshold=5');
        expect(res.status).toBe(200);
        const skus = res.body.map((p) => p.sku);
        expect(skus).toContain('LOW-001');
        db_1.db.prepare("DELETE FROM products WHERE sku = 'LOW-001'").run();
    });
    // ── GET /api/products/sku/:sku ────────────────────────────────────────────
    it('GET /api/products/sku/:sku returns product', async () => {
        const res = await (0, supertest_1.default)(index_1.default).get('/api/products/sku/LAPTOP-001');
        expect(res.status).toBe(200);
        expect(res.body.sku).toBe('LAPTOP-001');
    });
    it('GET /api/products/sku/:sku returns 404 for unknown sku', async () => {
        const res = await (0, supertest_1.default)(index_1.default).get('/api/products/sku/NOPE-999');
        expect(res.status).toBe(404);
    });
    // ── GET /api/products/category/:category ──────────────────────────────────
    it('GET /api/products/category/:category returns products', async () => {
        const res = await (0, supertest_1.default)(index_1.default).get('/api/products/category/Electronics');
        expect(res.status).toBe(200);
        res.body.forEach((p) => expect(p.category).toBe('Electronics'));
    });
    // ── GET /api/products/:id ─────────────────────────────────────────────────
    it('GET /api/products/:id returns product', async () => {
        const list = await (0, supertest_1.default)(index_1.default).get('/api/products');
        const id = list.body[0].id;
        const res = await (0, supertest_1.default)(index_1.default).get(`/api/products/${id}`);
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(id);
    });
    it('GET /api/products/:id returns 404 for nonexistent', async () => {
        const res = await (0, supertest_1.default)(index_1.default).get('/api/products/999999');
        expect(res.status).toBe(404);
    });
    // ── POST /api/products ────────────────────────────────────────────────────
    it('POST /api/products creates a product', async () => {
        const before = (await (0, supertest_1.default)(index_1.default).get('/api/products')).body.length;
        const res = await (0, supertest_1.default)(index_1.default).post('/api/products').send(validProduct);
        expect(res.status).toBe(201);
        expect(res.body.sku).toBe(validProduct.sku);
        const after = (await (0, supertest_1.default)(index_1.default).get('/api/products')).body.length;
        expect(after).toBe(before + 1);
    });
    it('POST /api/products returns 400 for invalid payload', async () => {
        const res = await (0, supertest_1.default)(index_1.default).post('/api/products').send({ name: '' });
        expect(res.status).toBe(400);
    });
    it('POST /api/products returns 409 for duplicate SKU', async () => {
        await (0, supertest_1.default)(index_1.default).post('/api/products').send(validProduct);
        const res = await (0, supertest_1.default)(index_1.default).post('/api/products').send(validProduct);
        expect(res.status).toBe(409);
    });
    // ── POST /api/products/:id/reserve ───────────────────────────────────────
    it('POST /api/products/:id/reserve decrements stock atomically', async () => {
        const create = await (0, supertest_1.default)(index_1.default).post('/api/products').send({ ...validProduct, stockQuantity: 10 });
        const id = create.body.id;
        const res = await (0, supertest_1.default)(index_1.default).post(`/api/products/${id}/reserve?quantity=3`);
        expect(res.status).toBe(200);
        expect(res.body.stockQuantity).toBe(7);
    });
    it('POST /api/products/:id/reserve returns 400 for insufficient stock', async () => {
        const create = await (0, supertest_1.default)(index_1.default).post('/api/products').send({ ...validProduct, stockQuantity: 2 });
        const id = create.body.id;
        const res = await (0, supertest_1.default)(index_1.default).post(`/api/products/${id}/reserve?quantity=5`);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/insufficient stock/i);
    });
    it('POST /api/products/:id/reserve returns 404 for nonexistent product', async () => {
        const res = await (0, supertest_1.default)(index_1.default).post('/api/products/999999/reserve?quantity=1');
        expect(res.status).toBe(404);
    });
    // ── POST /api/products/:id/restore ───────────────────────────────────────
    it('POST /api/products/:id/restore increments stock', async () => {
        const create = await (0, supertest_1.default)(index_1.default).post('/api/products').send({ ...validProduct, stockQuantity: 5 });
        const id = create.body.id;
        const res = await (0, supertest_1.default)(index_1.default).post(`/api/products/${id}/restore?quantity=3`);
        expect(res.status).toBe(200);
        expect(res.body.stockQuantity).toBe(8);
    });
    // ── DELETE /api/products/:id ─────────────────────────────────────────────
    it('DELETE /api/products/:id deletes product', async () => {
        const create = await (0, supertest_1.default)(index_1.default).post('/api/products').send(validProduct);
        const id = create.body.id;
        const del = await (0, supertest_1.default)(index_1.default).delete(`/api/products/${id}`);
        expect(del.status).toBe(204);
        const get = await (0, supertest_1.default)(index_1.default).get(`/api/products/${id}`);
        expect(get.status).toBe(404);
    });
    it('DELETE /api/products/:id returns 404 for nonexistent', async () => {
        const res = await (0, supertest_1.default)(index_1.default).delete('/api/products/999999');
        expect(res.status).toBe(404);
    });
    // ── rowToProduct unit test ────────────────────────────────────────────────
    it('rowToProduct derives inStock and needsReorder correctly', () => {
        const inStockRow = {
            id: 1,
            name: 'Widget',
            description: null,
            sku: 'W-001',
            price: 9.99,
            stock_quantity: 5,
            category: 'Test',
            reorder_level: 3,
            active: 1,
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: null,
        };
        const product = (0, db_1.rowToProduct)(inStockRow);
        expect(product.inStock).toBe(true);
        expect(product.needsReorder).toBe(false); // 5 <= 3 is false
        const outOfStockRow = { ...inStockRow, stock_quantity: 0 };
        const oos = (0, db_1.rowToProduct)(outOfStockRow);
        expect(oos.inStock).toBe(false);
        expect(oos.needsReorder).toBe(true); // 0 <= 3
        const highStockRow = { ...inStockRow, stock_quantity: 100, reorder_level: 10 };
        const high = (0, db_1.rowToProduct)(highStockRow);
        expect(high.inStock).toBe(true);
        expect(high.needsReorder).toBe(false); // 100 <= 10 is false
    });
});
