import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { User } from '../users/user.entity';
import { Listing } from '../listings/listing.entity';
import { Offer } from '../offers/offer.entity';
import { Meeting } from '../meetings/meeting.entity';
import { Review } from '../reviews/review.entity';
import { Report } from '../reports/report.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Listing, Offer, Meeting, Review, Report]),
    AuthModule,
  ],
  providers: [AdminService],
  controllers: [AdminController],
  exports: [AdminService],
})
export class AdminModule {}
