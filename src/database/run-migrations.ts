import * as dotenv from 'dotenv';
dotenv.config();

import { DataSource } from 'typeorm';
import { ProductionIndexesAndSchema1795620000000 } from './migrations/1795620000000-ProductionIndexesAndSchema';
import { AlignReportsSchema1795620000001 } from './migrations/1795620000001-AlignReportsSchema';
import { buildMigrationDataSourceOptions } from './typeorm-config';

const migrationsList = [
  ProductionIndexesAndSchema1795620000000,
  AlignReportsSchema1795620000001,
];

const ds = new DataSource(buildMigrationDataSourceOptions(migrationsList));

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
