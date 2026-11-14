import { Injectable, BadRequestException, UnauthorizedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Twilio } from 'twilio';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';

import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { RefreshToken } from './refresh-token.entity';

@Injectable()
export class AuthService {
  private twilioClient: Twilio;
  private readonly TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+1234567890';
  private readonly DEV_MODE = process.env.NODE_ENV !== 'production';

  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @InjectRepository(RefreshToken) private refreshTokenRepo: Repository<RefreshToken>,
  ) {
    // Initialize Twilio client
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (accountSid && authToken) {
      this.twilioClient = new Twilio(accountSid, authToken);
    } else if (!this.DEV_MODE) {
      throw new Error('Twilio credentials missing in production mode');
    }
  }

  /**
   * Generate a 6-digit OTP code
   */
  private generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Format phone number to international format
   * Input: +212612345678 or 0612345678 or 612345678
   * Output: whatsapp:+212612345678
   */
  private formatWhatsAppNumber(phoneNumber: string): string {
    let formatted = phoneNumber.replace(/\D/g, ''); // Remove non-digits

    // Handle Moroccan format variations
    if (formatted.startsWith('0')) {
      formatted = '212' + formatted.slice(1); // 0612... → 212612...
    } else if (!formatted.startsWith('212')) {
      throw new BadRequestException('Invalid Moroccan phone number. Use +212XXXXXXXXX or 0XXXXXXXXX');
    }

    return `whatsapp:+${formatted}`;
  }

  /**
   * Validate phone number is Moroccan (+212)
   */
  private validateMoroccanNumber(phoneNumber: string): boolean {
    const cleaned = phoneNumber.replace(/\D/g, '');
    return cleaned.startsWith('212') || cleaned.startsWith('0');
  }

  // ==================== OTP ENDPOINTS ====================

  /**
   * A2 - Send OTP via WhatsApp
   * Supports: +212XXXXXXXXX, 0XXXXXXXXX, 212XXXXXXXXX
   */
  async sendOtp(phoneNumber: string): Promise<{ message: string; sid?: string }> {
    // Validate Moroccan number
    if (!this.validateMoroccanNumber(phoneNumber)) {
      throw new BadRequestException(
        'Only Moroccan numbers (+212) are allowed. Format: +212XXXXXXXXX or 0XXXXXXXXX',
      );
    }

    // Generate OTP
    const otp = this.generateOTP();

    // Store in cache (expires in 5 minutes = 300 seconds)
    const cacheKey = `otp_${phoneNumber}`;
    await this.cacheManager.set(cacheKey, otp, 300000); // Cache manager uses milliseconds

    // Attempt: Send via Twilio WhatsApp
    let twilioSid = null;
    if (this.twilioClient && !this.DEV_MODE) {
      try {
        const whatsappNumber = this.formatWhatsAppNumber(phoneNumber);
        const message = await this.twilioClient.messages.create({
          from: this.TWILIO_WHATSAPP_FROM,
          to: whatsappNumber,
          body: `Your Trocly verification code is: ${otp}\n\nValid for 5 minutes. Never share this code.`,
        });
        twilioSid = message.sid;
        console.log(`[TWILIO] OTP sent via WhatsApp to ${phoneNumber} (SID: ${message.sid})`);
      } catch (error) {
        console.error('[TWILIO ERROR]', (error as any)?.message || error);
        // In production, we should probably throw. For now, log and continue (fallback to email/SMS)
        if (!this.DEV_MODE) {
          throw new BadRequestException('Failed to send OTP via WhatsApp. Please try again.');
        }
      }
    } else if (this.DEV_MODE) {
      // Development mode: Log to console
      console.log(`[DEV] OTP for ${phoneNumber}: ${otp} (valid for 5 min)`);
    }

    return {
      message: 'OTP sent via WhatsApp. Valid for 5 minutes.',
      sid: twilioSid || undefined,
    };
  }

  /**
   * A2 - Verify OTP code
   * In dev mode: accept code "123456" or actual OTP
   */
  async verifyOtp(
    phoneNumber: string,
    code: string,
  ): Promise<{ accessToken: string; refreshToken?: string; isNewUser: boolean }> {
    if (!this.validateMoroccanNumber(phoneNumber)) {
      throw new BadRequestException('Invalid Moroccan phone number.');
    }

    const cacheKey = `otp_${phoneNumber}`;
    const savedOtp = await this.cacheManager.get<string>(cacheKey);

    // Verify OTP (allow dev code "123456" in dev mode)
    const isValid = this.DEV_MODE ? code === '123456' || code === savedOtp : code === savedOtp;

    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired OTP code.');
    }

    // Clear OTP from cache
    await this.cacheManager.del(cacheKey);

    // Check if user exists
    const user = await this.usersService.findByWhatsapp(phoneNumber);

    if (!user) {
      // New user: return temp token for profile completion
      const tempPayload = { sub: phoneNumber, pendingProfile: true };
      const tempToken = this.jwtService.sign(tempPayload, { expiresIn: '1h' });
      return {
        accessToken: tempToken,
        isNewUser: true,
      };
    }

    // Existing user: generate JWT tokens
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
