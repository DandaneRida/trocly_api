import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3.1 & 3.2 — Versioned TypeORM Migration
 * Consolidates Trocly schema, refresh_tokens, favorites, notifications,
 * composite performance indexes, and French full-text GIN index.
 */
export class ProductionIndexesAndSchema1795620000000
  implements MigrationInterface
{
  name = 'ProductionIndexesAndSchema1795620000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash varchar(128) NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens (token_hash);

      CREATE TABLE IF NOT EXISTS favorites (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, listing_id)
      );
      CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites (user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        type varchar(64) NOT NULL DEFAULT 'info',
        title varchar(200) NOT NULL DEFAULT '',
        body text NOT NULL DEFAULT '',
        data jsonb,
        is_read boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS device_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        token text NOT NULL UNIQUE,
        platform varchar(32) NOT NULL DEFAULT 'unknown',
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      ALTER TABLE meetings
        ADD COLUMN IF NOT EXISTS cancel_reason text,
        ADD COLUMN IF NOT EXISTS cancelled_by_id uuid;

      CREATE INDEX IF NOT EXISTS idx_listings_city_status_created
        ON listings (city_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_listings_search_gin
        ON listings USING GIN (to_tsvector('french', coalesce(title, '') || ' ' || coalesce(description, '')));
      CREATE INDEX IF NOT EXISTS idx_offers_participants_status
        ON offers (initiator_id, responder_id, status);
      CREATE INDEX IF NOT EXISTS idx_messages_offer_created
        ON messages (offer_id, created_at ASC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_messages_offer_created;
      DROP INDEX IF EXISTS idx_offers_participants_status;
      DROP INDEX IF EXISTS idx_listings_search_gin;
      DROP INDEX IF EXISTS idx_listings_city_status_created;
    `);
  }
}
