import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export enum MeetingStatus {
  PROPOSED = 'proposed',
  ACCEPTED = 'accepted',
  VALIDATED = 'validated',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  COMPLETED = 'completed',
}

@Entity('meetings')
export class Meeting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'offer_id' })
  offerId: string;

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
  expiresAt: Date; // scheduledAt + 2 hours (D4)

  @Column({
    type: 'enum',
    enum: MeetingStatus,
    default: MeetingStatus.PROPOSED,
  })
  status: MeetingStatus;

  @Column({ name: 'qr_payload_initiator', nullable: true })
  qrPayloadInitiator: string;

  @Column({ name: 'qr_payload_responder', nullable: true })
  qrPayloadResponder: string;

  @Column({ name: 'initiator_scanned_at', type: 'timestamptz', nullable: true })
  initiatorScannedAt: Date;

  @Column({ name: 'responder_scanned_at', type: 'timestamptz', nullable: true })
  responderScannedAt: Date;

  @Column({ name: 'scanned_at', type: 'timestamptz', nullable: true })
  scannedAt: Date;

  @Column({ name: 'scanned_by_id', nullable: true })
  scannedById: string;

  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason: string | null;

  @Column({ name: 'cancelled_by_id', type: 'varchar', nullable: true })
  cancelledById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
