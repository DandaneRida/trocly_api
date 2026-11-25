import { jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService — Meta WhatsApp Cloud API OTP', () => {
  let service: AuthService;
  const store = new Map<string, string>();
  const mockCache = {
    set: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    get: jest.fn(async (k: string) => store.get(k)),
    del: jest.fn(async (k: string) => {
      store.delete(k);
    }),
  } as any;
  const mockJwt = {
    sign: jest.fn(() => 'signed-jwt-token'),
  } as any;
  const mockUsers = {
    findByWhatsapp: jest.fn(async () => null),
  } as any;
  const mockRefreshRepo = {
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => v),
  } as any;

  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
    process.env.TEST_META_WHATSAPP = 'true';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '999999999999999';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-meta-token-not-real';
    process.env.WHATSAPP_API_VERSION = 'v25.0';
    service = new AuthService(mockJwt, mockUsers, mockCache, mockRefreshRepo);
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('normalizes Moroccan phone numbers to 212XXXXXXXXX without + or spaces', () => {
    expect(service.normalizeMoroccanPhone('0675629431')).toBe('212675629431');
    expect(service.normalizeMoroccanPhone('+212 675 62 94 31')).toBe(
      '212675629431',
    );
    expect(service.normalizeMoroccanPhone('00212675629431')).toBe(
      '212675629431',
    );
    expect(() => service.normalizeMoroccanPhone('+33612345678')).toThrow(
      BadRequestException,
    );
  });

  it('sends 6-digit OTP text message via Meta Graph API v25.0 and verifies it', async () => {
    let capturedUrl = '';
    let capturedOptions: any = null;

    global.fetch = jest.fn(async (url: any, options: any) => {
      capturedUrl = String(url);
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ messages: [{ id: 'wamid.TEST123' }] }),
      } as any;
    }) as any;

    const res = await service.sendOtp('06 75 62 94 31');
    expect(res.whatsappSent).toBe(true);
    expect(res.sid).toBe('wamid.TEST123');
    expect(capturedUrl).toBe(
      'https://graph.facebook.com/v25.0/999999999999999/messages',
    );
    expect(capturedOptions.headers.Authorization).toBe(
      'Bearer test-meta-token-not-real',
    );

    const parsedBody = JSON.parse(capturedOptions.body);
    expect(parsedBody.messaging_product).toBe('whatsapp');
    expect(parsedBody.to).toBe('212675629431');
    expect(parsedBody.type).toBe('text');
    expect(parsedBody.text.body).toMatch(
      /^Votre code de confirmation Trocly est : \d{6}\. Valable 10 minutes\.$/,
    );

    const savedOtp = store.get('otp_212675629431')!;
    expect(savedOtp).toMatch(/^\d{6}$/);

    const verifyRes = await service.verifyOtp('+212675629431', savedOtp);
    expect(verifyRes.isNewUser).toBe(true);
    expect(verifyRes.accessToken).toBe('signed-jwt-token');
  });

  it('does not crash when Meta API returns 400 (e.g. 24h window closed) and keeps OTP verifiable', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: {
            message: 'Re-engagement message (24h window closed)',
            code: 131047,
          },
        }),
    })) as any;

    const res = await service.sendOtp('0675629431');
    expect(res.whatsappSent).toBe(false);

    const savedOtp = store.get('otp_212675629431')!;
    expect(savedOtp).toMatch(/^\d{6}$/);

    const verifyRes = await service.verifyOtp('0675629431', savedOtp);
    expect(verifyRes.accessToken).toBe('signed-jwt-token');
  });
});
