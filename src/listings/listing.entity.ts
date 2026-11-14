import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';
import { City } from '../cities/city.entity';

export enum ListingStatus {
  ACTIVE = 'active',
  EXCHANGED = 'exchanged',
  UNAVAILABLE = 'unavailable',
  ARCHIVED = 'archived',
}

@Entity('listings')
@Index(
  'IDX_UNIQUE_ACTIVE_LISTING', 
  ['user', 'title', 'category', 'condition', 'estimatedValue', 'city'], 
  { unique: true, where: "status = 'active'" }
)
export class Listing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ nullable: true })
  description: string;

  @Column()
  category: string;

  @Column()
  condition: string;

  @Column({ name: 'estimated_value', type: 'decimal', precision: 10, scale: 2 })
  estimatedValue: number;

  @Column({
    type: 'enum',
    enum: ListingStatus,
    default: ListingStatus.ACTIVE,
  })
  status: ListingStatus;

  // Array of photo URLs
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  photos: string[];

  // JSONB for flexible attributes
  @Column({ type: 'jsonb', default: {} })
  attributes: Record<string, any>;

  @ManyToOne(() => User, user => user.listings)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => City, city => city.listings)
  @JoinColumn({ name: 'city_id' })
  city: City;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
