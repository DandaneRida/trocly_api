import { jest } from '@jest/globals';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OffersService } from './offers.service';
import { OfferStatus } from './offer.entity';

describe('OffersService (Unit)', () => {
  let service: OffersService;
  let offerRepo: any;
  let offerItemRepo: any;
  let listingRepo: any;
  let userRepo: any;
  let dataSource: any;
  let notificationsService: any;

  beforeEach(() => {
    offerRepo = {
      create: jest.fn((x) => ({ id: 'offer-1', ...x })),
      save: jest.fn(async (x) => ({ id: 'offer-1', ...x })),
      findOne: jest.fn(),
    };
    offerItemRepo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => x),
    };
    listingRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
    };
    userRepo = {};
    dataSource = { query: jest.fn() };
    notificationsService = {
      notifyUser: jest.fn().mockResolvedValue({}),
    };

    service = new OffersService(
      offerRepo,
      offerItemRepo,
      listingRepo,
      userRepo,
      dataSource,
      notificationsService,
    );
  });

  it('rejects an offer with no offering listings (object mandatory)', async () => {
    await expect(
      service.createOffer('user-a', {
        targetListingId: 'listing-b',
        offeringListingIds: [],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a self-offer on own listing', async () => {
    listingRepo.findOne.mockResolvedValue({
      id: 'listing-a',
      title: 'Mon vélo',
      user: { id: 'user-a' },
    });

    await expect(
      service.createOffer('user-a', {
        targetListingId: 'listing-a',
        offeringListingIds: ['listing-a2'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects offering a listing owned by someone else', async () => {
    listingRepo.findOne.mockResolvedValue({
      id: 'listing-b',
      title: 'VTT',
      user: { id: 'user-b' },
    });
    listingRepo.find.mockResolvedValue([
      { id: 'listing-c', title: 'Casque', status: 'active', user: { id: 'user-c' } },
    ]);

    await expect(
      service.createOffer('user-a', {
        targetListingId: 'listing-b',
        offeringListingIds: ['listing-c'],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('creates a valid multi-item offer with soultePossible and notifies responder', async () => {
    listingRepo.findOne.mockResolvedValue({
      id: 'listing-b',
      title: 'VTT',
      user: { id: 'user-b' },
    });
    listingRepo.find.mockResolvedValue([
      { id: 'listing-a1', title: 'PS4', status: 'active', user: { id: 'user-a' } },
      { id: 'listing-a2', title: 'BD', status: 'active', user: { id: 'user-a' } },
    ]);
    offerRepo.findOne.mockResolvedValue({
      id: 'offer-1',
      status: OfferStatus.PENDING,
      initiator: { id: 'user-a' },
      responder: { id: 'user-b' },
      items: [
        { listing: { id: 'listing-b', user: { id: 'user-b' } } },
        { listing: { id: 'listing-a1', user: { id: 'user-a' } } },
        { listing: { id: 'listing-a2', user: { id: 'user-a' } } },
      ],
    });

    const result = await service.createOffer('user-a', {
      targetListingId: 'listing-b',
      offeringListingIds: ['listing-a1', 'listing-a2'],
      soultePossible: true,
      message: 'Intéressé !',
    });

    expect(result.status).toBe(OfferStatus.PENDING);
    expect(offerItemRepo.save).toHaveBeenCalledTimes(3); // target + 2 offered
    expect(notificationsService.notifyUser).toHaveBeenCalledWith(
      'user-b',
      'offer_received',
      expect.any(String),
      expect.stringContaining('2 objet(s)'),
      expect.objectContaining({ offerId: 'offer-1' }),
    );
  });

  it('prevents non-responder from accepting an offer', async () => {
    offerRepo.findOne.mockResolvedValue({
      id: 'offer-1',
      status: OfferStatus.PENDING,
      initiator: { id: 'user-a' },
      responder: { id: 'user-b' },
      items: [
        { listing: { id: 'l-a', user: { id: 'user-a' } } },
        { listing: { id: 'l-b', user: { id: 'user-b' } } },
      ],
    });

    await expect(service.acceptOffer('offer-1', 'user-a')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('auto-cancels an accepted offer when a listing in the exchange has been deleted', async () => {
    offerRepo.findOne.mockResolvedValue({
      id: 'offer-orphan',
      status: OfferStatus.ACCEPTED,
      initiator: { id: 'user-a' },
      responder: { id: 'user-b' },
      items: [{ listing: { id: 'l-a', user: { id: 'user-a' } } }],
    });

    const offer = await service.getOfferById('offer-orphan');
    expect(offer.status).toBe(OfferStatus.CANCELLED);
    expect(offerRepo.save).toHaveBeenCalled();
  });
});
