import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Offer } from './offer.entity';
import { OfferItem } from './offer-item.entity';
import { OffersService } from './offers.service';
import { OffersController } from './offers.controller';
import { Listing } from '../listings/listing.entity';
import { User } from '../users/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Offer, OfferItem, Listing, User])],
  providers: [OffersService],
  controllers: [OffersController],
  exports: [OffersService],
})
export class OffersModule {}
