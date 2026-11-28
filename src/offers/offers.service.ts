import {
  Injectable,
  OnModuleInit,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Offer, OfferStatus } from './offer.entity';
import { OfferItem } from './offer-item.entity';
import { Listing } from '../listings/listing.entity';
import { User } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';

@Injectable()
export class OffersService implements OnModuleInit {
  constructor(
    @InjectRepository(Offer) private offerRepo: Repository<Offer>,
    @InjectRepository(OfferItem) private offerItemRepo: Repository<OfferItem>,
    @InjectRepository(Listing) private listingRepo: Repository<Listing>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private dataSource: DataSource,
    private notificationsService: NotificationsService,
  ) {}

  async onModuleInit() {
    await this.dataSource.query(`
      ALTER TABLE offers
        ADD COLUMN IF NOT EXISTS initiator_id uuid,
        ADD COLUMN IF NOT EXISTS responder_id uuid,
        ADD COLUMN IF NOT EXISTS parent_offer_id uuid,
        ADD COLUMN IF NOT EXISTS soulte numeric(10,2),
        ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
      DO $$ BEGIN
        ALTER TABLE offers ALTER COLUMN negotiation_id DROP NOT NULL;
      EXCEPTION WHEN undefined_column THEN NULL; END $$;
      DO $$ BEGIN
        ALTER TABLE offers ALTER COLUMN author_id DROP NOT NULL;
      EXCEPTION WHEN undefined_column THEN NULL; END $$;
      DO $$ BEGIN
        ALTER TABLE offers ALTER COLUMN version DROP NOT NULL;
      EXCEPTION WHEN undefined_column THEN NULL; END $$;

      ALTER TABLE offer_items
        ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
        ADD COLUMN IF NOT EXISTS quantity int DEFAULT 1;
      DO $$ BEGIN
        ALTER TABLE offer_items ALTER COLUMN side DROP NOT NULL;
      EXCEPTION WHEN undefined_column THEN NULL; END $$;
      DO $$ BEGIN
        ALTER TYPE offers_status_enum ADD VALUE IF NOT EXISTS 'cancelled';
      EXCEPTION WHEN undefined_object THEN NULL; END $$;

      -- Auto-cancel any open/accepted offers missing at least 2 existing listings
      UPDATE offers o
      SET status = 'cancelled'
      WHERE o.status IN ('pending', 'countered', 'accepted')
        AND (
          SELECT COUNT(*)
          FROM offer_items oi
          JOIN listings l ON l.id = oi.listing_id
          WHERE oi.offer_id = o.id
        ) < 2;

      -- Phase 3.2: Composite & Full-Text GIN PostgreSQL indexes
      CREATE INDEX IF NOT EXISTS idx_listings_city_status_created
        ON listings (city_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_listings_search_gin
        ON listings USING GIN (to_tsvector('french', coalesce(title, '') || ' ' || coalesce(description, '')));
      CREATE INDEX IF NOT EXISTS idx_offers_participants_status
        ON offers (initiator_id, responder_id, status);
    `);
  }

  /**
   * C1 - Create a multi-object exchange offer with optional soulte flag (no fixed price)
   */
  async createOffer(
    initiatorId: string,
    data: {
      targetListingId: string;
      offeringListingIds: string[];
      soulte?: number;
      soultePossible?: boolean;
      message?: string;
    },
  ): Promise<Offer> {
    if (!data.targetListingId) {
      throw new BadRequestException('Annonce cible requise');
    }
    if (!data.offeringListingIds || data.offeringListingIds.length === 0) {
      throw new BadRequestException(
        'Vous devez sélectionner au moins un de vos objets pour proposer un échange',
      );
    }

    const targetListing = await this.listingRepo.findOne({
      where: { id: data.targetListingId },
      relations: { user: true },
    });
    if (!targetListing) {
      throw new NotFoundException('Annonce cible introuvable');
    }

    const responderId = targetListing.user?.id;
    if (!responderId) {
      throw new BadRequestException('Propriétaire de l\'annonce introuvable');
    }
    if (initiatorId === responderId) {
      throw new BadRequestException(
        'Vous ne pouvez pas proposer un échange sur votre propre annonce',
      );
    }

    const uniqueOfferingIds = [...new Set(data.offeringListingIds)].filter(
      (id) => id !== data.targetListingId,
    );
    if (uniqueOfferingIds.length === 0) {
      throw new BadRequestException(
        'Sélectionnez au moins un de vos propres objets (différent de l\'annonce cible)',
      );
    }

    const offeringListings = await this.listingRepo.find({
      where: { id: In(uniqueOfferingIds) },
      relations: { user: true },
    });
    if (offeringListings.length !== uniqueOfferingIds.length) {
      throw new BadRequestException(
        'Un ou plusieurs objets proposés sont introuvables',
      );
    }
    for (const listing of offeringListings) {
      if (listing.user?.id !== initiatorId) {
        throw new ForbiddenException(
          'Vous ne pouvez proposer que vos propres annonces actives',
        );
      }
      if (listing.status !== 'active') {
        throw new BadRequestException(
          `L'annonce "${listing.title}" n'est plus active`,
        );
      }
    }

    const soulteValue =
      data.soultePossible === true
        ? 1
        : data.soulte && data.soulte > 0
          ? data.soulte
          : undefined;

    const offer = this.offerRepo.create({
      initiator: { id: initiatorId } as any,
      responder: { id: responderId } as any,
      soulte: soulteValue,
      message: data.message?.trim() || '',
      status: OfferStatus.PENDING,
    });

    const savedOffer = await this.offerRepo.save(offer);

    const allItemIds = [...new Set([data.targetListingId, ...uniqueOfferingIds])];
    for (const listingId of allItemIds) {
      const offerItem = this.offerItemRepo.create({
        offer: { id: savedOffer.id } as any,
        listing: { id: listingId } as any,
        quantity: 1,
      });
      await this.offerItemRepo.save(offerItem);
    }

    this.notificationsService
      .notifyUser(
        responderId,
        NotificationType.OFFER_RECEIVED,
        'Nouvelle proposition d\'échange',
        `Proposition reçue pour "${targetListing.title}" (${uniqueOfferingIds.length} objet(s))`,
        { offerId: savedOffer.id, route: `/chat/${savedOffer.id}` },
      )
      .catch(() => {});

    return this.getOfferById(savedOffer.id);
  }

  async getOfferById(offerId: string): Promise<Offer> {
    const offer = await this.offerRepo.findOne({
      where: { id: offerId },
      relations: {
        initiator: true,
        responder: true,
        items: { listing: { user: true, city: true } },
      },
    });
    if (!offer) throw new NotFoundException('Offre introuvable');

    if (
      offer.status === OfferStatus.PENDING ||
      offer.status === OfferStatus.COUNTERED ||
      offer.status === OfferStatus.ACCEPTED
    ) {
      const validItems = (offer.items || []).filter((i) => !!i.listing);
      const hasInitiatorItem = validItems.some(
        (i) => i.listing?.user?.id === offer.initiator?.id,
      );
      const hasResponderItem = validItems.some(
        (i) => i.listing?.user?.id === offer.responder?.id,
      );
      if (
        validItems.length < 2 ||
        (offer.initiator?.id &&
          offer.responder?.id &&
          (!hasInitiatorItem || !hasResponderItem))
      ) {
        offer.status = OfferStatus.CANCELLED;
        await this.offerRepo.save(offer);
      }
    }

    return offer;
  }

  async acceptOffer(offerId: string, userId: string): Promise<Offer> {
    const offer = await this.getOfferById(offerId);
    if (offer.responder?.id !== userId) {
      throw new ForbiddenException('Seul le destinataire peut accepter l\'offre');
    }
    if (offer.status !== OfferStatus.PENDING) {
      throw new BadRequestException(
        `Impossible d'accepter une offre au statut "${offer.status}"`,
      );
    }

    offer.status = OfferStatus.ACCEPTED;
    const saved = await this.offerRepo.save(offer);

    this.notificationsService
      .notifyUser(
        offer.initiator.id,
        NotificationType.OFFER_ACCEPTED,
        'Offre acceptée !',
        'Votre proposition a été acceptée. Planifiez maintenant le rendez-vous QR.',
        { offerId: saved.id, route: `/chat/${saved.id}` },
      )
      .catch(() => {});

    return saved;
  }

  async rejectOffer(offerId: string, userId: string): Promise<Offer> {
    const offer = await this.getOfferById(offerId);
    if (offer.responder?.id !== userId) {
      throw new ForbiddenException('Seul le destinataire peut refuser l\'offre');
    }
    if (offer.status !== OfferStatus.PENDING) {
      throw new BadRequestException(
        `Impossible de refuser une offre au statut "${offer.status}"`,
      );
    }

    offer.status = OfferStatus.REJECTED;
    const saved = await this.offerRepo.save(offer);

    this.notificationsService
      .notifyUser(
        offer.initiator.id,
        NotificationType.OFFER_REJECTED,
        'Offre refusée',
        'Votre proposition d\'échange n\'a pas été retenue.',
        { offerId: saved.id, route: `/chat/${saved.id}` },
      )
      .catch(() => {});

    return saved;
  }

  async createCounterOffer(
    responderId: string,
    originalOfferId: string,
    data: {
      counterListingIds: string[];
      counterSoulte?: number;
      soultePossible?: boolean;
      message?: string;
    },
  ): Promise<Offer> {
    const originalOffer = await this.getOfferById(originalOfferId);
    if (originalOffer.responder?.id !== responderId) {
      throw new ForbiddenException(
        'Seul le destinataire peut faire une contre-offre',
      );
    }
    if (originalOffer.status !== OfferStatus.PENDING) {
      throw new BadRequestException('Cette offre n\'est plus en attente');
    }

    originalOffer.status = OfferStatus.COUNTERED;
    await this.offerRepo.save(originalOffer);

    const soulteVal =
      data.soultePossible === true
        ? 1
        : data.counterSoulte && data.counterSoulte > 0
          ? data.counterSoulte
          : undefined;

    const counterOffer = this.offerRepo.create({
      initiator: { id: responderId } as any,
      responder: { id: originalOffer.initiator.id } as any,
      parentOfferId: originalOfferId,
      soulte: soulteVal,
      message: data.message?.trim() || '',
      status: OfferStatus.PENDING,
    });

    const savedCounter = await this.offerRepo.save(counterOffer);

    // Keep original initiator items if counterListingIds only specifies responder's side, or merge unique items
    const existingInitiatorIds = (originalOffer.items || [])
      .filter((i) => i.listing?.user?.id === originalOffer.initiator?.id)
      .map((i) => i.listing.id);
    const existingResponderIds = (originalOffer.items || [])
      .filter((i) => i.listing?.user?.id === responderId)
      .map((i) => i.listing.id);

    const mergedIds = Array.from(
      new Set([
        ...(data.counterListingIds && data.counterListingIds.length > 0
          ? data.counterListingIds
          : existingResponderIds),
        ...existingInitiatorIds,
      ]),
    );

    for (const listingId of mergedIds) {
      const offerItem = this.offerItemRepo.create({
        offer: { id: savedCounter.id } as any,
        listing: { id: listingId } as any,
        quantity: 1,
      });
      await this.offerItemRepo.save(offerItem);
    }

    this.notificationsService
      .notifyUser(
        originalOffer.initiator.id,
        NotificationType.OFFER_COUNTERED,
        'Contre-proposition reçue',
        'Votre partenaire a modifié les conditions de l\'échange.',
        { offerId: savedCounter.id, route: `/chat/${savedCounter.id}` },
      )
      .catch(() => {});

    return this.getOfferById(savedCounter.id);
  }

  async getReceivedOffers(userId: string): Promise<Offer[]> {
    return this.offerRepo.find({
      where: { responder: { id: userId } },
      relations: { initiator: true, responder: true, items: { listing: true } },
      order: { createdAt: 'DESC' },
    });
  }

  async getSentOffers(userId: string): Promise<Offer[]> {
    return this.offerRepo.find({
      where: { initiator: { id: userId } },
      relations: { initiator: true, responder: true, items: { listing: true } },
      order: { createdAt: 'DESC' },
    });
  }

  async getListingOffers(listingId: string, userId: string): Promise<Offer[]> {
    const offers = await this.offerRepo.find({
      relations: { initiator: true, responder: true, items: { listing: true } },
    });
    return offers.filter(
      (offer) =>
        (offer.initiator?.id === userId || offer.responder?.id === userId) &&
        offer.items?.some((item) => item.listing?.id === listingId),
    );
  }

  async getOfferHistory(userId: string): Promise<{
    pending: Offer[];
    accepted: Offer[];
    rejected: Offer[];
    countered: Offer[];
  }> {
    const offers = await this.offerRepo.find({
      where: [{ initiator: { id: userId } }, { responder: { id: userId } }],
      relations: { initiator: true, responder: true, items: { listing: true } },
      order: { createdAt: 'DESC' },
    });

    return {
      pending: offers.filter((o) => o.status === OfferStatus.PENDING),
      accepted: offers.filter((o) => o.status === OfferStatus.ACCEPTED),
      rejected: offers.filter((o) => o.status === OfferStatus.REJECTED),
      countered: offers.filter(
        (o) => o.status === OfferStatus.COUNTERED || o.parentOfferId !== null,
      ),
    };
  }
}
