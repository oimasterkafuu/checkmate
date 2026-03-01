import { randomBytes } from 'node:crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { Server as SocketIOServer } from 'socket.io';
import { UserStore } from '../auth-store';

interface AuthPayload extends jwt.JwtPayload {
  sub: string;
  sid: string;
}

interface AuthUser {
  username: string;
}

interface AuthRequest extends FastifyRequest {
  authUser?: AuthUser;
}

class AuthService {
  private readonly jwtCookie = 'auth_token';

  private readonly jwtTtlSeconds = 7 * 24 * 3600;

  private readonly jwtSecret = process.env.JWT_SECRET ?? randomBytes(32).toString('hex');

  private readonly userSocketIds = new Map<string, Set<string>>();

  private ioRef: SocketIOServer | null = null;

  constructor(private readonly userStore: UserStore) {}

  isPublicPath(pathname: string): boolean {
    const normalizedPathname =
      pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

    if (normalizedPathname === '/login' || normalizedPathname === '/login.html') {
      return true;
    }
    if (normalizedPathname === '/postreceive') {
      return true;
    }
    if (
      normalizedPathname === '/api/auth/login' ||
      normalizedPathname === '/api/auth/register' ||
      normalizedPathname === '/api/auth/logout' ||
      normalizedPathname === '/api/auth/captcha'
    ) {
      return true;
    }
    if (normalizedPathname.startsWith('/socket.io/')) {
      return true;
    }
    if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|otf|ttf|mp3)$/i.test(normalizedPathname)) {
      return true;
    }
    return false;
  }

  getTokenFromCookie(cookieHeader?: string): string | null {
    if (!cookieHeader) {
      return null;
    }
    const cookies = this.parseCookies(cookieHeader);
    return cookies[this.jwtCookie] ?? null;
  }

  signAuthToken(username: string, sessionId: string): string {
    return jwt.sign({ sub: username, sid: sessionId }, this.jwtSecret, { expiresIn: this.jwtTtlSeconds });
  }

  verifyAuthToken(token: string | null): AuthUser | null {
    if (!token) {
      return null;
    }

    try {
      const payload = jwt.verify(token, this.jwtSecret) as AuthPayload;
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
        return null;
      }

      if (!this.userStore.isSessionValid(payload.sub, payload.sid)) {
        return null;
      }

      return { username: payload.sub };
    } catch {
      return null;
    }
  }

  setAuthCookie(reply: FastifyReply, token: string): void {
    const parts = [
      `${this.jwtCookie}=${encodeURIComponent(token)}`,
      'Path=/',
      `Max-Age=${this.jwtTtlSeconds}`,
      'HttpOnly',
      'SameSite=Lax',
    ];
    if (process.env.NODE_ENV === 'production') {
      parts.push('Secure');
    }
    reply.header('Set-Cookie', parts.join('; '));
  }

  clearAuthCookie(reply: FastifyReply): void {
    const parts = [`${this.jwtCookie}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
    if (process.env.NODE_ENV === 'production') {
      parts.push('Secure');
    }
    reply.header('Set-Cookie', parts.join('; '));
  }

  attachSocketServer(io: SocketIOServer): void {
    this.ioRef = io;
  }

  trackSocket(username: string, socketId: string): void {
    if (!this.userSocketIds.has(username)) {
      this.userSocketIds.set(username, new Set());
    }
    this.userSocketIds.get(username)?.add(socketId);
  }

  untrackSocket(username: string, socketId: string): void {
    const set = this.userSocketIds.get(username);
    if (!set) {
      return;
    }
    set.delete(socketId);
    if (set.size === 0) {
      this.userSocketIds.delete(username);
    }
  }

  disconnectUserSockets(username: string): void {
    if (!this.ioRef) {
      return;
    }
    const ids = this.userSocketIds.get(username);
    if (!ids) {
      return;
    }

    for (const id of ids) {
      this.ioRef.sockets.sockets.get(id)?.disconnect(true);
    }
    this.userSocketIds.delete(username);
  }

  disconnectOtherUserSockets(username: string, keepSocketId: string): void {
    if (!this.ioRef) {
      return;
    }
    const ids = this.userSocketIds.get(username);
    if (!ids) {
      return;
    }

    for (const id of ids) {
      if (id === keepSocketId) {
        continue;
      }
      this.ioRef.sockets.sockets.get(id)?.disconnect(true);
    }
  }

  private parseCookies(cookieHeader = ''): Record<string, string> {
    const cookies: Record<string, string> = {};
    for (const part of cookieHeader.split(';')) {
      const idx = part.indexOf('=');
      if (idx <= 0) {
        continue;
      }
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      cookies[key] = decodeURIComponent(value);
    }
    return cookies;
  }
}

export { AuthService };
export type { AuthRequest, AuthUser };
