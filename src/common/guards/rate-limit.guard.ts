import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export interface RateLimitOptions {
  limit: number;
  ttlMs: number;
}

export const RATE_LIMIT_KEY = 'trocly_rate_limit';
export const RateLimit = (limit: number, ttlMs = 60_000) =>
  SetMetadata(RATE_LIMIT_KEY, { limit, ttlMs } as RateLimitOptions);

/**
 * Phase 3.1 — Native ESM Sliding-Window Rate Limiter Guard (NestJS 12 compatible)
 * Protects OTP & Auth endpoints against brute-force / SMS bombing (HTTP 429).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const opts = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    ) ?? { limit: 120, ttlMs: 60_000 };

    const req = context.switchToHttp().getRequest();
    const ip =
      req?.headers?.['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req?.ip ||
      'unknown';
    const route = req?.route?.path || req?.url || 'global';
    const phone = req?.body?.phoneNumber ? `:${req.body.phoneNumber}` : '';
    const key = `${ip}:${route}${phone}`;

    const now = Date.now();
    const windowStart = now - opts.ttlMs;
    const prev = (this.hits.get(key) || []).filter((ts) => ts > windowStart);

    if (prev.length >= opts.limit) {
      throw new HttpException(
        'Trop de requêtes. Veuillez patienter une minute avant de réessayer.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    prev.push(now);
    this.hits.set(key, prev);

    // Periodic lightweight cleanup to bound memory
    if (this.hits.size > 5000) {
      for (const [k, timestamps] of this.hits.entries()) {
        if (timestamps.every((ts) => ts <= windowStart)) {
          this.hits.delete(k);
        }
      }
    }

    return true;
  }
}
