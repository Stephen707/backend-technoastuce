import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Types } from 'mongoose';
import { toCampaignSummaryView } from './campaigns.service';
import {
  CreateCampaignDto,
  ListSubscribersQueryDto,
  NewsletterTokenDto,
  SubscribeDto,
  UpdateCampaignDto,
} from './dto/newsletter.dto';
import { toSubscriberView } from './newsletter.service';
import { CampaignStatus } from './schemas/campaign.schema';
import { SubscriberStatus } from './schemas/subscriber.schema';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const body = <T>(metatype: new () => T, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype }) as Promise<T>;
const TOKEN = 'a'.repeat(43);

describe('Newsletter DTOs', () => {
  it('normalizes the email and accepts a source', async () => {
    await expect(
      body(SubscribeDto, { email: '  Reader@Example.COM ', source: 'footer' }),
    ).resolves.toEqual({ email: 'reader@example.com', source: 'footer' });
  });

  it.each([
    { email: 'not-an-email' },
    { email: 'Name <reader@example.com>' },
    { email: `${'a'.repeat(250)}@x.com` },
    { email: { $ne: null } },
    { email: 'reader@example.com', source: 'Footer Form' },
    { email: 'reader@example.com', status: 'CONFIRMED' },
    { email: 'reader@example.com', unsubscribeToken: TOKEN },
  ])('rejects subscription %j', async (value) => {
    await expect(body(SubscribeDto, value)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('only accepts token-shaped tokens', async () => {
    await expect(body(NewsletterTokenDto, { token: TOKEN })).resolves.toEqual({
      token: TOKEN,
    });
    for (const token of ['short', `${TOKEN}!`, { $gt: '' }, ['a']]) {
      await expect(
        body(NewsletterTokenDto, { token }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('sanitizes campaign content like article bodies', async () => {
    const dto = await body(CreateCampaignDto, {
      subject: ' Les astuces du mois ',
      content:
        '<h1>Bonjour</h1><img src="https://cdn.example.com/a.png" onerror="alert(1)"><script>x</script><p onclick="x">Texte</p>',
    });
    expect({ ...dto }).toEqual({
      subject: 'Les astuces du mois',
      content:
        '<h2>Bonjour</h2><img loading="lazy" src="https://cdn.example.com/a.png" /><p>Texte</p>',
    });
    await expect(
      body(CreateCampaignDto, { subject: 'Sujet', content: '<script>x</script>' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      body(UpdateCampaignDto, { subject: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates subscriber queries', async () => {
    await expect(
      pipe.transform(
        { search: ' Bob@' },
        { type: 'query', metatype: ListSubscribersQueryDto },
      ),
    ).resolves.toMatchObject({ search: 'bob@', sort: '-createdAt' });
    await expect(
      pipe.transform(
        { status: 'BOUNCED' },
        { type: 'query', metatype: ListSubscribersQueryDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Newsletter views', () => {
  it('never exposes tokens', () => {
    const view = toSubscriberView({
      _id: new Types.ObjectId(),
      email: 'a@b.co',
      status: SubscriberStatus.CONFIRMED,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...({ unsubscribeToken: TOKEN, confirmTokenHash: 'h' } as object),
    });
    expect(view).toMatchObject({ source: null, confirmedAt: null });
    expect(JSON.stringify(view)).not.toContain(TOKEN);
    expect(view).not.toHaveProperty('confirmTokenHash');

    const createdBy = new Types.ObjectId();
    expect(
      toCampaignSummaryView({
        _id: new Types.ObjectId(),
        subject: 'S',
        status: CampaignStatus.DRAFT,
        recipientCount: 0,
        sentCount: 0,
        failedCount: 0,
        startedAt: null,
        finishedAt: null,
        createdBy,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).createdBy,
    ).toBe(createdBy.toHexString());
  });
});
