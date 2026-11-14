import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'secret-temporaire-dev',
    });
  }

  async validate(payload: any) {
    // Renvoie le contenu du token décodé dans req.user
    return { sub: payload.sub, pendingProfile: payload.pendingProfile };
  }
}