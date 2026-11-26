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
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';

@Injectable()
export class ListingsService {
  constructor(
    @InjectRepository(Listing) private listingRepo: Repository<Listing>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(City) private cityRepo: Repository<City>,
    private notificationsService: NotificationsService,
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

    const notificationsToSend: Array<{
      recipientId: string;
      type: NotificationType;
      title: string;
      body: string;
      data: Record<string, any>;
    }> = [];

    await this.listingRepo.manager.transaction(async (manager) => {
      const affectedOffers: Array<{
        id: string;
        initiator_id: string;
        responder_id: string;
        status: string;
      }> = await manager.query(
        `SELECT id, initiator_id, responder_id, status
         FROM offers
         WHERE id IN (SELECT offer_id FROM offer_items WHERE listing_id = $1)`,
        [listingId],
      );

      if (affectedOffers.length > 0) {
        const offerIds = affectedOffers.map((o) => o.id);

        // Cancel active/proposed meetings tied to these offers
        const affectedMeetings: Array<{
          id: string;
          offer_id: string;
          initiator_id: string;
          responder_id: string;
          proposed_location: string;
        }> = await manager.query(
          `SELECT id, offer_id, initiator_id, responder_id, proposed_location
           FROM meetings
           WHERE offer_id::text = ANY($1::text[])
             AND status IN ('proposed', 'accepted')`,
          [offerIds],
        );

        if (affectedMeetings.length > 0) {
          const meetingIds = affectedMeetings.map((m) => m.id);
          const reason = `Annonce « ${listing.title} » supprimée par son propriétaire`;
          await manager.query(
            `UPDATE meetings
             SET status = 'cancelled',
                 cancel_reason = $2,
                 cancelled_by_id = $3,
                 qr_payload_initiator = NULL,
                 qr_payload_responder = NULL
             WHERE id = ANY($1)`,
            [meetingIds, reason, userId],
          );

          for (const m of affectedMeetings) {
            const partnerId =
              m.initiator_id === userId ? m.responder_id : m.initiator_id;
            if (partnerId && partnerId !== userId) {
              notificationsToSend.push({
                recipientId: partnerId,
                type: NotificationType.MEETING_CANCELLED,
                title: 'Rendez-vous annulé — Annonce supprimée',
                body: `L'annonce « ${listing.title} » a été supprimée. Le rendez-vous à « ${m.proposed_location} » est annulé.`,
                data: {
                  meetingId: m.id,
                  offerId: m.offer_id,
                  route: `/my-qr/${m.id}`,
                },
              });
            }
          }
        }

        // Cancel open offers (pending, countered, or accepted without validated exchange)
        await manager.query(
          `UPDATE offers
           SET status = 'cancelled'
           WHERE id = ANY($1)
             AND status IN ('pending', 'countered', 'accepted')`,
          [offerIds],
        );

        const notifiedOfferPartners = new Set(
          notificationsToSend.map((n) => n.recipientId),
        );
        for (const o of affectedOffers) {
          if (!['pending', 'countered', 'accepted'].includes(o.status)) continue;
          const partnerId =
            o.initiator_id === userId ? o.responder_id : o.initiator_id;
          if (
            partnerId &&
            partnerId !== userId &&
            !notifiedOfferPartners.has(partnerId)
          ) {
            notifiedOfferPartners.add(partnerId);
            notificationsToSend.push({
              recipientId: partnerId,
              type: NotificationType.OFFER_CANCELLED,
              title: 'Proposition annulée — Annonce supprimée',
              body: `L'annonce « ${listing.title} » a été supprimée par son propriétaire.`,
              data: { offerId: o.id, route: `/chat/${o.id}` },
            });
          }
        }
      }

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

    for (const n of notificationsToSend) {
      this.notificationsService
        .notifyUser(n.recipientId, n.type, n.title, n.body, n.data)
        .catch(() => {});
    }

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
   * Phase 2.1 - Smart Matching (« Double Coïncidence des Besoins »)
   * Croise les annonces actives de l'utilisateur et ses souhaits avec les annonces actives des autres membres.
   */
  async getSmartMatches(userId: string, limit = 10): Promise<any[]> {
    const myActive = await this.listingRepo.find({
      where: { user: { id: userId }, status: ListingStatus.ACTIVE },
      relations: { city: true },
    });

    const candidates = await this.listingRepo.find({
      where: { status: ListingStatus.ACTIVE },
      relations: { user: true, city: true },
      order: { createdAt: 'DESC' },
      take: 120,
    });

    const others = candidates.filter((c) => c.user?.id !== userId);
    if (myActive.length === 0) {
      return others.slice(0, limit).map((c) => ({
        ...c,
        matchScore: 60,
        matchReason: 'Populaire près de vous',
      }));
    }

    const tokenize = (txt: string): string[] =>
      txt
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3);

    const myOfferTokens = new Set<string>();
    const myWishTokens = new Set<string>();
    const myCityIds = new Set<number>();
    const myCategories = new Set<string>();

    for (const m of myActive) {
      if (m.city?.id) myCityIds.add(m.city.id);
      if (m.category) myCategories.add(m.category.toLowerCase());
      for (const t of tokenize(`${m.title} ${m.category}`)) {
        myOfferTokens.add(t);
      }
      const wishes = Array.isArray(m.attributes?.wishes)
        ? m.attributes.wishes.join(' ')
        : '';
      for (const t of tokenize(wishes)) {
        if (t !== 'ouvert' && t !== 'propositions' && t !== 'echange') {
          myWishTokens.add(t);
        }
      }
    }

    const scored = others.map((cand) => {
      let score = 20;
      const reasons: string[] = [];

      const candTitleTokens = tokenize(`${cand.title} ${cand.description || ''} ${cand.category}`);
      const candWishesRaw = Array.isArray(cand.attributes?.wishes)
        ? cand.attributes.wishes.join(' ')
        : '';
      const candWishTokens = tokenize(candWishesRaw);

      // 1. I want what they have
      const matchesMyWish = candTitleTokens.some((t) => myWishTokens.has(t));
      // 2. They want what I have
      const wantsMyItem = candWishTokens.some((t) => myOfferTokens.has(t));

      if (matchesMyWish && wantsMyItem) {
        score += 55;
        reasons.push('Double coïncidence parfaite');
      } else if (wantsMyItem) {
        score += 35;
        reasons.push('Cherche un objet comme le vôtre');
      } else if (matchesMyWish) {
        score += 35;
        reasons.push('Correspond à vos souhaits');
      }

      if (cand.city?.id && myCityIds.has(cand.city.id)) {
        score += 20;
        reasons.push(`Même ville (${cand.city.name})`);
      }

      if (cand.category && myCategories.has(cand.category.toLowerCase())) {
        score += 10;
      }

      return {
        ...cand,
        matchScore: Math.min(score, 99),
        matchReason:
          reasons.length > 0 ? reasons.join(' · ') : 'Compatible dans votre région',
      };
    });

    scored.sort((a, b) => b.matchScore - a.matchScore);
    return scored.slice(0, limit);
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
