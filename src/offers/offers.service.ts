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
        ALTER TABLE offer_items ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
  }

  /**
   * C1 - Create a multi-object exchange offer with optional soulte
   */
  async createOffer(
    initiatorId: string,
    data: {
      targetListingId: string;
      offeringListingIds: string[];
      soulte?: number;
      message?: string;
    },
  ): Promise<Offer> {
    if (!data.targetListingId) {
      throw new BadRequestException('Annonce cible requise');
    }
    if (!data.offeringListingIds || data.offeringListingIds.length === 0) {
      throw new BadRequestException('Sélectionnez au moins un objet à proposer');
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

    const offeringListings = await this.listingRepo.find({
      where: { id: In(data.offeringListingIds) },
      relations: { user: true },
    });
    if (offeringListings.length !== data.offeringListingIds.length) {
      throw new BadRequestException('Un ou plusieurs objets proposés sont introuvables');
    }
    for (const listing of offeringListings) {
      if (listing.user?.id !== initiatorId) {
        throw new ForbiddenException(
          'Vous ne pouvez proposer que vos propres annonces',
        );
      }
    }

    const offer = this.offerRepo.create({
      initiator: { id: initiatorId } as any,
      responder: { id: responderId } as any,
      soulte: data.soulte && data.soulte > 0 ? data.soulte : undefined,
      message: data.message?.trim() || '',
      status: OfferStatus.PENDING,
    });

    const savedOffer = await this.offerRepo.save(offer);

    const allItemIds = [
      ...new Set([data.targetListingId, ...data.offeringListingIds]),
    ];
    for (const listingId of allItemIds) {
      const offerItem = this.offerItemRepo.create({
        offer: { id: savedOffer.id } as any,
        listing: { id: listingId } as any,
      });
      await this.offerItemRepo.save(offerItem);
    }

    this.notificationsService
      .notifyUser(
        responderId,
        NotificationType.OFFER_RECEIVED,
        'Nouvelle proposition d\'échange',
        `Proposition reçue pour "${targetListing.title}" (${data.offeringListingIds.length} objet(s))`,
        { offerId: savedOffer.id, route: `/chat/${savedOffer.id}` },
      )
      .catch(() => {});

    return this.getOfferById(savedOffer.id);
  }

  async getOfferById(offerId: string): Promise<Offer> {
    const offer = await this.offerRepo.findOne({
      where: { id: offerId },
      relations: { initiator: true, responder: true, items: { listing: true } },
    });
    if (!offer) throw new NotFoundException('Offre introuvable');
    return offer;
  }

  /**
   * C3 - Accept an offer
   */
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

  /**
   * C3 - Reject an offer
   */
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

  /**
   * C2 - Create a counter-offer
   */
  async createCounterOffer(
    responderId: string,
    originalOfferId: string,
    data: {
      counterListingIds: string[];
      counterSoulte?: number;
      message?: string;
    },
  ): Promise<Offer> {
    const originalOffer = await this.getOfferById(originalOfferId);
    if (originalOffer.responder?.id !== responderId) {
      throw new ForbiddenException('Seul le destinataire peut faire une contre-offre');
    }
    if (originalOffer.status !== OfferStatus.PENDING) {
      throw new BadRequestException('Cette offre n\'est plus en attente');
    }

    originalOffer.status = OfferStatus.COUNTERED;
    await this.offerRepo.save(originalOffer);

    const counterOffer = this.offerRepo.create({
      initiator: { id: responderId } as any,
      responder: { id: originalOffer.initiator.id } as any,
      parentOfferId: originalOfferId,
      soulte:
        data.counterSoulte && data.counterSoulte > 0
          ? data.counterSoulte
          : undefined,
      message: data.message?.trim() || '',
      status: OfferStatus.PENDING,
    });

    const savedCounter = await this.offerRepo.save(counterOffer);

    for (const listingId of data.counterListingIds || []) {
      const offerItem = this.offerItemRepo.create({
        offer: { id: savedCounter.id } as any,
        listing: { id: listingId } as any,
      });
      await this.offerItemRepo.save(offerItem);
    }

    this.notificationsService
      .notifyUser(
        originalOffer.initiator.id,
        NotificationType.OFFER_COUNTERED,
        'Contre-proposition reçue',
        data.counterSoulte
          ? `Nouvelle proposition avec soulte de ${data.counterSoulte} DH`
          : 'Votre partenaire a modifié les conditions de l\'échange.',
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
