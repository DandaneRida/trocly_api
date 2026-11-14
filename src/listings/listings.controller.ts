import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  BadRequestException,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ListingsService } from './listings.service';
import { ListingStatus } from './listing.entity';

// TODO: Implement JWT Guard
// For now, we'll extract userId from query/header

@Controller('listings')
export class ListingsController {
  constructor(private listingsService: ListingsService) {}

  /**
   * A1 - Get listings (guest or authenticated)
   * GET /listings?cityId=1&category=Electronics&minValue=100&maxValue=5000&page=1&limit=20
   */
  @Get()
  async getListings(
    @Query('cityId') cityId?: string,
    @Query('category') category?: string,
    @Query('condition') condition?: string,
    @Query('minValue') minValue?: string,
    @Query('maxValue') maxValue?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const filters = {
      cityId: cityId ? parseInt(cityId) : undefined,
      category,
      condition,
      minValue: minValue ? parseFloat(minValue) : undefined,
      maxValue: maxValue ? parseFloat(maxValue) : undefined,
      search,
      status: 'active' as ListingStatus,
    };

    const pagination = {
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    };

    return this.listingsService.getListings(filters, pagination);
  }

  /**
   * Get single listing details
   * GET /listings/:id
   */
  @Get(':id')
  async getListingDetail(@Param('id') listingId: string) {
    return this.listingsService.getListingById(listingId);
  }

  /**
   * B1 - Create a new listing (authenticated)
   * POST /listings
   * Header: Authorization: Bearer <token>
   * Body: { title, description?, category, condition, estimatedValue, cityId, photos?, attributes? }
   */
  @Post()
  async createListing(
    @Body()
    body: {
      title: string;
      description?: string;
      category: string;
      condition: string;
      estimatedValue: number;
      cityId: number;
      photos?: string[];
      attributes?: Record<string, any>;
    },
    @Query('userId') userId?: string, // TODO: Get from JWT
  ) {
    if (!userId) {
      throw new BadRequestException('Must be authenticated (userId required)');
    }

    return this.listingsService.createListing(userId, body);
  }

  /**
   * B3 - Update listing (owner only)
   * PATCH /listings/:id
   */
  @Patch(':id')
  async updateListing(
    @Param('id') listingId: string,
    @Body()
    body: Partial<{
      title: string;
      description: string;
      category: string;
      condition: string;
      estimatedValue: number;
      photos: string[];
      attributes: Record<string, any>;
    }>,
    @Query('userId') userId?: string, // TODO: Get from JWT
  ) {
    if (!userId) {
      throw new BadRequestException('Must be authenticated');
    }

    return this.listingsService.updateListing(listingId, userId, body);
  }

  /**
   * B3 - Change listing status (owner only)
   * PATCH /listings/:id/status
   */
  @Patch(':id/status')
  async changeStatus(
    @Param('id') listingId: string,
    @Body('status') status: ListingStatus,
    @Query('userId') userId?: string, // TODO: Get from JWT
  ) {
    if (!userId) {
      throw new BadRequestException('Must be authenticated');
    }

    if (!Object.values(ListingStatus).includes(status)) {
      throw new BadRequestException('Invalid status');
    }

    return this.listingsService.changeListingStatus(listingId, userId, status);
  }

  /**
   * B3 - Delete listing (owner only)
   * DELETE /listings/:id
   */
  @Delete(':id')
  async deleteListing(
    @Param('id') listingId: string,
    @Query('userId') userId?: string, // TODO: Get from JWT
  ) {
    if (!userId) {
      throw new BadRequestException('Must be authenticated');
    }

    return this.listingsService.deleteListing(listingId, userId);
  }

  /**
   * Get user's own listings
   * GET /listings/user/my-listings
   */
  @Get('user/my-listings')
  async getUserListings(
    @Query('userId') userId?: string, // TODO: Get from JWT
    @Query('includeArchived') includeArchived?: string,
  ) {
    if (!userId) {
      throw new BadRequestException('Must be authenticated');
    }

    return this.listingsService.getUserListings(userId, includeArchived === 'true');
  }

  /**
   * Get available categories (for filters)
   * GET /listings/meta/categories
   */
  @Get('meta/categories')
  async getCategories() {
    return this.listingsService.getCategories();
  }

  /**
   * Get available conditions (for filters)
   * GET /listings/meta/conditions
   */
  @Get('meta/conditions')
  async getConditions() {
    return this.listingsService.getConditions();
  }
}
