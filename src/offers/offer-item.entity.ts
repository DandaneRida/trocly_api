import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, type Relation } from 'typeorm';
import { Offer } from './offer.entity';
import { Listing } from '../listings/listing.entity';

@Entity('offer_items')
export class OfferItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Offer, offer => offer.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'offer_id' })
  offer: Relation<Offer>;

  @ManyToOne(() => Listing)
  @JoinColumn({ name: 'listing_id' })
  listing: Relation<Listing>;

  @Column({ name: 'quantity', default: 1 })
  quantity: number;
}
