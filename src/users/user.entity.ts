import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { City } from '../cities/city.entity';
import { Listing } from '../listings/listing.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, name: 'whatsapp_number' })
  whatsappNumber: string;

  @Column({ name: 'display_name' })
  displayName: string;

  @Column({ nullable: true })
  photo: string;

  @ManyToOne(() => City, city => city.users)
  @JoinColumn({ name: 'main_city_id' })
  city: City;

  @OneToMany(() => Listing, (listing: Listing) => listing.user)
  listings: Listing[];
}