"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const index_js_1 = require("../src/index.js");
const db_js_1 = require("../src/db.js");
const auth_js_1 = require("../src/auth.js");
jest.mock('../src/eureka');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
const validUser = {
    username: 'alice',
    email: 'alice@example.com',
    password: 'super-secret',
};
describe('auth-service', () => {
    beforeAll(async () => {
        await (0, db_js_1.runMigrations)();
    });
    afterAll(async () => {
        await (0, db_js_1.closePool)();
    });
    beforeEach(async () => {
        await db_js_1.pool.query('DELETE FROM users');
    });
    it('GET /actuator/health returns UP', async () => {
        const res = await (0, supertest_1.default)(index_js_1.app).get('/actuator/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'UP' });
    });
    it('POST /auth/register creates a user', async () => {
        const res = await (0, supertest_1.default)(index_js_1.app).post('/auth/register').send(validUser);
        expect(res.status).toBe(201);
        expect(res.body.username).toBe(validUser.username);
        expect(res.body.email).toBe(validUser.email);
    });
    it('POST /auth/register rejects invalid payload', async () => {
        const res = await (0, supertest_1.default)(index_js_1.app).post('/auth/register').send({ username: '', email: 'bad', password: 'short' });
        expect(res.status).toBe(400);
        expect(res.body.errors).toEqual(expect.any(Array));
    });
    it('POST /auth/register rejects duplicates', async () => {
        await (0, supertest_1.default)(index_js_1.app).post('/auth/register').send(validUser);
        const res = await (0, supertest_1.default)(index_js_1.app).post('/auth/register').send(validUser);
        expect(res.status).toBe(409);
    });
    it('POST /auth/login returns a valid token', async () => {
        await (0, supertest_1.default)(index_js_1.app).post('/auth/register').send(validUser);
        const res = await (0, supertest_1.default)(index_js_1.app).post('/auth/login').send({
            username: validUser.username,
            password: validUser.password,
        });
        expect(res.status).toBe(200);
        expect(typeof res.body.token).toBe('string');
        const payload = (0, auth_js_1.verifyJwt)(res.body.token, process.env.JWT_SECRET ?? 'test-secret');
        expect(payload.username).toBe(validUser.username);
        expect(payload.email).toBe(validUser.email);
        expect(payload.type).toBe('user');
    });
    it('POST /auth/login rejects invalid credentials', async () => {
        await (0, supertest_1.default)(index_js_1.app).post('/auth/register').send(validUser);
        const res = await (0, supertest_1.default)(index_js_1.app).post('/auth/login').send({
            username: validUser.username,
            password: 'wrong-password',
        });
        expect(res.status).toBe(401);
    });
});
