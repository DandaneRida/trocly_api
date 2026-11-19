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

  /**
   * C1 - Create a new multi-object offer with optional soulte
   * POST /offers
   */
  @Post()
  async createOffer(
    @Body()
    body: {
      targetListingId: string;
      offeringListingIds: string[];
      soulte?: number;
      message?: string;
    },
    @Request() req: any,
  ) {
    return this.offersService.createOffer(req.user.sub, body);
  }

  /**
   * Get offers received by authenticated user
   * GET /offers/user/received
   */
  @Get('user/received')
  async getReceivedOffers(@Request() req: any) {
    return this.offersService.getReceivedOffers(req.user.sub);
  }

  /**
   * Get offers sent by authenticated user
   * GET /offers/user/sent
   */
  @Get('user/sent')
  async getSentOffers(@Request() req: any) {
    return this.offersService.getSentOffers(req.user.sub);
  }

  /**
   * Get offer history grouped by status
   * GET /offers/user/history
   */
  @Get('user/history')
  async getOfferHistory(@Request() req: any) {
    return this.offersService.getOfferHistory(req.user.sub);
  }

  /**
   * Get all offers for a specific listing
   * GET /offers/listing/:listingId
   */
  @Get('listing/:listingId')
  async getListingOffers(
    @Param('listingId') listingId: string,
    @Request() req: any,
  ) {
    return this.offersService.getListingOffers(listingId, req.user.sub);
  }

  /**
   * Get offer details
   * GET /offers/:id
   */
  @Get(':id')
  async getOffer(@Param('id') offerId: string) {
    return this.offersService.getOfferById(offerId);
  }

  /**
   * C3 - Accept an offer
   * PATCH /offers/:id/accept
   */
  @Patch(':id/accept')
  async acceptOffer(@Param('id') offerId: string, @Request() req: any) {
    return this.offersService.acceptOffer(offerId, req.user.sub);
  }

  /**
   * C3 - Reject an offer
   * PATCH /offers/:id/reject
   */
  @Patch(':id/reject')
  async rejectOffer(@Param('id') offerId: string, @Request() req: any) {
    return this.offersService.rejectOffer(offerId, req.user.sub);
  }

  /**
   * C2 - Create counter-offer
   * POST /offers/:id/counter
   */
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
