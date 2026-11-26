import * as dns from 'dns';
import * as net from 'net';
import { Logger } from '@nestjs/common';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSource, type DataSourceOptions } from 'typeorm';

// Prefer IPv4 and disable Node 20/22 Happy Eyeballs (autoSelectFamily) so
// container environments without IPv6 routes never fail with AggregateError [ECONNREFUSED].
try {
  dns.setDefaultResultOrder('ipv4first');
  if (typeof net.setDefaultAutoSelectFamily === 'function') {
    net.setDefaultAutoSelectFamily(false);
  }
} catch {
  // Ignore on runtimes that do not support these helpers
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
  ssl: { rejectUnauthorized: boolean; servername?: string } | false;
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

    const sslOption = shouldUseSsl
      ? net.isIP(host) === 0
        ? { rejectUnauthorized: false, servername: host }
        : { rejectUnauthorized: false }
      : false;

    return {
      host,
      port,
      username,
      password,
      database,
      ssl: sslOption,
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

  const sslOption = shouldUseSsl
    ? net.isIP(host) === 0
      ? { rejectUnauthorized: false, servername: host }
      : { rejectUnauthorized: false }
    : false;

  return {
    host,
    port,
    username,
    password,
    database,
    ssl: sslOption,
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

  let effectiveOptions: DataSourceOptions = options;
  const pgOpts = options as any;
  const originalHost: string | undefined = pgOpts.host;

  if (
    pgOpts.type === 'postgres' &&
    originalHost &&
    !isLocalDatabaseHost(originalHost) &&
    net.isIP(originalHost) === 0
  ) {
    try {
      const { address } = await dns.promises.lookup(originalHost, {
        family: 4,
      });
      if (address) {
        effectiveOptions = {
          ...pgOpts,
          host: address,
          ssl: pgOpts.ssl
            ? {
                ...(typeof pgOpts.ssl === 'object' ? pgOpts.ssl : {}),
                rejectUnauthorized: false,
                servername: originalHost,
              }
            : false,
        };
        dbLogger.log(
          `Resolved ${originalHost} -> IPv4 ${address} (SNI=${originalHost})`,
        );
      }
    } catch (err: any) {
      dbLogger.warn(
        `IPv4 lookup for ${originalHost} fell back to hostname: ${err?.message || err}`,
      );
    }
  }

  const dataSource = await new DataSource(effectiveOptions).initialize();

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
