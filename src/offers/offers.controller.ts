import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { OffersService } from './offers.service';

@Controller('offers')
export class OffersController {
  constructor(private offersService: OffersService) {}

  /**
   * C1 - Create a new offer
   * POST /offers
   * Body: { targetListingId, offeringListingIds[], soulte?, message? }
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
    @Query('initiatorId') initiatorId?: string, // TODO: Get from JWT
    @Query('responderId') responderId?: string,
  ) {
    if (!initiatorId || !responderId) {
      throw new BadRequestException('initiatorId and responderId required');
    }

    return this.offersService.createOffer(initiatorId, responderId, body);
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
  async acceptOffer(
    @Param('id') offerId: string,
    @Query('userId') userId?: string, // TODO: Get from JWT
  ) {
    if (!userId) throw new BadRequestException('userId required');
    return this.offersService.acceptOffer(offerId, userId);
  }

  /**
   * C3 - Reject an offer
   * PATCH /offers/:id/reject
   */
  @Patch(':id/reject')
  async rejectOffer(
    @Param('id') offerId: string,
    @Query('userId') userId?: string, // TODO: Get from JWT
  ) {
    if (!userId) throw new BadRequestException('userId required');
    return this.offersService.rejectOffer(offerId, userId);
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
    @Query('userId') userId?: string, // TODO: Get from JWT
  ) {
    if (!userId) throw new BadRequestException('userId required');
    return this.offersService.createCounterOffer(userId, originalOfferId, body);
  }

  /**
   * Get offers received by user
   * GET /offers/user/received
   */
  @Get('user/received')
  async getReceivedOffers(@Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException('userId required');
    return this.offersService.getReceivedOffers(userId);
  }

  /**
   * Get offers sent by user
   * GET /offers/user/sent
   */
  @Get('user/sent')
  async getSentOffers(@Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException('userId required');
    return this.offersService.getSentOffers(userId);
  }

  /**
   * Get all offers for a specific listing
   * GET /offers/listing/:listingId
   */
  @Get('listing/:listingId')
  async getListingOffers(
    @Param('listingId') listingId: string,
    @Query('userId') userId?: string,
  ) {
    if (!userId) throw new BadRequestException('userId required');
    return this.offersService.getListingOffers(listingId, userId);
  }

  /**
   * Get offer history (pending, accepted, rejected, countered)
   * GET /offers/user/history
   */
  @Get('user/history')
  async getOfferHistory(@Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException('userId required');
    return this.offersService.getOfferHistory(userId);
  }
}
