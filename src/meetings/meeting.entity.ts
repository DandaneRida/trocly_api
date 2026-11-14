import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';

export enum MeetingStatus {
  PROPOSED = 'proposed',
  ACCEPTED = 'accepted',
  VALIDATED = 'validated', // Changed: only ONE scan needed (single participant scan validates)
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
}

@Entity('meetings')
export class Meeting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  offerId: string; // Foreign key to Offer

  @ManyToOne(() => User)
  @JoinColumn({ name: 'initiator_id' })
  initiator: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'responder_id' })
  responder: User;

  @Column({ name: 'proposed_location', nullable: true })
  proposedLocation: string;

  @Column({ name: 'scheduled_at', type: 'timestamptz' })
  scheduledAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date; // scheduledAt + 2 hours

  @Column({
    type: 'enum',
    enum: MeetingStatus,
    default: MeetingStatus.PROPOSED,
  })
  status: MeetingStatus;

  @Column({ name: 'qr_payload_initiator', nullable: true })
  qrPayloadInitiator: string; // Signed QR data (meetingId + userId + expiration)

  @Column({ name: 'qr_payload_responder', nullable: true })
  qrPayloadResponder: string; // Signed QR data

  @Column({ name: 'scanned_at', type: 'timestamptz', nullable: true })
  scannedAt: Date; // CHANGED: single scan time (not two scans)

  @Column({ name: 'scanned_by_id', nullable: true })
  scannedById: string; // User who performed the single scan

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
