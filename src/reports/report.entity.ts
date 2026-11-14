import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';
import { Listing } from '../listings/listing.entity';

export enum ReportType {
  ABUSIVE_CONTENT = 'abusive_content',
  FRAUD = 'fraud',
  INAPPROPRIATE_IMAGES = 'inappropriate_images',
  SPAM = 'spam',
  OTHER = 'other',
}

export enum ReportStatus {
  PENDING = 'pending',
  REVIEWED = 'reviewed',
  RESOLVED = 'resolved',
}

@Entity('reports')
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'reporter_id' })
  reporter: User;

  @Column({ name: 'reported_user_id', nullable: true })
  reportedUserId: string; // Can report a user or listing

  @ManyToOne(() => Listing, { nullable: true })
  @JoinColumn({ name: 'reported_listing_id' })
  reportedListing: Listing;

  @Column({
    type: 'enum',
    enum: ReportType,
  })
  reportType: ReportType;

  @Column({ nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: ReportStatus,
    default: ReportStatus.PENDING,
  })
  status: ReportStatus;

  @Column({ name: 'admin_notes', nullable: true })
  adminNotes: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
