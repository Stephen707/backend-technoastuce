import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  addDays,
  daysBetween,
  isBot,
  msUntilEndOfUtcDay,
  utcDay,
  visitorHash,
} from './analytics.utils';
import {
  OverviewQueryDto,
  PopularQueryDto,
  TrackViewDto,
} from './dto/analytics.dto';

describe('analytics utils', () => {
  it('works on UTC days', () => {
    expect(utcDay(new Date('2026-03-01T23:59:59.999Z'))).toBe('2026-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(daysBetween('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(daysBetween('2026-01-02', '2026-01-01')).toEqual([]);
    expect(msUntilEndOfUtcDay(new Date('2026-03-01T23:00:00Z'))).toBe(
      3600 * 1000,
    );
  });

  it('visitorHash is stable within a day and unlinkable across days', () => {
    const a = visitorHash('s', '2026-03-01', '1.2.3.4', 'UA');
    expect(a).toHaveLength(22);
    expect(visitorHash('s', '2026-03-01', '1.2.3.4', 'UA')).toBe(a);
    expect(visitorHash('s', '2026-03-02', '1.2.3.4', 'UA')).not.toBe(a);
    expect(visitorHash('s', '2026-03-01', '1.2.3.5', 'UA')).not.toBe(a);
    expect(visitorHash('other', '2026-03-01', '1.2.3.4', 'UA')).not.toBe(a);
    expect(a).not.toContain('1.2.3.4');
  });

  it.each([
    [undefined, true],
    ['', true],
    ['Mozilla/5.0 (compatible; Googlebot/2.1)', true],
    ['facebookexternalhit/1.1', true],
    ['curl/8.4.0', true],
    ['Mozilla/5.0 HeadlessChrome/120.0', true],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
      false,
    ],
  ])('isBot(%j) = %s', (ua, expected) => {
    expect(isBot(ua)).toBe(expected);
  });
});

describe('analytics DTOs', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const check = <T>(
    metatype: new () => T,
    value: unknown,
    type: 'body' | 'query' = 'query',
  ) => pipe.transform(value, { type, metatype }) as Promise<T>;

  it('validates view pings', async () => {
    const id = '64b7f0c2a1b2c3d4e5f60718';
    await expect(
      check(TrackViewDto, { type: 'ARTICLE', id }, 'body'),
    ).resolves.toEqual({ type: 'ARTICLE', id });
    for (const value of [
      { type: 'PAGE', id },
      { type: 'ARTICLE', id: { $ne: null } },
      { type: 'ARTICLE', id, views: 1000 },
    ]) {
      await expect(check(TrackViewDto, value, 'body')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it('bounds popular queries', async () => {
    await expect(
      check(PopularQueryDto, { type: 'VIDEO' }),
    ).resolves.toMatchObject({ days: 7, limit: 5 });
    for (const extra of [{ days: '0' }, { days: '91' }, { limit: '21' }]) {
      await expect(
        check(PopularQueryDto, { type: 'VIDEO', ...extra }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('only accepts real YYYY-MM-DD dates in overview ranges', async () => {
    await expect(
      check(OverviewQueryDto, { from: '2026-02-01', to: '2026-02-28' }),
    ).resolves.toEqual({ from: '2026-02-01', to: '2026-02-28' });
    for (const from of ['2026-02-30', '2026-2-1', '2026-02-01T00:00:00Z']) {
      await expect(
        check(OverviewQueryDto, { from }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});
