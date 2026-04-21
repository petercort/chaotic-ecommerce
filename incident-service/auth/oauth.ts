// ---------------------------------------------------------------------------
// GitHub OAuth routes
// ---------------------------------------------------------------------------
// Flow:
//   GET /auth/github          → redirect to GitHub with CSRF state
//   GET /auth/github/callback → exchange code for token, store in session
//   GET /auth/me              → return current user (no token exposed)
//   POST /auth/logout         → destroy session
// ---------------------------------------------------------------------------

import { Router } from 'express';
import crypto from 'crypto';
import type { Request, Response } from 'express';

const router = Router();

const CLIENT_ID     = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const SCOPES        = 'user:email read:user public_repo';

function isConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

// ---------------------------------------------------------------------------
// Step 1 — redirect user to GitHub authorisation page
// ---------------------------------------------------------------------------
router.get('/github', (req: Request, res: Response) => {
  if (!isConfigured()) {
    return res.redirect('/login?error=oauth_not_configured');
  }

  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    scope: SCOPES,
    state,
    allow_signup: 'true',
  });

  return res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// ---------------------------------------------------------------------------
// Step 2 — GitHub redirects back with ?code=...&state=...
// ---------------------------------------------------------------------------
router.get('/github/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const error = req.query.error as string | undefined;

  if (error) {
    return res.redirect(`/login?error=${encodeURIComponent(error)}`);
  }

  if (!state || state !== req.session.oauthState) {
    return res.redirect('/login?error=invalid_state');
  }
  delete req.session.oauthState;

  if (!code) {
    return res.redirect('/login?error=no_code');
  }

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'incident-command-center',
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
      }),
    });

    if (!tokenRes.ok) {
      console.error('[oauth] token exchange HTTP error:', tokenRes.status);
      return res.redirect('/login?error=token_exchange_failed');
    }

    const tokenData = await tokenRes.json() as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (tokenData.error || !tokenData.access_token) {
      console.error('[oauth] token exchange error:', tokenData.error_description || tokenData.error);
      return res.redirect(`/login?error=${encodeURIComponent(tokenData.error || 'token_exchange_failed')}`);
    }

    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'User-Agent': 'incident-command-center',
        'Accept': 'application/vnd.github+json',
      },
    });

    if (!userRes.ok) {
      console.error('[oauth] user fetch error:', userRes.status);
      return res.redirect('/login?error=user_fetch_failed');
    }

    const user = await userRes.json() as {
      id: number;
      login: string;
      name?: string;
      avatar_url: string;
      html_url: string;
    };

    req.session.githubToken = tokenData.access_token;
    req.session.user = {
      id: user.id,
      login: user.login,
      name: user.name || user.login,
      avatar: user.avatar_url,
      url: user.html_url,
    };

    console.log(`[oauth] authenticated: ${user.login}`);
    return res.redirect('/');
  } catch (err) {
    console.error('[oauth] callback error:', (err as Error).message);
    return res.redirect('/login?error=server_error');
  }
});

// ---------------------------------------------------------------------------
// GET /auth/me — returns current user for the UI (no token exposed)
// ---------------------------------------------------------------------------
router.get('/me', (req: Request, res: Response) => {
  if (!req.session?.user) {
    return res.json({ authenticated: false, oauthConfigured: isConfigured() });
  }
  return res.json({
    authenticated: true,
    oauthConfigured: true,
    user: req.session.user,
  });
});

// ---------------------------------------------------------------------------
// POST /auth/logout — destroy session
// ---------------------------------------------------------------------------
router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

export default router;
