import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  AdminListVideosQueryDto,
  CreateVideoDto,
  ListVideosQueryDto,
  UpdateVideoDto,
} from './dto/videos.dto';
import { VideoStatus } from './schemas/video.schema';
import {
  defaultThumbnailUrl,
  embedUrl,
  parseVideoUrl,
  VideoProvider,
  watchUrl,
} from './video-url';
import {
  publicVideoFilter,
  resolveVideoPublishedAt,
  toVideoSummaryView,
  toVideoView,
} from './videos.service';
import { VideoRecord } from './videos.types';

const YT = 'dQw4w9WgXcQ';

describe('parseVideoUrl', () => {
  it.each([
    `https://www.youtube.com/watch?v=${YT}`,
    `https://www.youtube.com/watch?feature=share&v=${YT}&t=42`,
    `http://youtube.com/watch?v=${YT}`,
    `https://m.youtube.com/watch?v=${YT}`,
    `https://youtu.be/${YT}`,
    `https://youtu.be/${YT}?si=abc`,
    `https://www.youtube.com/shorts/${YT}`,
    `https://www.youtube.com/embed/${YT}`,
    `https://www.youtube.com/live/${YT}`,
    `https://www.youtube-nocookie.com/embed/${YT}`,
    `  https://WWW.YOUTUBE.COM/watch?v=${YT}  `,
  ])('reads a YouTube id from %s', (url) => {
    expect(parseVideoUrl(url)).toEqual({
      provider: VideoProvider.YOUTUBE,
      id: YT,
    });
  });

  it.each([
    'https://vimeo.com/76979871',
    'https://www.vimeo.com/76979871/',
    'https://vimeo.com/76979871/8272103f6e',
    'https://player.vimeo.com/video/76979871',
  ])('reads a Vimeo id from %s', (url) => {
    expect(parseVideoUrl(url)).toEqual({
      provider: VideoProvider.VIMEO,
      id: '76979871',
    });
  });

  it.each([
    'not a url',
    `javascript:alert('https://youtu.be/${YT}')`,
    `ftp://youtube.com/watch?v=${YT}`,
    `https://user:pw@youtube.com/watch?v=${YT}`,
    `https://youtube.com:8443/watch?v=${YT}`,
    `https://youtube.com.evil.com/watch?v=${YT}`,
    `https://evil.com/youtu.be/${YT}`,
    `https://www.youtube.com/watch?v=short`,
    `https://www.youtube.com/watch?v=${YT}x`,
    `https://www.youtube.com/watch?v="><script>`,
    'https://www.youtube.com/channel/UC123',
    'https://vimeo.com/channels/staffpicks',
    'https://player.vimeo.com/video/abc',
    `https://youtu.be/${'a'.repeat(3000)}`,
  ])('rejects %s', (url) => {
    expect(parseVideoUrl(url)).toBeNull();
  });

  it('builds player, page and thumbnail URLs from the id only', () => {
    expect(embedUrl(VideoProvider.YOUTUBE, YT)).toBe(
      `https://www.youtube-nocookie.com/embed/${YT}`,
    );
    expect(embedUrl(VideoProvider.VIMEO, '1')).toBe(
      'https://player.vimeo.com/video/1?dnt=1',
    );
    expect(watchUrl(VideoProvider.VIMEO, '1')).toBe('https://vimeo.com/1');
    expect(defaultThumbnailUrl(VideoProvider.YOUTUBE, YT)).toBe(
      `https://i.ytimg.com/vi/${YT}/hqdefault.jpg`,
    );
    expect(defaultThumbnailUrl(VideoProvider.VIMEO, '1')).toBeNull();
  });
});

describe('Video DTOs', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const body = <T>(metatype: new () => T, value: unknown) =>
    pipe.transform(value, { type: 'body', metatype }) as Promise<T>;
  const query = <T>(metatype: new () => T, value: unknown) =>
    pipe.transform(value, { type: 'query', metatype }) as Promise<T>;
  const valid = { title: 'Astuce vidéo', url: `https://youtu.be/${YT}` };

  it('accepts and normalizes a valid body', async () => {
    const dto = await body(CreateVideoDto, {
      ...valid,
      title: '  Astuce   vidéo ',
      description: ' Ligne 1\r\nLigne 2 ',
      thumbnailUrl: 'https://cdn.example.com/t.webp',
      durationSeconds: 125,
      status: 'PUBLISHED',
    });
    expect(dto).toMatchObject({
      title: 'Astuce vidéo',
      description: 'Ligne 1\nLigne 2',
      durationSeconds: 125,
      status: VideoStatus.PUBLISHED,
    });
  });

  it.each([
    { url: 'https://dailymotion.com/video/x7' },
    { url: { $ne: null } },
    { title: '<b>x</b>' },
    { description: '<script>' },
    { thumbnailUrl: 'http://cdn.example.com/t.webp' },
    { thumbnailUrl: 'javascript:alert(1)' },
    { durationSeconds: 0 },
    { durationSeconds: 1.5 },
    { durationSeconds: 86_401 },
    { provider: 'YOUTUBE' }, // derived, never accepted
    { providerVideoId: YT },
    { author: new Types.ObjectId().toHexString() },
    { tagIds: ['x'] },
  ])('rejects %j', async (extra) => {
    await expect(
      body(CreateVideoDto, { ...valid, ...extra }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts null where it clears a value on update', async () => {
    await expect(
      body(UpdateVideoDto, {
        thumbnailUrl: null,
        durationSeconds: null,
        categoryId: null,
        publishedAt: null,
      }),
    ).resolves.toMatchObject({ thumbnailUrl: null, durationSeconds: null });
    for (const field of ['title', 'url', 'slug', 'status', 'tagIds']) {
      await expect(
        body(UpdateVideoDto, { [field]: null }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('validates list queries', async () => {
    await expect(query(ListVideosQueryDto, {})).resolves.toMatchObject({
      sort: '-publishedAt',
      page: 1,
      limit: 20,
    });
    await expect(
      query(AdminListVideosQueryDto, { provider: 'TIKTOK' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      query(ListVideosQueryDto, { status: 'DRAFT' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Video helpers', () => {
  it('has the same publication rules as articles', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(publicVideoFilter(now)).toEqual({
      status: VideoStatus.PUBLISHED,
      publishedAt: { $lte: now },
    });
    expect(resolveVideoPublishedAt(VideoStatus.PUBLISHED, null, now)).toBe(now);
    expect(resolveVideoPublishedAt(VideoStatus.DRAFT, null, now)).toBeNull();
  });

  it('maps records to an allowlisted view with derived URLs', () => {
    const record: VideoRecord = {
      _id: new Types.ObjectId(),
      title: 'T',
      slug: 't',
      description: 'D',
      provider: VideoProvider.YOUTUBE,
      providerVideoId: YT,
      thumbnailUrl: null,
      durationSeconds: 60,
      author: { _id: new Types.ObjectId(), firstName: 'Ada' },
      category: null,
      tags: [null],
      status: VideoStatus.PUBLISHED,
      publishedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const summary = toVideoSummaryView(record);
    expect(summary).not.toHaveProperty('description');
    expect(summary).not.toHaveProperty('_id');
    expect(summary).toMatchObject({
      embedUrl: `https://www.youtube-nocookie.com/embed/${YT}`,
      watchUrl: `https://www.youtube.com/watch?v=${YT}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${YT}/hqdefault.jpg`,
      tags: [],
      author: { name: 'Ada' },
    });
    expect(toVideoView(record).description).toBe('D');
  });
});
