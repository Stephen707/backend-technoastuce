import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  IsRichText,
  IsSingleLineText,
} from '../../articles/articles.validation';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { IsOptionalNotNull } from '../../taxonomy/taxonomy.validation';
import {
  CAMPAIGN_CONTENT_MAX_LENGTH,
  CAMPAIGN_SUBJECT_MAX_LENGTH,
  CAMPAIGN_SUBJECT_MIN_LENGTH,
  CampaignStatus,
} from '../schemas/campaign.schema';
import {
  SUBSCRIBER_SOURCE_MAX_LENGTH,
  SubscriberStatus,
} from '../schemas/subscriber.schema';

// RFC 5321 limit for a whole address.
const EMAIL_MAX_LENGTH = 254;
const SEARCH_MAX_LENGTH = 100;
// Tokens are 32 random bytes in base64url (43 chars).
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const SOURCE_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class SubscribeDto {
  @ApiProperty({ example: 'reader@example.com', maxLength: EMAIL_MAX_LENGTH })
  @Transform(normalizeEmail)
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  @IsEmail({ allow_display_name: false, allow_ip_domain: false })
  email: string;

  @ApiPropertyOptional({
    example: 'footer',
    maxLength: SUBSCRIBER_SOURCE_MAX_LENGTH,
    description: 'Where the form was (lowercase letters, digits, - and _)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(SUBSCRIBER_SOURCE_MAX_LENGTH)
  @Matches(SOURCE_PATTERN)
  source?: string;
}

export class NewsletterTokenDto {
  @ApiProperty({ description: 'Token from the email link' })
  @IsString()
  @Matches(TOKEN_PATTERN, { message: 'Invalid token' })
  token: string;
}

export const SUBSCRIBER_SORTS = ['-createdAt', 'createdAt', 'email'] as const;
export type SubscriberSort = (typeof SUBSCRIBER_SORTS)[number];

export class ListSubscribersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SubscriberStatus })
  @IsOptional()
  @IsEnum(SubscriberStatus)
  status?: SubscriberStatus;

  @ApiPropertyOptional({
    description: 'Email prefix (case-insensitive)',
    maxLength: SEARCH_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(normalizeEmail)
  @IsString()
  @IsNotEmpty()
  @MaxLength(SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: SUBSCRIBER_SORTS, default: '-createdAt' })
  @IsOptional()
  @IsIn(SUBSCRIBER_SORTS)
  sort: SubscriberSort = '-createdAt';
}

export class CreateCampaignDto {
  @ApiProperty({
    minLength: CAMPAIGN_SUBJECT_MIN_LENGTH,
    maxLength: CAMPAIGN_SUBJECT_MAX_LENGTH,
  })
  @IsSingleLineText(CAMPAIGN_SUBJECT_MIN_LENGTH, CAMPAIGN_SUBJECT_MAX_LENGTH)
  subject: string;

  @ApiProperty({
    maxLength: CAMPAIGN_CONTENT_MAX_LENGTH,
    description: 'HTML, sanitized with the same allowlist as articles',
  })
  @IsRichText(CAMPAIGN_CONTENT_MAX_LENGTH)
  content: string;
}

export class UpdateCampaignDto {
  @ApiPropertyOptional({
    minLength: CAMPAIGN_SUBJECT_MIN_LENGTH,
    maxLength: CAMPAIGN_SUBJECT_MAX_LENGTH,
  })
  @IsOptionalNotNull()
  @IsSingleLineText(CAMPAIGN_SUBJECT_MIN_LENGTH, CAMPAIGN_SUBJECT_MAX_LENGTH)
  subject?: string;

  @ApiPropertyOptional({ maxLength: CAMPAIGN_CONTENT_MAX_LENGTH })
  @IsOptionalNotNull()
  @IsRichText(CAMPAIGN_CONTENT_MAX_LENGTH)
  content?: string;
}

export class ListCampaignsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CampaignStatus })
  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;
}
