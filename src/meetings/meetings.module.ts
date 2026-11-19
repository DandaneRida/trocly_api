import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Meeting } from './meeting.entity';
import { MeetingsService } from './meetings.service';
import { MeetingsController } from './meetings.controller';
import { Offer } from '../offers/offer.entity';
import { Listing } from '../listings/listing.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Meeting, Offer, Listing]), AuthModule],
  providers: [MeetingsService],
  controllers: [MeetingsController],
  exports: [MeetingsService],
})
export class MeetingsModule {}
