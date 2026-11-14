import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Offer, OfferStatus } from './offer.entity';
import { OfferItem } from './offer-item.entity';
import { Listing } from '../listings/listing.entity';
import { User } from '../users/user.entity';

@Injectable()
export class OffersService {
  constructor(
    @InjectRepository(Offer) private offerRepo: Repository<Offer>,
    @InjectRepository(OfferItem) private offerItemRepo: Repository<OfferItem>,
    @InjectRepository(Listing) private listingRepo: Repository<Listing>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  /**
   * Create a new offer (multi-object with optional soulte)
   */
  async createOffer(
    initiatorId: string,
    responderId: string,
    data: {
      targetListingId: string;
      offeringListingIds: string[];
      soulte?: number;
      message?: string;
    },
  ): Promise<Offer> {
    const initiator = await this.userRepo.findOne({ where: { id: initiatorId } });
    const responder = await this.userRepo.findOne({ where: { id: responderId } });

    if (!initiator || !responder) {
      throw new NotFoundException('User not found');
    }

    if (initiatorId === responderId) {
      throw new BadRequestException('Cannot make offer to yourself');
    }

    const targetListing = await this.listingRepo.findOne({
      where: { id: data.targetListingId },
      relations: { user: true },
    });

    if (!targetListing) {
      throw new NotFoundException('Target listing not found');
    }

    if (targetListing.user.id !== responderId) {
      throw new BadRequestException('Can only make offer for other user\'s listings');
    }

    const offeringListings = await this.listingRepo.find({
      where: { id: data.offeringListingIds[0] },
      relations: { user: true },
    });

    for (const listing of offeringListings) {
      if (listing.user.id !== initiatorId) {
        throw new BadRequestException('Can only offer your own listings');
      }
    }

    const offer = this.offerRepo.create({
      initiator: { id: initiatorId } as any,
      responder: { id: responderId } as any,
      soulte: data.soulte || undefined,
      message: data.message || '',
      status: OfferStatus.PENDING,
    });

    const savedOffer = await this.offerRepo.save(offer);

    for (const listingId of data.offeringListingIds) {
      const offerItem = this.offerItemRepo.create({
        offer: { id: (savedOffer as any).id } as any,
        listing: { id: listingId } as any,
      });
      await this.offerItemRepo.save(offerItem);
    }

    return this.getOfferById((savedOffer as any).id);
  }

  /**
   * Get offer by ID
   */
  async getOfferById(offerId: string): Promise<Offer> {
    const offer = await this.offerRepo.findOne({
      where: { id: offerId },
      relations: { initiator: true, responder: true, items: { listing: true } },
    });

    if (!offer) throw new NotFoundException('Offer not found');
    return offer;
  }

  /**
   * Accept an offer
   */
  async acceptOffer(offerId: string, userId: string): Promise<Offer> {
    const offer = await this.getOfferById(offerId);

    if (offer.responder.id !== userId) {
      throw new ForbiddenException('Only offer recipient can accept');
    }

    if (offer.status !== OfferStatus.PENDING) {
      throw new BadRequestException(`Cannot accept offer with status: ${offer.status}`);
    }

    offer.status = OfferStatus.ACCEPTED;
    return await this.offerRepo.save(offer);
  }

  /**
   * Reject an offer
   */
  async rejectOffer(offerId: string, userId: string): Promise<Offer> {
    const offer = await this.getOfferById(offerId);

    if (offer.responder.id !== userId) {
      throw new ForbiddenException('Only offer recipient can reject');
    }

    if (offer.status !== OfferStatus.PENDING) {
      throw new BadRequestException(`Cannot reject offer with status: ${offer.status}`);
    }

    offer.status = OfferStatus.REJECTED;
    return await this.offerRepo.save(offer);
  }

  /**
   * Create a counter-offer
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

    if (originalOffer.responder.id !== responderId) {
      throw new ForbiddenException('Only offer recipient can counter');
    }

    const counterOffer = this.offerRepo.create({
      initiator: { id: responderId } as any,
      responder: { id: originalOffer.initiator.id } as any,
      parentOfferId: originalOfferId,
      soulte: data.counterSoulte || undefined,
      message: data.message || '',
      status: OfferStatus.PENDING,
    });

    const savedCounterOffer = await this.offerRepo.save(counterOffer);

    for (const listingId of data.counterListingIds) {
      const offerItem = this.offerItemRepo.create({
        offer: { id: (savedCounterOffer as any).id } as any,
        listing: { id: listingId } as any,
      });
      await this.offerItemRepo.save(offerItem);
    }

    return this.getOfferById((savedCounterOffer as any).id);
  }

  /**
   * Get offers received by user
   */
  async getReceivedOffers(userId: string): Promise<Offer[]> {
    return this.offerRepo.find({
      where: { responder: { id: userId } },
      relations: { initiator: true, responder: true, items: { listing: true } },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get offers sent by user
   */
  async getSentOffers(userId: string): Promise<Offer[]> {
    return this.offerRepo.find({
      where: { initiator: { id: userId } },
      relations: { initiator: true, responder: true, items: { listing: true } },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get all offers for a specific listing
   */
  async getListingOffers(listingId: string, userId: string): Promise<Offer[]> {
    const offers = await this.offerRepo.find({
      relations: { initiator: true, responder: true, items: { listing: true } },
    });

    return offers.filter(
      offer =>
        (offer.initiator.id === userId || offer.responder.id === userId) &&
        offer.items.some(item => item.listing.id === listingId),
    );
  }

  /**
   * Get offer history grouped by status
   */
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
      pending: offers.filter(o => o.status === OfferStatus.PENDING),
      accepted: offers.filter(o => o.status === OfferStatus.ACCEPTED),
      rejected: offers.filter(o => o.status === OfferStatus.REJECTED),
      countered: offers.filter(o => o.parentOfferId !== null),
    };
  }
}
