import * as dotenv from 'dotenv';
dotenv.config();

import { DataSource } from 'typeorm';
import { ProductionIndexesAndSchema1795620000000 } from './migrations/1795620000000-ProductionIndexesAndSchema';
import { AlignReportsSchema1795620000001 } from './migrations/1795620000001-AlignReportsSchema';

const dbUrl = process.env.DATABASE_URL || '';
const useDbSsl =
  process.env.DB_SSL === 'true' ||
  (Boolean(dbUrl) &&
    !dbUrl.includes('localhost') &&
    !dbUrl.includes('127.0.0.1'));

const migrationsList = [
  ProductionIndexesAndSchema1795620000000,
  AlignReportsSchema1795620000001,
];

const ds = new DataSource(
  dbUrl
    ? {
        type: 'postgres',
        url: dbUrl,
        ssl: useDbSsl ? { rejectUnauthorized: false } : false,
        migrations: migrationsList,
      }
    : {
        type: 'postgres',
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        username: process.env.DB_USERNAME || 'troc',
        password: process.env.DB_PASSWORD || 'troc',
        database: process.env.DB_NAME || 'trocly_db',
        ssl: useDbSsl ? { rejectUnauthorized: false } : false,
        migrations: migrationsList,
      },
);

async function main() {
  await ds.initialize();
  const executed = await ds.runMigrations();
  console.log(
    `[MIGRATIONS] ${executed.length} migration(s) appliquée(s) avec succès.`,
  );
  await ds.destroy();
}

main().catch((err) => {
  console.error('[MIGRATIONS ERROR]', err);
  process.exit(1);
});
