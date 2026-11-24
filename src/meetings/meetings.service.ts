import {
  Injectable,
  OnModuleInit,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Meeting, MeetingStatus } from './meeting.entity';
import { Offer } from '../offers/offer.entity';
import { Listing } from '../listings/listing.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';

@Injectable()
export class MeetingsService implements OnModuleInit {
  private readonly logger = new Logger(MeetingsService.name);
  private readonly QR_SECRET =
    process.env.QR_SECRET || process.env.JWT_SECRET || 'trocly-qr-secret-dev';

  constructor(
    @InjectRepository(Meeting) private meetingRepo: Repository<Meeting>,
    @InjectRepository(Offer) private offerRepo: Repository<Offer>,
    @InjectRepository(Listing) private listingRepo: Repository<Listing>,
    private dataSource: DataSource,
    private notificationsService: NotificationsService,
  ) {}

  async onModuleInit() {
    await this.dataSource.query(`
      ALTER TABLE meetings
        ADD COLUMN IF NOT EXISTS initiator_id uuid,
        ADD COLUMN IF NOT EXISTS responder_id uuid,
        ADD COLUMN IF NOT EXISTS proposed_location text,
        ADD COLUMN IF NOT EXISTS expires_at timestamptz,
        ADD COLUMN IF NOT EXISTS qr_payload_initiator text,
        ADD COLUMN IF NOT EXISTS qr_payload_responder text,
        ADD COLUMN IF NOT EXISTS initiator_scanned_at timestamptz,
        ADD COLUMN IF NOT EXISTS responder_scanned_at timestamptz,
        ADD COLUMN IF NOT EXISTS scanned_at timestamptz,
        ADD COLUMN IF NOT EXISTS scanned_by_id uuid;
      DO $$ BEGIN
        ALTER TABLE meetings ALTER COLUMN negotiation_id DROP NOT NULL;
      EXCEPTION WHEN undefined_column THEN NULL; END $$;
      DO $$ BEGIN
        ALTER TABLE meetings ALTER COLUMN proposed_by DROP NOT NULL;
      EXCEPTION WHEN undefined_column THEN NULL; END $$;
      DO $$ BEGIN
        ALTER TABLE meetings ALTER COLUMN place DROP NOT NULL;
      EXCEPTION WHEN undefined_column THEN NULL; END $$;
    `);
  }

  generateQRPayload(meetingId: string, userId: string, expiresAt: Date): string {
    const payload = `${meetingId}:${userId}:${expiresAt.getTime()}`;
    const signature = crypto
      .createHmac('sha256', this.QR_SECRET)
      .update(payload)
      .digest('hex');
    return `${payload}:${signature}`;
  }

  verifyQRPayload(
    payload: string,
  ): { meetingId: string; userId: string; expiresAt: Date } | null {
    try {
      const parts = payload.split(':');
      if (parts.length !== 4) return null;

      const [meetingId, userId, expiresAtStr, signature] = parts;
      const expectedSignature = crypto
        .createHmac('sha256', this.QR_SECRET)
        .update(`${meetingId}:${userId}:${expiresAtStr}`)
        .digest('hex');

      if (signature !== expectedSignature) return null;

      const expiresAt = new Date(parseInt(expiresAtStr, 10));
      if (Number.isNaN(expiresAt.getTime()) || expiresAt < new Date()) {
        return null;
      }

      return { meetingId, userId, expiresAt };
    } catch {
      return null;
    }
  }

  /**
   * D1 - Propose a meeting (place + time slot) linked to an offer
   */
  async createMeeting(
    offerId: string,
    proposerId: string,
    proposedLocation: string,
    scheduledAt: Date,
    explicitResponderId?: string,
  ): Promise<Meeting> {
    if (!proposedLocation || !proposedLocation.trim()) {
      throw new BadRequestException('Le lieu de rendez-vous est obligatoire');
    }
    if (Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException('Date ou créneau invalide');
    }

    let responderId = explicitResponderId;
    const offer = await this.offerRepo.findOne({
      where: { id: offerId },
      relations: { initiator: true, responder: true },
    });

    if (offer) {
      const isParticipant =
        offer.initiator?.id === proposerId || offer.responder?.id === proposerId;
      if (!isParticipant) {
        throw new ForbiddenException('Vous ne participez pas à cette offre');
      }
      if (offer.status !== 'accepted') {
        throw new BadRequestException(
          'L\'offre doit être acceptée avant de proposer un rendez-vous',
        );
      }
      responderId =
        offer.initiator?.id === proposerId
          ? offer.responder?.id
          : offer.initiator?.id;
    }

    if (!responderId) {
      throw new BadRequestException(
        'Impossible de déterminer le partenaire pour ce rendez-vous',
      );
    }

    const expiresAt = new Date(scheduledAt.getTime() + 2 * 60 * 60 * 1000);

    const meeting = this.meetingRepo.create({
      offerId,
      initiator: { id: proposerId } as any,
      responder: { id: responderId } as any,
      proposedLocation: proposedLocation.trim(),
      scheduledAt,
      expiresAt,
      status: MeetingStatus.PROPOSED,
    });

    const saved = await this.meetingRepo.save(meeting);

    this.notificationsService
      .notifyUser(
        responderId,
        NotificationType.MEETING_PROPOSED,
        'Nouvelle proposition de rendez-vous',
        `Lieu : ${proposedLocation.trim()}`,
        { meetingId: saved.id, offerId, route: `/my-qr/${saved.id}` },
      )
      .catch(() => {});

    return (await this.getMeeting(saved.id)) || saved;
  }

  /**
   * List meetings for authenticated user
   */
  async getMyMeetings(userId: string): Promise<Meeting[]> {
    return this.meetingRepo.find({
      where: [{ initiator: { id: userId } }, { responder: { id: userId } }],
      relations: { initiator: true, responder: true },
      order: { scheduledAt: 'DESC' },
    });
  }

  /**
   * List meetings for a specific offer
   */
  async getMeetingsByOffer(offerId: string, userId: string): Promise<Meeting[]> {
    const meetings = await this.meetingRepo.find({
      where: { offerId },
      relations: { initiator: true, responder: true },
      order: { createdAt: 'DESC' },
    });
    return meetings.filter(
      (m) => m.initiator?.id === userId || m.responder?.id === userId,
    );
  }

  /**
   * D2 - Accept a proposed meeting and generate signed QR payloads for both participants
   */
  async acceptMeeting(meetingId: string, userId: string): Promise<Meeting> {
    const meeting = await this.meetingRepo.findOne({
      where: { id: meetingId },
      relations: { initiator: true, responder: true },
    });
    if (!meeting) throw new NotFoundException('Rendez-vous introuvable');
    if (
      meeting.initiator?.id !== userId &&
      meeting.responder?.id !== userId
    ) {
      throw new ForbiddenException('Accès refusé à ce rendez-vous');
    }
    if (meeting.initiator?.id === userId) {
      throw new ForbiddenException(
        'Seul le destinataire de la proposition de rendez-vous peut l\'accepter et générer les QR codes',
      );
    }
    if (meeting.expiresAt && new Date() > meeting.expiresAt) {
      meeting.status = MeetingStatus.EXPIRED;
      await this.meetingRepo.save(meeting);
      throw new BadRequestException('Ce rendez-vous a expiré');
    }
    if (meeting.status !== MeetingStatus.PROPOSED) {
      throw new BadRequestException(
        `Impossible d'accepter un rendez-vous au statut "${meeting.status}"`,
      );
    }

    meeting.status = MeetingStatus.ACCEPTED;
    meeting.qrPayloadInitiator = this.generateQRPayload(
      meeting.id,
      meeting.initiator.id,
      meeting.expiresAt,
    );
    meeting.qrPayloadResponder = this.generateQRPayload(
      meeting.id,
      meeting.responder.id,
      meeting.expiresAt,
    );

    const saved = await this.meetingRepo.save(meeting);

    const otherId =
      meeting.initiator.id === userId
        ? meeting.responder.id
        : meeting.initiator.id;
    this.notificationsService
      .notifyUser(
        otherId,
        NotificationType.MEETING_ACCEPTED,
        'Rendez-vous confirmé — QR prêts',
        `Vos QR codes pour "${meeting.proposedLocation}" sont disponibles.`,
        { meetingId: saved.id, route: `/my-qr/${saved.id}` },
      )
      .catch(() => {});

    return saved;
  }

  /**
   * D3 - Double-scan cross QR validation:
   * Both initiator and responder must scan each other's signed QR payload.
   * When both scans are recorded, meeting becomes VALIDATED and linked listings become EXCHANGED.
   */
  async scanQRCode(payload: string, scannedByUserId: string): Promise<Meeting> {
    const decoded = this.verifyQRPayload(payload);
    if (!decoded) {
      throw new BadRequestException('QR code invalide ou expiré');
    }

    const meeting = await this.meetingRepo.findOne({
      where: { id: decoded.meetingId },
      relations: { initiator: true, responder: true },
    });
    if (!meeting) {
      throw new NotFoundException('Rendez-vous introuvable');
    }

    const isInitiator = meeting.initiator?.id === scannedByUserId;
    const isResponder = meeting.responder?.id === scannedByUserId;
    if (!isInitiator && !isResponder) {
      throw new ForbiddenException('Vous ne participez pas à ce rendez-vous');
    }

    if (decoded.userId === scannedByUserId) {
      throw new BadRequestException(
        'Vous ne pouvez pas scanner votre propre QR code',
      );
    }

    const expectedPartnerId = isInitiator
      ? meeting.responder?.id
      : meeting.initiator?.id;
    if (decoded.userId !== expectedPartnerId) {
      throw new BadRequestException(
        'Ce QR code ne correspond pas à votre partenaire',
      );
    }

    if (meeting.expiresAt && new Date() > meeting.expiresAt) {
      meeting.status = MeetingStatus.EXPIRED;
      await this.meetingRepo.save(meeting);
      throw new BadRequestException('Ce rendez-vous a expiré (> 2h)');
    }

    if (meeting.status !== MeetingStatus.ACCEPTED) {
      throw new BadRequestException(
        'Le rendez-vous doit être accepté avant de scanner',
      );
    }

    const now = new Date();
    if (isInitiator) {
      meeting.initiatorScannedAt = now;
    } else {
      meeting.responderScannedAt = now;
    }

    // Complete validation only when BOTH participants have scanned each other
    if (meeting.initiatorScannedAt && meeting.responderScannedAt) {
      meeting.status = MeetingStatus.VALIDATED;
      meeting.scannedAt = now;
      meeting.scannedById = scannedByUserId;

      // Mark all listings involved in the offer as exchanged
      const offer = await this.offerRepo.findOne({
        where: { id: meeting.offerId },
        relations: { items: { listing: true } },
      });
      if (offer?.items?.length) {
        for (const item of offer.items) {
          if (item.listing) {
            await this.listingRepo.update(item.listing.id, {
              status: 'exchanged' as any,
            });
          }
        }
      }

      // Notify both participants to leave mutual reviews (D5)
      for (const uid of [meeting.initiator.id, meeting.responder.id]) {
        this.notificationsService
          .notifyUser(
            uid,
            NotificationType.MEETING_VALIDATED,
            'Échange validé par double scan !',
            'Laissez maintenant un avis à votre partenaire.',
            { meetingId: meeting.id, route: `/review/${meeting.id}` },
          )
          .catch(() => {});
      }
    }

    return this.meetingRepo.save(meeting);
  }

  async getMeeting(meetingId: string): Promise<Meeting | null> {
    const meeting = await this.meetingRepo.findOne({
      where: { id: meetingId },
      relations: { initiator: true, responder: true },
    });
    if (
      meeting &&
      (meeting.status === MeetingStatus.PROPOSED ||
        meeting.status === MeetingStatus.ACCEPTED) &&
      meeting.expiresAt &&
      new Date() > meeting.expiresAt
    ) {
      meeting.status = MeetingStatus.EXPIRED;
      await this.meetingRepo.save(meeting);
    }
    return meeting;
  }

  /**
   * D4 - Automatic expiration of overdue meetings (scheduledAt + 2h)
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireOverdueMeetings(): Promise<number> {
    const now = new Date();
    const overdue = await this.meetingRepo.find({
      where: {
        status: In([MeetingStatus.PROPOSED, MeetingStatus.ACCEPTED]),
        expiresAt: LessThan(now),
      },
      relations: { initiator: true, responder: true },
    });

    if (overdue.length === 0) return 0;

    for (const m of overdue) {
      m.status = MeetingStatus.EXPIRED;
      await this.meetingRepo.save(m);

      for (const uid of [m.initiator?.id, m.responder?.id].filter(Boolean)) {
        this.notificationsService
          .notifyUser(
            uid!,
            NotificationType.MEETING_EXPIRED,
            'Rendez-vous expiré',
            `Le créneau pour "${m.proposedLocation}" est dépassé de plus de 2 h.`,
            { meetingId: m.id, route: `/my-qr/${m.id}` },
          )
          .catch(() => {});
      }
    }

    this.logger.log(`Expired ${overdue.length} overdue meeting(s)`);
    return overdue.length;
  }
}
