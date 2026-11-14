import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, Between } from 'typeorm';
import { Listing, ListingStatus } from './listing.entity';
import { User } from '../users/user.entity';
import { City } from '../cities/city.entity';

@Injectable()
export class ListingsService {
  constructor(
    @InjectRepository(Listing) private listingRepo: Repository<Listing>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(City) private cityRepo: Repository<City>,
  ) {}

  /**
   * B1 - Create a new listing
   */
  async createListing(
    userId: string,
    data: {
      title: string;
      description?: string;
      category: string;
      condition: string;
      estimatedValue: number;
      cityId: number;
      photos?: string[];
      attributes?: Record<string, any>;
    },
  ): Promise<Listing> {
    // Validate user exists
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Validate city exists
    const city = await this.cityRepo.findOne({ where: { id: data.cityId } });
    if (!city) throw new BadRequestException('City not found');

    // Validate required fields
    if (!data.title || !data.category || !data.condition || data.estimatedValue <= 0) {
      throw new BadRequestException('Missing required fields');
    }

    // Create listing
    const listing = this.listingRepo.create({
      title: data.title,
      description: data.description || '',
      category: data.category,
      condition: data.condition,
      estimatedValue: data.estimatedValue,
      user: { id: userId },
      city: { id: data.cityId },
      photos: data.photos || [],
      attributes: data.attributes || {},
      status: ListingStatus.ACTIVE,
    });

    return await this.listingRepo.save(listing);
  }

  /**
   * A1 / B4 - Get listings with filters
   * Filters: cityId, category, condition, minValue, maxValue
   * Pagination: page, limit
   */
  async getListings(
    filters?: {
      cityId?: number;
      category?: string;
      condition?: string;
      minValue?: number;
      maxValue?: number;
      search?: string;
      status?: ListingStatus;
    },
    pagination?: {
      page?: number;
      limit?: number;
    },
  ): Promise<{ listings: Listing[]; total: number }> {
    const page = pagination?.page || 1;
    const limit = pagination?.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {
      status: filters?.status || ListingStatus.ACTIVE, // Only return active listings by default
    };

    // City filter
    if (filters?.cityId) {
      where.city = { id: filters.cityId };
    }

    // Category filter
    if (filters?.category) {
      where.category = ILike(`%${filters.category}%`);
    }

    // Condition filter
    if (filters?.condition) {
      where.condition = ILike(`%${filters.condition}%`);
    }

    // Price range filter
    if (filters?.minValue !== undefined || filters?.maxValue !== undefined) {
      where.estimatedValue = Between(
        filters?.minValue || 0,
        filters?.maxValue || 999999,
      );
    }

    // Search in title or description
    if (filters?.search) {
      where.title = ILike(`%${filters.search}%`);
    }

    const [listings, total] = await this.listingRepo.findAndCount({
      where,
      relations: { user: true, city: true },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return { listings, total };
  }

  /**
   * Get single listing by ID
   */
  async getListingById(listingId: string): Promise<Listing> {
    const listing = await this.listingRepo.findOne({
      where: { id: listingId },
      relations: { user: true, city: true },
    });

    if (!listing) throw new NotFoundException('Listing not found');
    return listing;
  }

  /**
   * B3 - Update a listing (only by owner)
   */
  async updateListing(
    listingId: string,
    userId: string,
    data: Partial<{
      title: string;
      description: string;
      category: string;
      condition: string;
      estimatedValue: number;
      photos: string[];
      attributes: Record<string, any>;
    }>,
  ): Promise<Listing> {
    const listing = await this.getListingById(listingId);

    // Check ownership
    if (listing.user.id !== userId) {
      throw new ForbiddenException('You can only edit your own listings');
    }

    // Update fields
    if (data.title) listing.title = data.title;
    if (data.description) listing.description = data.description;
    if (data.category) listing.category = data.category;
    if (data.condition) listing.condition = data.condition;
    if (data.estimatedValue) listing.estimatedValue = data.estimatedValue;
    if (data.photos) listing.photos = data.photos;
    if (data.attributes) listing.attributes = { ...listing.attributes, ...data.attributes };

    return await this.listingRepo.save(listing);
  }

  /**
   * B3 - Change listing status
   * Statuses: active, archived, exchanged, unavailable
   */
  async changeListingStatus(
    listingId: string,
    userId: string,
    newStatus: ListingStatus,
  ): Promise<Listing> {
    const listing = await this.getListingById(listingId);

    // Check ownership
    if (listing.user.id !== userId) {
      throw new ForbiddenException('You can only modify your own listings');
    }

    listing.status = newStatus;
    return await this.listingRepo.save(listing);
  }

  /**
   * B3 - Delete a listing (only by owner)
   */
  async deleteListing(listingId: string, userId: string): Promise<{ message: string }> {
    const listing = await this.getListingById(listingId);

    // Check ownership
    if (listing.user.id !== userId) {
      throw new ForbiddenException('You can only delete your own listings');
    }

    await this.listingRepo.remove(listing);
    return { message: 'Listing deleted successfully' };
  }

  /**
   * Get user's own listings
   */
  async getUserListings(userId: string, includeArchived = false): Promise<Listing[]> {
    const where: any = { user: { id: userId } };

    if (!includeArchived) {
      where.status = ListingStatus.ACTIVE;
    }

    return await this.listingRepo.find({
      where,
      relations: { user: true, city: true },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get categories (for dropdown filters)
   */
  async getCategories(): Promise<string[]> {
    const listings = await this.listingRepo.find({
      select: { category: true },
    });
    return listings.map(l => l.category).filter(Boolean);
  }

  /**
   * Get conditions (for dropdown filters)
   */
  async getConditions(): Promise<string[]> {
    const listings = await this.listingRepo.find({
      select: { condition: true },
    });
    return listings.map(l => l.condition).filter(Boolean);
  }
}
