import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { User } from '../users/user.entity';
import { OfferItem } from './offer-item.entity';

export enum OfferStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  COUNTERED = 'countered',
  CANCELLED = 'cancelled',
}

@Entity('offers')
export class Offer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'initiator_id' })
  initiator: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'responder_id' })
  responder: User;

  @Column({ name: 'parent_offer_id', type: 'uuid', nullable: true })
  parentOfferId: string; // For counter-offers

  @Column({ name: 'soulte', type: 'decimal', precision: 10, scale: 2, nullable: true })
  soulte: number; // Optional monetary addition (MAD)

  @Column({ nullable: true })
  message: string;

  @Column({
    type: 'enum',
    enum: OfferStatus,
    default: OfferStatus.PENDING,
  })
  status: OfferStatus;

  @OneToMany(() => OfferItem, item => item.offer, { cascade: true })
  items: OfferItem[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
