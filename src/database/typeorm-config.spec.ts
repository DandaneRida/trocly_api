import { resolvePostgresCredentials } from './typeorm-config';

describe('resolvePostgresCredentials', () => {
  it('prioritizes Neon DATABASE_URL over DB_HOST/DB_PORT and sets ssl: { rejectUnauthorized: false }', () => {
    const creds = resolvePostgresCredentials({
      DATABASE_URL:
        'postgresql://neondb_owner:mySecret%40123@ep-morning-frog-bgouxd4u-pooler.c-9.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USERNAME: 'troc',
      DB_PASSWORD: 'troc',
      DB_NAME: 'trocly_db',
    });

    expect(creds.source).toBe('DATABASE_URL');
    expect(creds.host).toBe(
      'ep-morning-frog-bgouxd4u-pooler.c-9.eu-central-1.aws.neon.tech',
    );
    expect(creds.port).toBe(5432);
    expect(creds.username).toBe('neondb_owner');
    expect(creds.password).toBe('mySecret@123');
    expect(creds.database).toBe('neondb');
    expect(creds.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('strips accidental quotes/whitespace around DATABASE_URL', () => {
    const creds = resolvePostgresCredentials({
      DATABASE_URL:
        '  "postgres://user:pass@ep-morning-frog-bgouxd4u-pooler.c-9.eu-central-1.aws.neon.tech:5432/trocly_prod"  ',
    });

    expect(creds.host).toBe(
      'ep-morning-frog-bgouxd4u-pooler.c-9.eu-central-1.aws.neon.tech',
    );
    expect(creds.database).toBe('trocly_prod');
    expect(creds.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('disables SSL for local PostgreSQL DATABASE_URL unless DB_SSL=true', () => {
    const creds = resolvePostgresCredentials({
      DATABASE_URL: 'postgresql://troc:troc@localhost:5432/trocly_db',
    });

    expect(creds.host).toBe('localhost');
    expect(creds.ssl).toBe(false);
  });
});
