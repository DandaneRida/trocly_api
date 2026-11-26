import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Inject,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';

import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { RefreshToken } from './refresh-token.entity';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private twilioClient: any = null;
  private readonly TWILIO_WHATSAPP_FROM =
    process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+1234567890';
  private readonly FREE_OTP_MODE = process.env.DISABLE_FREE_OTP !== 'true';

  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @InjectRepository(RefreshToken)
    private refreshTokenRepo: Repository<RefreshToken>,
  ) {}

  private async getTwilioClient(): Promise<any | null> {
    if (this.twilioClient) return this.twilioClient;
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (
      process.env.ENABLE_TWILIO_WHATSAPP === 'true' &&
      accountSid &&
      authToken
    ) {
      const { Twilio } = await import('twilio');
      this.twilioClient = new Twilio(accountSid, authToken);
      return this.twilioClient;
    }
    return null;
  }

  /**
   * Generate a 6-digit OTP code
   */
  private generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Normalize Moroccan phone number to international digits without '+' or spaces.
   * Examples:
   * - "0675629431"      -> "212675629431"
   * - "+212 675-629431" -> "212675629431"
   * - "00212675629431"  -> "212675629431"
   * - "212675629431"    -> "212675629431"
   */
  normalizeMoroccanPhone(phoneNumber: string): string {
    let digits = (phoneNumber || '').replace(/\D/g, '');
    if (digits.startsWith('00212')) {
      digits = digits.slice(2);
    } else if (digits.startsWith('0') && digits.length === 10) {
      digits = '212' + digits.slice(1);
    } else if (digits.length === 9 && /^[5-7]/.test(digits)) {
      digits = '212' + digits;
    }

    if (!/^212\d{9}$/.test(digits)) {
      throw new BadRequestException(
        'Numéro marocain invalide. Utilisez le format 06XXXXXXXX ou +2126XXXXXXXX.',
      );
    }
    return digits;
  }

  private formatWhatsAppNumber(phoneNumber: string): string {
    return `whatsapp:+${this.normalizeMoroccanPhone(phoneNumber)}`;
  }

  /**
   * Validate phone number is Moroccan (+212 / 06 / 07 / 05)
   */
  private validateMoroccanNumber(phoneNumber: string): boolean {
    try {
      this.normalizeMoroccanPhone(phoneNumber);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send OTP confirmation message via Meta WhatsApp Cloud API (Graph API).
   * Never throws: logs Meta API errors cleanly (e.g., 24h window closed or expired token)
   * so dev/test workflows continue uninterrupted.
   */
  private async sendViaMetaWhatsApp(
    toDigits: string,
    otp: string,
  ): Promise<{ sent: boolean; messageId?: string }> {
    const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
    const accessToken = (process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
    const apiVersion = (process.env.WHATSAPP_API_VERSION || 'v25.0').trim();

    if (!phoneNumberId || !accessToken) {
      return { sent: false };
    }

    // Skip external Graph API calls on synthetic E2E test runs unless explicitly testing Meta
    if (
      process.env.JEST_WORKER_ID !== undefined &&
      process.env.TEST_META_WHATSAPP !== 'true'
    ) {
      return { sent: false };
    }

    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      to: toDigits,
      type: 'text',
      text: {
        preview_url: false,
        body: `Votre code de confirmation Trocly est : ${otp}. Valable 10 minutes.`,
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });

      const rawText = await response.text();
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = { raw: rawText };
      }

      if (!response.ok) {
        const metaErr =
          data?.error?.message ||
          data?.raw ||
          `HTTP ${response.status}`;
        const metaCode = data?.error?.code ? ` (code ${data.error.code})` : '';
        this.logger.warn(
          `[META WHATSAPP] Échec d'envoi vers ${toDigits}${metaCode}: ${metaErr}`,
        );
        return { sent: false };
      }

      const messageId = data?.messages?.[0]?.id as string | undefined;
      this.logger.log(
        `[META WHATSAPP] Code OTP envoyé vers ${toDigits} (wamid: ${messageId || 'ok'})`,
      );
      return { sent: true, messageId };
    } catch (error: any) {
      this.logger.warn(
        `[META WHATSAPP] Erreur réseau vers ${toDigits}: ${error?.message || error}`,
      );
      return { sent: false };
    }
  }

  // ==================== OTP ENDPOINTS ====================

  /**
   * A2 - Send 6-digit OTP via Meta WhatsApp Cloud API (with Twilio & dev/log fallback)
   * Supports: +212XXXXXXXXX, 0XXXXXXXXX, 212XXXXXXXXX
   */
  async sendOtp(
    phoneNumber: string,
  ): Promise<{ message: string; sid?: string; whatsappSent?: boolean }> {
    const normalizedDigits = this.normalizeMoroccanPhone(phoneNumber);
    const otp = this.generateOTP();

    // Store in cache for 10 minutes (600,000 ms) under normalized digits + raw input
    const ttlMs = 600_000;
    await this.cacheManager.set(`otp_${normalizedDigits}`, otp, ttlMs);
    await this.cacheManager.set(`otp_${phoneNumber}`, otp, ttlMs);

    // 1. Primary: Meta WhatsApp Cloud API
    const metaResult = await this.sendViaMetaWhatsApp(normalizedDigits, otp);
    let externalId: string | undefined = metaResult.messageId;

    // 2. Optional legacy fallback: Twilio WhatsApp if explicitly enabled and Meta wasn't used
    if (!metaResult.sent && process.env.ENABLE_TWILIO_WHATSAPP === 'true') {
      try {
        const client = await this.getTwilioClient();
        if (client) {
          const whatsappNumber = this.formatWhatsAppNumber(phoneNumber);
          const message = await client.messages.create({
            from: this.TWILIO_WHATSAPP_FROM,
            to: whatsappNumber,
            body: `Votre code de confirmation Trocly est : ${otp}. Valable 10 minutes.`,
          });
          externalId = message.sid;
          this.logger.log(
            `[TWILIO] OTP envoyé vers +${normalizedDigits} (SID: ${message.sid})`,
          );
        }
      } catch (error: any) {
        this.logger.warn(`[TWILIO ERROR] ${error?.message || error}`);
      }
    }

    // 3. Always keep OTP visible in server logs in dev/test or when external send fails
    if (!metaResult.sent || process.env.NODE_ENV !== 'production') {
      this.logger.log(
        `[OTP] Code de confirmation pour +${normalizedDigits} : ${otp} (valable 10 min)`,
      );
    }

    return {
      message: 'Code de confirmation envoyé via WhatsApp. Valable 10 minutes.',
      sid: externalId,
      whatsappSent: metaResult.sent,
    };
  }

  /**
   * A2 - Verify OTP code
   * Accepts the generated 6-digit OTP (and demo fallback "123456" when FREE_OTP_MODE is active)
   */
  async verifyOtp(
    phoneNumber: string,
    code: string,
  ): Promise<{ accessToken: string; refreshToken?: string; isNewUser: boolean }> {
    const normalizedDigits = this.normalizeMoroccanPhone(phoneNumber);

    const savedOtp =
      (await this.cacheManager.get<string>(`otp_${normalizedDigits}`)) ??
      (await this.cacheManager.get<string>(`otp_${phoneNumber}`));

    const trimmedCode = (code || '').trim();
    const isValid = this.FREE_OTP_MODE
      ? trimmedCode === '123456' || (savedOtp != null && trimmedCode === savedOtp)
      : savedOtp != null && trimmedCode === savedOtp;

    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired OTP code.');
    }

    // Clear OTP from cache
    await this.cacheManager.del(`otp_${normalizedDigits}`);
    await this.cacheManager.del(`otp_${phoneNumber}`);

    // Check if user exists (by raw input or canonical +212 format)
    const canonicalPlus = `+${normalizedDigits}`;
    const user =
      (await this.usersService.findByWhatsapp(phoneNumber)) ||
      (phoneNumber !== canonicalPlus
        ? await this.usersService.findByWhatsapp(canonicalPlus)
        : null);

    if (!user) {
      const tempPayload = { sub: canonicalPlus, pendingProfile: true };
      const tempToken = this.jwtService.sign(tempPayload, { expiresIn: '1h' });
      return {
        accessToken: tempToken,
        isNewUser: true,
      };
    }

    const tokens = await this.generateTokens(user);
    return {
      ...tokens,
      isNewUser: false,
    };
  }

  // ==================== PROFILE & TOKEN MANAGEMENT ====================

  /**
   * A3 - Complete profile for new users
   * Called after OTP verification with temp token
   */
  async completeProfile(
    phoneNumber: string,
    displayName: string,
    cityId: number,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    if (!displayName || !cityId) {
      throw new BadRequestException('Display name and city are required.');
    }

    const newUser = await this.usersService.create({
      whatsappNumber: phoneNumber,
      displayName,
      city: { id: cityId } as any,
    });

    return this.generateTokens(newUser);
  }

  /**
   * A4 - Generate JWT + Refresh tokens
   */
  async generateTokens(user: User): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = { sub: user.id };

    // Access token: short-lived (15 minutes)
    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });

    // Refresh token: long-lived (30 days), stored securely
    const plainRefreshToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(plainRefreshToken).digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const rt = this.refreshTokenRepo.create({
      user: { id: user.id },
      tokenHash,
      expiresAt,
    });

    await this.refreshTokenRepo.save(rt);

    return {
      accessToken,
      refreshToken: plainRefreshToken,
    };
  }

  /**
   * A4 - Refresh access token using refresh token
   * Implements token rotation: old token is revoked, new one issued
   */
  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');

    const rt = await this.refreshTokenRepo.findOne({
      where: { tokenHash },
      relations: { user: true },
    });

    if (!rt || rt.revokedAt || rt.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid, expired, or revoked refresh token.');
    }

    // Revoke old token (rotation)
    rt.revokedAt = new Date();
    await this.refreshTokenRepo.save(rt);

    // Issue new tokens
    return this.generateTokens(rt.user);
  }

  /**
   * A5 - Logout (revoke refresh token)
   */
  async logout(refreshToken: string): Promise<{ message: string }> {
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');

    const rt = await this.refreshTokenRepo.findOne({
      where: { tokenHash },
    });

    if (rt && !rt.revokedAt) {
      rt.revokedAt = new Date();
      await this.refreshTokenRepo.save(rt);
    }

    return { message: 'Logged out successfully.' };
  }
}
