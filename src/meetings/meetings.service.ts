import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Meeting, MeetingStatus } from './meeting.entity';
import * as crypto from 'crypto';

@Injectable()
export class MeetingsService {
  private readonly QR_SECRET = process.env.QR_SECRET || 'your-secret-key';

  constructor(@InjectRepository(Meeting) private meetingRepo: Repository<Meeting>) {}

  /**
   * Generate signed QR payload for a meeting participant
   */
  generateQRPayload(meetingId: string, userId: string, expiresAt: Date): string {
    const payload = `${meetingId}:${userId}:${expiresAt.getTime()}`;
    const signature = crypto
      .createHmac('sha256', this.QR_SECRET)
      .update(payload)
      .digest('hex');
    return `${payload}:${signature}`;
  }

  /**
   * Verify QR payload signature and expiration
   */
  verifyQRPayload(payload: string): { meetingId: string; userId: string; expiresAt: Date } | null {
    try {
      const parts = payload.split(':');
      if (parts.length !== 4) return null;

      const [meetingId, userId, expiresAtStr, signature] = parts;
      const expectedSignature = crypto
        .createHmac('sha256', this.QR_SECRET)
        .update(`${meetingId}:${userId}:${expiresAtStr}`)
        .digest('hex');

      if (signature !== expectedSignature) return null;

      const expiresAt = new Date(parseInt(expiresAtStr));
      if (expiresAt < new Date()) return null;

      return { meetingId, userId, expiresAt };
    } catch {
      return null;
    }
  }

  /**
   * SINGLE-SCAN QR validation - one scan validates the meeting
   */
  async scanQRCode(payload: string, scannedByUserId: string): Promise<Meeting | { error: string }> {
    const decoded = this.verifyQRPayload(payload);
    if (!decoded) {
      return { error: 'Invalid or expired QR code' };
    }

    const meeting = await this.meetingRepo.findOne({
      where: { id: decoded.meetingId },
    });

    if (!meeting) {
      return { error: 'Meeting not found' };
    }

    if (meeting.status !== MeetingStatus.ACCEPTED) {
      return { error: 'Meeting must be accepted before scanning' };
    }

    if (new Date() > meeting.expiresAt) {
      meeting.status = MeetingStatus.CANCELLED;
      await this.meetingRepo.save(meeting);
      return { error: 'QR code has expired' };
    }

    meeting.status = MeetingStatus.VALIDATED;
    meeting.scannedAt = new Date();
    meeting.scannedById = scannedByUserId;

    return await this.meetingRepo.save(meeting);
  }

  /**
   * Create a meeting after offer is accepted
   */
  async createMeeting(
    offerId: string,
    initiatorId: string,
    responderId: string,
    proposedLocation: string,
    scheduledAt: Date,
  ): Promise<Meeting> {
    const expiresAt = new Date(scheduledAt.getTime() + 2 * 60 * 60 * 1000);

    const meeting = this.meetingRepo.create({
      offerId,
      initiator: { id: initiatorId },
      responder: { id: responderId },
      proposedLocation,
      scheduledAt,
      expiresAt,
      status: MeetingStatus.PROPOSED,
    });

    return await this.meetingRepo.save(meeting);
  }

  /**
   * Accept a proposed meeting and generate QR codes
   */
  async acceptMeeting(meetingId: string): Promise<Meeting | null> {
    const meeting = await this.meetingRepo.findOne({ where: { id: meetingId } });

    if (!meeting) return null;

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

    return await this.meetingRepo.save(meeting);
  }

  /**
   * Get meeting by ID
   */
  async getMeeting(meetingId: string): Promise<Meeting | null> {
    return await this.meetingRepo.findOne({
      where: { id: meetingId },
      relations: { initiator: true, responder: true },
    });
  }

  /**
   * Auto-cancel expired meetings
   */
  async cancelExpiredMeetings(): Promise<void> {
    const now = new Date();
    const expiredMeetings = await this.meetingRepo.find({
      where: { status: MeetingStatus.ACCEPTED },
    });

    for (const meeting of expiredMeetings) {
      if (meeting.expiresAt < now) {
        meeting.status = MeetingStatus.CANCELLED;
        await this.meetingRepo.save(meeting);
      }
    }
  }
}
