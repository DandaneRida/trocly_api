import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Listing } from './listing.entity';
import { ListingsService } from './listings.service';
import { ListingsController } from './listings.controller';
import { User } from '../users/user.entity';
import { City } from '../cities/city.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Listing, User, City])],
  providers: [ListingsService],
  controllers: [ListingsController],
  exports: [ListingsService],
})
export class ListingsModule {}
