import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { OffersService } from './offers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('offers')
@UseGuards(JwtAuthGuard)
export class OffersController {
  constructor(private offersService: OffersService) {}

  @Post()
  async createOffer(
    @Body()
    body: {
      targetListingId: string;
      offeringListingIds: string[];
      soulte?: number;
      soultePossible?: boolean;
      message?: string;
    },
    @Request() req: any,
  ) {
    return this.offersService.createOffer(req.user.sub, body);
  }

  @Get('user/received')
  async getReceivedOffers(@Request() req: any) {
    return this.offersService.getReceivedOffers(req.user.sub);
  }

  @Get('user/sent')
  async getSentOffers(@Request() req: any) {
    return this.offersService.getSentOffers(req.user.sub);
  }

  @Get('user/history')
  async getOfferHistory(@Request() req: any) {
    return this.offersService.getOfferHistory(req.user.sub);
  }

  @Get('listing/:listingId')
  async getListingOffers(
    @Param('listingId') listingId: string,
    @Request() req: any,
  ) {
    return this.offersService.getListingOffers(listingId, req.user.sub);
  }

  @Get(':id')
  async getOffer(@Param('id') offerId: string) {
    return this.offersService.getOfferById(offerId);
  }

  @Patch(':id/accept')
  async acceptOffer(@Param('id') offerId: string, @Request() req: any) {
    return this.offersService.acceptOffer(offerId, req.user.sub);
  }

  @Patch(':id/reject')
  async rejectOffer(@Param('id') offerId: string, @Request() req: any) {
    return this.offersService.rejectOffer(offerId, req.user.sub);
  }

  @Post(':id/counter')
  async createCounterOffer(
    @Param('id') originalOfferId: string,
    @Body()
    body: {
      counterListingIds: string[];
      counterSoulte?: number;
      message?: string;
    },
    @Request() req: any,
  ) {
    return this.offersService.createCounterOffer(
      req.user.sub,
      originalOfferId,
      body,
    );
  }
}
