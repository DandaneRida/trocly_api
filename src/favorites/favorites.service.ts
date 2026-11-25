import { Injectable, OnModuleInit, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Favorite } from './favorite.entity';
import { Listing } from '../listings/listing.entity';

@Injectable()
export class FavoritesService implements OnModuleInit {
  constructor(
    @InjectRepository(Favorite) private favRepo: Repository<Favorite>,
    @InjectRepository(Listing) private listingRepo: Repository<Listing>,
    private dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS favorites (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, listing_id)
      );
      CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites (user_id, created_at DESC);
    `);
  }

  async getUserFavorites(userId: string): Promise<Listing[]> {
    const favs = await this.favRepo.find({
      where: { userId },
      relations: { listing: { user: true, city: true } },
      order: { createdAt: 'DESC' },
    });
    return favs
      .map((f) => f.listing)
      .filter((l): l is Listing => !!l && l.status === ('active' as any));
  }

  async getFavoriteIds(userId: string): Promise<string[]> {
    const favs = await this.favRepo.find({
      where: { userId },
      select: { listingId: true },
    });
    return favs.map((f) => f.listingId);
  }

  async addFavorite(
    userId: string,
    listingId: string,
  ): Promise<{ favorited: boolean; listingId: string }> {
    const listing = await this.listingRepo.findOne({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Annonce introuvable');

    const existing = await this.favRepo.findOne({
      where: { userId, listingId },
    });
    if (!existing) {
      await this.favRepo.save(this.favRepo.create({ userId, listingId }));
    }
    return { favorited: true, listingId };
  }

  async removeFavorite(
    userId: string,
    listingId: string,
  ): Promise<{ favorited: boolean; listingId: string }> {
    await this.favRepo.delete({ userId, listingId });
    return { favorited: false, listingId };
  }
}
