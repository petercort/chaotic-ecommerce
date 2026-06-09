import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { createUser, findUserByEmail, findUserByUsername } from './db.js';
import { hashPassword, signJwt, verifyPassword } from './auth.js';

const router = Router();

const registerSchema = z.object({
  username: z.string().min(1).max(255),
  email: z.string().min(1).email().max(255),
  password: z.string().min(8).max(255),
});

const loginSchema = z.object({
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(255),
});

function issueToken(user: { id: number; username: string; email: string }): string {
  const secret = process.env.JWT_SECRET ?? 'dev-jwt-secret';
  return signJwt(
    {
      sub: String(user.id),
      username: user.username,
      email: user.email,
      type: 'user',
    },
    secret,
    60 * 60,
  );
}

router.post('/register', async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    console.warn('[auth-service] Rejected invalid register payload');
    return res.status(400).json({ errors: parsed.error.errors, requestId: randomUUID() });
  }

  const { username, email, password } = parsed.data;

  if ((await findUserByUsername(username)) || (await findUserByEmail(email))) {
    return res.status(409).json({ error: 'Username or email already exists' });
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser({ username, email, passwordHash });
  return res.status(201).json({ id: user.id, username: user.username, email: user.email });
});

router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    console.warn('[auth-service] Rejected invalid login payload');
    return res.status(400).json({ errors: parsed.error.errors, requestId: randomUUID() });
  }

  const { username, password } = parsed.data;
  const user = await findUserByUsername(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  return res.json({ token: issueToken({ id: user.id, username: user.username, email: user.email }) });
});

export default router;