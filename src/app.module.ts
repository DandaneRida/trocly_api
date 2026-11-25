import 'dotenv/config';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppService } from './app.service';
import { HealthController } from './health/health.controller';
import { RateLimitGuard } from './common/guards/rate-limit.guard';

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

const dbUrl = process.env.DATABASE_URL || '';
const useDbSsl =
  process.env.DB_SSL === 'true' ||
  (Boolean(dbUrl) &&
    !dbUrl.includes('localhost') &&
    !dbUrl.includes('127.0.0.1'));

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot(
      dbUrl
        ? {
            type: 'postgres',
            url: dbUrl,
            ssl: useDbSsl ? { rejectUnauthorized: false } : false,
            autoLoadEntities: true,
            synchronize: false,
            logging: false,
          }
        : {
            type: 'postgres',
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '5432'),
            username: process.env.DB_USERNAME || 'troc',
            password: process.env.DB_PASSWORD || 'troc',
            database: process.env.DB_NAME || 'trocly_db',
            ssl: useDbSsl ? { rejectUnauthorized: false } : false,
            autoLoadEntities: true,
            synchronize: false,
            logging: false,
          },
    ),
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
export class AppModule {}
