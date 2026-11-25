import { jest } from '@jest/globals';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import { MeetingStatus } from './meeting.entity';

describe('MeetingsService (Unit)', () => {
  let service: MeetingsService;
  let meetingRepo: any;
  let offerRepo: any;
  let listingRepo: any;
  let dataSource: any;
  let notificationsService: any;

  beforeEach(() => {
    meetingRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => x),
    };
    offerRepo = { findOne: jest.fn() };
    listingRepo = { update: jest.fn() };
    dataSource = { query: jest.fn() };
    notificationsService = {
      notifyUser: jest.fn().mockResolvedValue({}),
    };

    service = new MeetingsService(
      meetingRepo,
      offerRepo,
      listingRepo,
      dataSource,
      notificationsService,
    );
  });

  it('generates and verifies HMAC-SHA256 signed QR payload and rejects tampering', () => {
    const future = new Date(Date.now() + 3600_000);
    const payload = service.generateQRPayload('m-1', 'user-a', future);

    const decoded = service.verifyQRPayload(payload);
    expect(decoded).not.toBeNull();
    expect(decoded?.meetingId).toBe('m-1');
    expect(decoded?.userId).toBe('user-a');

    expect(service.verifyQRPayload(`${payload}tampered`)).toBeNull();
  });

  it('rejects self-scan on own QR code', async () => {
    const future = new Date(Date.now() + 3600_000);
    const payloadA = service.generateQRPayload('m-1', 'user-a', future);

    meetingRepo.findOne.mockResolvedValue({
      id: 'm-1',
      status: MeetingStatus.ACCEPTED,
      expiresAt: future,
      initiator: { id: 'user-a' },
      responder: { id: 'user-b' },
    });

    await expect(service.scanQRCode(payloadA, 'user-a')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('requires double cross-scan to validate meeting and mark listings exchanged', async () => {
    const future = new Date(Date.now() + 3600_000);
    const payloadA = service.generateQRPayload('m-1', 'user-a', future);
    const payloadB = service.generateQRPayload('m-1', 'user-b', future);

    const meeting: any = {
      id: 'm-1',
      offerId: 'offer-1',
      status: MeetingStatus.ACCEPTED,
      expiresAt: future,
      initiator: { id: 'user-a' },
      responder: { id: 'user-b' },
      initiatorScannedAt: null,
      responderScannedAt: null,
    };

    meetingRepo.findOne.mockResolvedValue(meeting);
    offerRepo.findOne.mockResolvedValue({
      id: 'offer-1',
      items: [{ listing: { id: 'l-1' } }, { listing: { id: 'l-2' } }],
    });

    // 1st scan: user-a scans user-b's QR -> still ACCEPTED
    const afterFirst = await service.scanQRCode(payloadB, 'user-a');
    expect(afterFirst.status).toBe(MeetingStatus.ACCEPTED);
    expect(afterFirst.initiatorScannedAt).toBeTruthy();
    expect(listingRepo.update).not.toHaveBeenCalled();

    // 2nd scan: user-b scans user-a's QR -> VALIDATED + listings marked exchanged
    const afterSecond = await service.scanQRCode(payloadA, 'user-b');
    expect(afterSecond.status).toBe(MeetingStatus.VALIDATED);
    expect(listingRepo.update).toHaveBeenCalledTimes(2);
    expect(listingRepo.update).toHaveBeenCalledWith('l-1', { status: 'exchanged' });
    expect(listingRepo.update).toHaveBeenCalledWith('l-2', { status: 'exchanged' });
  });

  it('expires overdue meetings automatically (D4)', async () => {
    const past = new Date(Date.now() - 10_000);
    const overdueMeeting = {
      id: 'm-old',
      proposedLocation: 'Place El Hedim',
      status: MeetingStatus.ACCEPTED,
      expiresAt: past,
      initiator: { id: 'user-a' },
      responder: { id: 'user-b' },
    };
    meetingRepo.find.mockResolvedValue([overdueMeeting]);

    const count = await service.expireOverdueMeetings();
    expect(count).toBe(1);
    expect(overdueMeeting.status).toBe(MeetingStatus.EXPIRED);
    expect(meetingRepo.save).toHaveBeenCalledWith(overdueMeeting);
  });

  it('rejects meeting acceptance by the proposer (only responder can accept and generate QR)', async () => {
    const future = new Date(Date.now() + 3600_000);
    meetingRepo.findOne.mockResolvedValue({
      id: 'm-prop',
      status: MeetingStatus.PROPOSED,
      expiresAt: future,
      initiator: { id: 'user-proposer' },
      responder: { id: 'user-responder' },
      proposedLocation: 'Place El Hedim',
    });

    await expect(service.acceptMeeting('m-prop', 'user-proposer')).rejects.toThrow(
      ForbiddenException,
    );

    const accepted = await service.acceptMeeting('m-prop', 'user-responder');
    expect(accepted.status).toBe(MeetingStatus.ACCEPTED);
    expect(accepted.qrPayloadInitiator).toBeTruthy();
    expect(accepted.qrPayloadResponder).toBeTruthy();
  });

  it('allows a participant to cancel a meeting and notifies the partner', async () => {
    const future = new Date(Date.now() + 3600_000);
    meetingRepo.findOne.mockResolvedValue({
      id: 'm-cancel',
      offerId: 'o-1',
      status: MeetingStatus.ACCEPTED,
      expiresAt: future,
      initiator: { id: 'user-a', displayName: 'Yassine' },
      responder: { id: 'user-b', displayName: 'Salma' },
      proposedLocation: 'Place El Hedim',
      qrPayloadInitiator: 'qr-1',
      qrPayloadResponder: 'qr-2',
    });

    const cancelled = await service.cancelMeeting(
      'm-cancel',
      'user-a',
      'Empêchement imprévu',
    );

    expect(cancelled.status).toBe(MeetingStatus.CANCELLED);
    expect(cancelled.cancelReason).toBe('Empêchement imprévu');
    expect(cancelled.qrPayloadInitiator).toBeNull();
    expect(notificationsService.notifyUser).toHaveBeenCalledWith(
      'user-b',
      'meeting_cancelled',
      'Rendez-vous annulé',
      expect.stringContaining('Empêchement imprévu'),
      expect.objectContaining({ meetingId: 'm-cancel' }),
    );
  });
});
