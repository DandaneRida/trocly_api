import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitGuard } from './rate-limit.guard';

describe('RateLimitGuard (Unit)', () => {
  it('allows requests within limit and blocks excess with 429 Too Many Requests', () => {
    const reflector = {
      getAllAndOverride: () => ({ limit: 3, ttlMs: 60_000 }),
    } as unknown as Reflector;
    const guard = new RateLimitGuard(reflector);

    const makeCtx = () =>
      ({
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({
            ip: '127.0.0.1',
            url: '/auth/send-otp',
            body: { phoneNumber: '+212600112233' },
            headers: {},
          }),
        }),
      }) as any;

    expect(guard.canActivate(makeCtx())).toBe(true);
    expect(guard.canActivate(makeCtx())).toBe(true);
    expect(guard.canActivate(makeCtx())).toBe(true);

    try {
      guard.canActivate(makeCtx());
      fail('Expected 429 HttpException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(HttpException);
      expect(e.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });
});
