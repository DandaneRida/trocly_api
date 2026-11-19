import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: true, // Évite d'expirer pendant le dev local
      secretOrKey: process.env.JWT_SECRET || 'secret-temporaire-dev',
    });
  }

  async validate(payload: any) {
    if (!payload || !payload.sub) {
      throw new UnauthorizedException('Token invalide');
    }
    // Si c'est un token temporaire (inscription non terminée)
    if (payload.pendingProfile) {
      throw new UnauthorizedException('Veuillez compléter votre profil avant de publier.');
    }
    return { sub: payload.sub };
  }
}
