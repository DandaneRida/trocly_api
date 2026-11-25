import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignReportsSchema1795620000001 implements MigrationInterface {
  name = 'AlignReportsSchema1795620000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_status') THEN
          ALTER TYPE report_status ADD VALUE IF NOT EXISTS 'pending';
          ALTER TYPE report_status ADD VALUE IF NOT EXISTS 'reviewed';
          ALTER TYPE report_status ADD VALUE IF NOT EXISTS 'resolved';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reports') THEN
          ALTER TABLE reports
            ADD COLUMN IF NOT EXISTS reported_listing_id uuid,
            ADD COLUMN IF NOT EXISTS reported_user_id uuid,
            ADD COLUMN IF NOT EXISTS description text,
            ADD COLUMN IF NOT EXISTS admin_notes text;
        END IF;
      END $$;
    `);
  }

  public async down(): Promise<void> {
    // Postgres enum values cannot be dropped safely in down migration
  }
}
