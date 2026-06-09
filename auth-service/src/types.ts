export interface AuthUser {
  id: number;
  username: string;
  email: string;
  passwordHash: string;
  createdAt: string | Date;
}

export interface AuthUserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  created_at: string | Date;
}

export interface AuthTokenPayload {
  sub: string;
  username: string;
  email: string;
  type: 'user' | 'service';
  iat?: number;
  exp?: number;
}