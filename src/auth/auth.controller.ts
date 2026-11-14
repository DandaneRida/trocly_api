import { Controller, Post, Body, Headers, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
  ) {}

  @Post('send-otp')
  async sendOtp(@Body('phoneNumber') phoneNumber: string) {
    if (!phoneNumber) throw new BadRequestException('Le numéro de téléphone est requis.');
    return this.authService.sendOtp(phoneNumber);
  }

  @Post('verify-otp')
  async verifyOtp(
    @Body('phoneNumber') phoneNumber: string,
    @Body('code') code: string,
  ) {
    if (!phoneNumber || !code) throw new BadRequestException('Numéro et code requis.');
    return this.authService.verifyOtp(phoneNumber, code);
  }

  @Post('complete-profile')
  async completeProfile(
    @Headers('authorization') authHeader: string,
    @Body('displayName') displayName: string,
    @Body('cityId') cityId: number,
  ) {
    if (!authHeader) throw new UnauthorizedException('Token temporaire manquant.');
    if (!displayName || !cityId) throw new BadRequestException('Nom et ville requis.');

    const token = authHeader.split(' ')[1];
    try {
      // On décode le token temporaire pour récupérer le numéro de téléphone
      const decoded = this.jwtService.verify(token);
      if (!decoded.pendingProfile) {
        throw new UnauthorizedException('Ce token n\'est pas un token de création de profil.');
      }
      return this.authService.completeProfile(decoded.sub, displayName, cityId);
    } catch (error) {
      throw new UnauthorizedException('Token temporaire invalide ou expiré.');
    }
  }

  @Post('refresh')
  async refreshToken(@Body('refreshToken') refreshToken: string) {
    if (!refreshToken) throw new BadRequestException('Le refreshToken est requis.');
    return this.authService.refresh(refreshToken);
  }

  @Post('logout')
  async logout(@Body('refreshToken') refreshToken: string) {
    if (!refreshToken) throw new BadRequestException('Le refreshToken est requis.');
    return this.authService.logout(refreshToken);
  }
}