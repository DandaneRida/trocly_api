import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { CacheModule } from '@nestjs/cache-manager'; 

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersModule } from '../users/users.module';
import { RefreshToken } from './refresh-token.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken]),
    UsersModule,
    CacheModule.register(), // <-- 2. Ajoute le module ici
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'secretKey',
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}