import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
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
   * B2 - Uniqueness of active listing characteristics
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
    if (!data.title || !data.category || !data.condition || data.estimatedValue === undefined || data.estimatedValue < 0) {
      throw new BadRequestException('Missing or invalid required fields');
    }

    // B2: Check uniqueness of active listing characteristics for this user
    const existingDuplicate = await this.listingRepo.findOne({
      where: {
        user: { id: userId },
        title: data.title.trim(),
        category: data.category,
        condition: data.condition,
        estimatedValue: data.estimatedValue,
        city: { id: data.cityId },
        status: ListingStatus.ACTIVE,
      },
    });

    if (existingDuplicate) {
      throw new ConflictException(
        'Vous possédez déjà une annonce active avec exactement les mêmes caractéristiques (titre, catégorie, état, valeur et ville).',
      );
    }

    // Create listing
    const listing = this.listingRepo.create({
      title: data.title.trim(),
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
   * Filters: cityId, category, condition, minValue, maxValue, search
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
      status: filters?.status || ListingStatus.ACTIVE,
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
      cityId: number;
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
    if (data.title !== undefined) listing.title = data.title;
    if (data.description !== undefined) listing.description = data.description;
    if (data.category !== undefined) listing.category = data.category;
    if (data.condition !== undefined) listing.condition = data.condition;
    if (data.estimatedValue !== undefined) listing.estimatedValue = data.estimatedValue;
    if (data.cityId !== undefined) {
      const city = await this.cityRepo.findOne({ where: { id: data.cityId } });
      if (!city) throw new BadRequestException('City not found');
      listing.city = city;
    }
    if (data.photos !== undefined) listing.photos = data.photos;
    if (data.attributes !== undefined) listing.attributes = { ...listing.attributes, ...data.attributes };

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
   * Cleans up dependent offer_items (cancelling pending/countered offers) and reports first
   * to prevent PostgreSQL FK violation 23503.
   */
  async deleteListing(listingId: string, userId: string): Promise<{ message: string }> {
    const listing = await this.getListingById(listingId);

    // Check ownership
    if (listing.user.id !== userId) {
      throw new ForbiddenException('You can only delete your own listings');
    }

    await this.listingRepo.manager.transaction(async (manager) => {
      await manager.query(
        `UPDATE offers SET status = 'cancelled'
         WHERE id IN (SELECT offer_id FROM offer_items WHERE listing_id = $1)
           AND status IN ('pending', 'countered')`,
        [listingId],
      );
      const fkRefs: Array<{ table_name: string; column_name: string }> =
        await manager.query(
          `SELECT tc.table_name, kcu.column_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
           WHERE tc.constraint_type = 'FOREIGN KEY'
             AND tc.table_schema = 'public'
             AND ccu.table_name = 'listings'`,
        );
      for (const { table_name, column_name } of fkRefs) {
        await manager.query(
          `DELETE FROM "${table_name}" WHERE "${column_name}" = $1`,
          [listingId],
        );
      }
      await manager.delete(Listing, { id: listingId });
    });

    return { message: 'Listing deleted successfully' };
  }

  /**
   * Get user's own listings
   */
  async getUserListings(userId: string, status?: ListingStatus): Promise<Listing[]> {
    const where: any = { user: { id: userId } };

    if (status) {
      where.status = status;
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
    const defaultCategories = [
      'Électronique',
      'Maison',
      'Véhicules',
      'Vêtements',
      'Sport',
      'Livres',
      'Bricolage',
    ];
    const listings = await this.listingRepo.find({
      select: { category: true },
    });
    const foundCategories = listings.map(l => l.category).filter(Boolean);
    return Array.from(new Set([...defaultCategories, ...foundCategories]));
  }

  /**
   * Get conditions (for dropdown filters)
   */
  async getConditions(): Promise<string[]> {
    const defaultConditions = ['neuf', 'comme_neuf', 'tres_bon', 'bon', 'use'];
    const listings = await this.listingRepo.find({
      select: { condition: true },
    });
    const found = listings.map(l => l.condition).filter(Boolean);
    return Array.from(new Set([...defaultConditions, ...found]));
  }
}
