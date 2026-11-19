import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppService } from './app.service';
import { HealthController } from './health/health.controller';

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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USERNAME || 'troc',
      password: process.env.DB_PASSWORD || 'troc',
      database: process.env.DB_NAME || 'trocly_db',
      autoLoadEntities: true,
      synchronize: false,  // DISABLED - use migrations instead
      logging: false,  // Reduce logs
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
  ],
  controllers: [HealthController],
  providers: [AppService],
})
export class AppModule {}
