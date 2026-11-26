import { Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersModule } from '../users/users.module';
import { RefreshToken } from './refresh-token.entity';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';

const cacheLogger = new Logger('CacheConfig');

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forFeature([RefreshToken]),
    UsersModule,
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisHost = (config.get<string>('REDIS_HOST') || '').trim();
        const bullRedisUrl = (config.get<string>('BULL_REDIS_URL') || '').trim();
        const isLocalRedis =
          !redisHost ||
          redisHost === 'localhost' ||
          redisHost === '127.0.0.1' ||
          bullRedisUrl.includes('localhost') ||
          bullRedisUrl.includes('127.0.0.1');

        if (isLocalRedis) {
          cacheLogger.log(
            'No external Redis configured — using in-memory cache store (skipping localhost:6379)',
          );
        }
        // Always provide a non-blocking in-memory cache store so missing Redis never causes ECONNREFUSED at startup
        return {
          ttl: 600_000,
        };
      },
    }),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret:
          config.get<string>('JWT_SECRET') ||
          process.env.JWT_SECRET ||
          'secret-temporaire-dev',
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard],
  exports: [AuthService, JwtStrategy, JwtAuthGuard, PassportModule],
})
export class AuthModule { }
