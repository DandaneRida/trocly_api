import * as dns from 'dns';
import { Logger } from '@nestjs/common';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSource, type DataSourceOptions } from 'typeorm';

// Prefer IPv4 in container environments (Docker/Abasthan) where IPv6 routes
// are unavailable and Happy Eyeballs would throw AggregateError [ECONNREFUSED].
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // Ignore on runtimes that do not support setDefaultResultOrder
}

const dbLogger = new Logger('DatabaseConfig');

function cleanEnvValue(val?: string | null): string {
  if (!val) return '';
  return val.trim().replace(/^['"]|['"]$/g, '').trim();
}

export function isLocalDatabaseHost(host: string): boolean {
  const h = (host || '').trim().toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === 'postgres' ||
    h === 'db'
  );
}

/**
 * Builds PostgreSQL connection credentials giving strict priority to DATABASE_URL
 * (or POSTGRES_URL / NEON_DATABASE_URL) over DB_HOST / DB_PORT, and configuring
 * `ssl: { rejectUnauthorized: false }` for Neon and all remote cloud hosts.
 *
 * Parses the URL explicitly into host/port/username/password/database instead of
 * passing raw `connectionString` to `pg`, preventing `pg-connection-string` from
 * overwriting `ssl: { rejectUnauthorized: false }` when `?sslmode=require` is present.
 */
export function resolvePostgresCredentials(
  env: Record<string, string | undefined> = process.env,
): {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl: { rejectUnauthorized: boolean } | false;
  source: 'DATABASE_URL' | 'DB_HOST';
} {
  const rawUrl = cleanEnvValue(
    env.DATABASE_URL || env.POSTGRES_URL || env.NEON_DATABASE_URL,
  );

  if (rawUrl) {
    const normalizedProtocol = rawUrl.replace(/^postgres:\/\//i, 'postgresql://');
    const parsed = new URL(normalizedProtocol);

    const host = parsed.hostname;
    const port = parsed.port ? parseInt(parsed.port, 10) : 5432;
    const username = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    const database =
      decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'neondb';

    const sslMode = (parsed.searchParams.get('sslmode') || '').toLowerCase();
    const forceNoSsl = env.DB_SSL === 'false' || sslMode === 'disable';
    const shouldUseSsl =
      !forceNoSsl &&
      (env.DB_SSL === 'true' ||
        host.includes('neon.tech') ||
        sslMode === 'require' ||
        sslMode === 'verify-ca' ||
        sslMode === 'verify-full' ||
        sslMode === 'no-verify' ||
        !isLocalDatabaseHost(host));

    return {
      host,
      port,
      username,
      password,
      database,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
      source: 'DATABASE_URL',
    };
  }

  const host = cleanEnvValue(env.DB_HOST) || 'localhost';
  const port = parseInt(cleanEnvValue(env.DB_PORT) || '5432', 10);
  const username = cleanEnvValue(env.DB_USERNAME) || 'troc';
  const password = cleanEnvValue(env.DB_PASSWORD) || 'troc';
  const database = cleanEnvValue(env.DB_NAME) || 'trocly_db';

  const forceNoSsl = env.DB_SSL === 'false';
  const shouldUseSsl =
    !forceNoSsl &&
    (env.DB_SSL === 'true' ||
      host.includes('neon.tech') ||
      !isLocalDatabaseHost(host));

  return {
    host,
    port,
    username,
    password,
    database,
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
    source: 'DB_HOST',
  };
}

export function buildTypeOrmModuleOptions(
  env: Record<string, string | undefined> = process.env,
): TypeOrmModuleOptions {
  const creds = resolvePostgresCredentials(env);
  dbLogger.log(
    `PostgreSQL target: ${creds.host}:${creds.port}/${creds.database} (source=${creds.source}, ssl=${Boolean(creds.ssl)})`,
  );

  return {
    type: 'postgres',
    host: creds.host,
    port: creds.port,
    username: creds.username,
    password: creds.password,
    database: creds.database,
    ssl: creds.ssl,
    connectTimeoutMS: 15000,
    retryAttempts: 3,
    retryDelay: 2000,
    extra: {
      connectionTimeoutMillis: 15000,
      keepAlive: true,
    },
    autoLoadEntities: true,
    synchronize: false,
    logging: false,
  };
}

export function buildMigrationDataSourceOptions(
  migrations: any[],
  env: Record<string, string | undefined> = process.env,
): DataSourceOptions {
  const creds = resolvePostgresCredentials(env);
  return {
    type: 'postgres',
    host: creds.host,
    port: creds.port,
    username: creds.username,
    password: creds.password,
    database: creds.database,
    ssl: creds.ssl,
    connectTimeoutMS: 15000,
    extra: {
      connectionTimeoutMillis: 15000,
    },
    migrations,
  };
}

const DEFAULT_MOROCCAN_CITIES = [
  'Meknès',
  'Fès',
  'Rabat',
  'Casablanca',
  'Marrakech',
  'Tanger',
  'Agadir',
  'Oujda',
  'Kénitra',
  'Tétouan',
];

/**
 * Initializes the TypeORM DataSource and auto-bootstraps core tables + Moroccan cities
 * when connecting to a fresh/empty database (such as a newly provisioned Neon instance).
 */
export async function initializeAndBootstrapDataSource(
  options?: DataSourceOptions,
): Promise<DataSource> {
  if (!options) {
    throw new Error('DataSourceOptions are required');
  }
  const dataSource = await new DataSource(options).initialize();

  const existingUsersTable = await dataSource.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users' LIMIT 1`,
  );

  if (existingUsersTable.length === 0) {
    dbLogger.log(
      'Empty PostgreSQL schema detected — running initial TypeORM synchronize()...',
    );
    await dataSource.synchronize();
  }

  try {
    const cityRows = await dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM cities`,
    );
    if ((cityRows?.[0]?.cnt ?? 0) === 0) {
      dbLogger.log('Seeding default Moroccan cities into empty cities table...');
      for (const cityName of DEFAULT_MOROCCAN_CITIES) {
        await dataSource.query(
          `INSERT INTO cities (name) VALUES ($1) ON CONFLICT DO NOTHING`,
          [cityName],
        );
      }
    }
  } catch (err: any) {
    dbLogger.warn(`City bootstrap check skipped: ${err?.message || err}`);
  }

  return dataSource;
}
