import configuration from './configuration';
import { validateEnv } from './env.validation';

const base = {
  MONGODB_URI: 'mongodb://localhost:27017',
  DB_NAME: 'test',
  JWT_SECRET: 'x'.repeat(40),
  TWO_FACTOR_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('validateEnv', () => {
  it('parses a comma-separated CORS origin list', () => {
    expect(
      validateEnv({
        ...base,
        CORS_ORIGIN: 'https://technoastuce.com, https://admin.technoastuce.com/',
      }).CORS_ORIGIN,
    ).toEqual(['https://technoastuce.com', 'https://admin.technoastuce.com']);
  });

  it.each([
    'https://technoastuce.com/path',
    'technoastuce.com',
    'ftp://technoastuce.com',
    'https://a.com,not a url',
  ])('rejects the CORS origin %s', (CORS_ORIGIN) => {
    expect(() => validateEnv({ ...base, CORS_ORIGIN })).toThrow(/CORS_ORIGIN/);
  });

  it('requires CORS_ORIGIN and a long JWT secret in production', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production' }),
    ).toThrow(/CORS_ORIGIN/);
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://technoastuce.com',
        JWT_SECRET: 'short-secret',
      }),
    ).toThrow(/JWT_SECRET/);
  });

  it('only accepts redis:// and rediss:// cache URLs', () => {
    expect(
      validateEnv({ ...base, REDIS_URL: 'rediss://cache:6380' }).REDIS_URL,
    ).toBe('rediss://cache:6380');
    expect(() =>
      validateEnv({ ...base, REDIS_URL: 'http://cache:6379' }),
    ).toThrow(/REDIS_URL/);
  });
});

describe('configuration', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('derives public URLs and disables Swagger in production', () => {
    process.env = {
      ...base,
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://technoastuce.com',
      API_PUBLIC_URL: 'https://api.technoastuce.com/',
    };
    const config = configuration();
    expect(config.swaggerEnabled).toBe(false);
    expect(config.apiPublicUrl).toBe('https://api.technoastuce.com');
    expect(config.cache.redisUrl).toBeUndefined();
  });

  it('enables Swagger by default outside production', () => {
    process.env = { ...base, PORT: '5080' };
    const config = configuration();
    expect(config.swaggerEnabled).toBe(true);
    expect(config.apiPublicUrl).toBe('http://localhost:5080');
  });
});
