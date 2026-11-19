import {
  Injectable,
  OnModuleInit,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Meeting, MeetingStatus } from './meeting.entity';
import { Offer } from '../offers/offer.entity';
import { Listing } from '../listings/listing.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';

@Injectable()
export class MeetingsService implements OnModuleInit {
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

  async scanQRCode(payload: string, scannedByUserId: string): Promise<any> {
    const decoded = this.verifyQRPayload(payload);
    if (!decoded) {
      throw new BadRequestException('QR code invalide ou expiré');
    }
    const meeting = await this.meetingRepo.findOne({
      where: { id: decoded.meetingId },
      relations: { initiator: true, responder: true },
    });
    if (!meeting) throw new NotFoundException('Rendez-vous introuvable');
    if (meeting.status !== MeetingStatus.ACCEPTED) {
      throw new BadRequestException('Le rendez-vous doit être accepté avant le scan');
    }
    meeting.status = MeetingStatus.VALIDATED;
    meeting.scannedAt = new Date();
    meeting.scannedById = scannedByUserId;
    return this.meetingRepo.save(meeting);
  }

  async getMeeting(meetingId: string): Promise<Meeting | null> {
    return this.meetingRepo.findOne({
      where: { id: meetingId },
      relations: { initiator: true, responder: true },
    });
  }
}
