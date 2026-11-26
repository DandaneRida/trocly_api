import 'dotenv/config';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppService } from './app.service';
import { HealthController } from './health/health.controller';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import {
  buildTypeOrmModuleOptions,
  initializeAndBootstrapDataSource,
} from './database/typeorm-config';

import { CitiesModule } from './cities/cities.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ListingsModule } from './listings/listings.module';
import { MeetingsModule } from './meetings/meetings.module';
import { OffersModule } from './offers/offers.module';
import { ReviewsModule } from './reviews/reviews.module';
import { ReportsModule } from './reports/reports.module';
import { MessagesModule } from './messages/messages.module';
import { AdminModule } from './admin/admin.module';
import { UploadModule } from './upload/upload.module';
import { NotificationsModule } from './notifications/notifications.module';
import { FavoritesModule } from './favorites/favorites.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildTypeOrmModuleOptions({
          ...process.env,
          DATABASE_URL:
            process.env.DATABASE_URL || config.get<string>('DATABASE_URL'),
          POSTGRES_URL:
            process.env.POSTGRES_URL || config.get<string>('POSTGRES_URL'),
          NEON_DATABASE_URL:
            process.env.NEON_DATABASE_URL ||
            config.get<string>('NEON_DATABASE_URL'),
          DB_HOST: process.env.DB_HOST || config.get<string>('DB_HOST'),
          DB_PORT: process.env.DB_PORT || config.get<string>('DB_PORT'),
          DB_USERNAME:
            process.env.DB_USERNAME || config.get<string>('DB_USERNAME'),
          DB_PASSWORD:
            process.env.DB_PASSWORD || config.get<string>('DB_PASSWORD'),
          DB_NAME: process.env.DB_NAME || config.get<string>('DB_NAME'),
          DB_SSL: process.env.DB_SSL || config.get<string>('DB_SSL'),
        }),
      dataSourceFactory: async (options) =>
        initializeAndBootstrapDataSource(options),
    }),
    CitiesModule,
    AuthModule,
    UsersModule,
    ListingsModule,
    MeetingsModule,
    OffersModule,
    ReviewsModule,
    ReportsModule,
    MessagesModule,
    AdminModule,
    UploadModule,
    NotificationsModule,
    FavoritesModule,
  ],
  controllers: [HealthController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
  ],
})
export class AppModule { }
