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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

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
      status: ListingStatus.ACTIVE,
    };

    const pagination = {
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    };

    return this.listingsService.getListings(filters, pagination);
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

  /**
   * Get user's own listings (authenticated)
   * GET /listings/user/my-listings?status=active
   */
  @UseGuards(JwtAuthGuard)
  @Get('user/my-listings')
  async getUserListings(
    @Request() req: any,
    @Query('status') status?: ListingStatus,
  ) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new BadRequestException('User identification missing from token');
    }

    return this.listingsService.getUserListings(userId, status);
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
  @UseGuards(JwtAuthGuard)
  @Post()
  async createListing(
    @Request() req: any,
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
  ) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new BadRequestException('User identification missing from token');
    }

    return this.listingsService.createListing(userId, body);
  }

  /**
   * B3 - Change listing status (owner only)
   * PATCH /listings/:id/status
   */
  @UseGuards(JwtAuthGuard)
  @Patch(':id/status')
  async changeStatus(
    @Request() req: any,
    @Param('id') listingId: string,
    @Body('status') status: ListingStatus,
  ) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new BadRequestException('User identification missing from token');
    }

    if (!Object.values(ListingStatus).includes(status)) {
      throw new BadRequestException('Invalid status');
    }

    return this.listingsService.changeListingStatus(listingId, userId, status);
  }

  /**
   * B3 - Update listing (owner only)
   * PATCH /listings/:id
   */
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async updateListing(
    @Request() req: any,
    @Param('id') listingId: string,
    @Body()
    body: Partial<{
      title: string;
      description: string;
      category: string;
      condition: string;
      estimatedValue: number;
      cityId: number;
      photos: string[];
      attributes: Record<string, any>;
    }>,
  ) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new BadRequestException('User identification missing from token');
    }

    return this.listingsService.updateListing(listingId, userId, body);
  }

  /**
   * B3 - Delete listing (owner only)
   * DELETE /listings/:id
   */
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deleteListing(@Request() req: any, @Param('id') listingId: string) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new BadRequestException('User identification missing from token');
    }

    return this.listingsService.deleteListing(listingId, userId);
  }
}
