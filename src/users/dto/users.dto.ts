import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsStrongPassword,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PASSWORD_MESSAGE, PASSWORD_RULES } from '../../auth/dto/register.dto';
import { Role } from '../schemas/user.schema';
import { IsPersonName } from './person-name.validation';

export const USER_SORTS = [
  'createdAt',
  '-createdAt',
  'email',
  '-email',
  'lastLoginAt',
  '-lastLoginAt',
] as const;
export type UserSort = (typeof USER_SORTS)[number];

export const MAX_PAGE_SIZE = 100;

// Query strings only carry text: map "true"/"false" explicitly so that any
// other value fails @IsBoolean instead of being silently coerced.
const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Self-service: only the profile fields a user owns. Anything else (role,
// isActive, email, ...) is rejected by the global whitelist pipe.
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Jean', maxLength: 50 })
  @IsOptional()
  @IsPersonName()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Dupont', maxLength: 50 })
  @IsOptional()
  @IsPersonName()
  lastName?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword: string;

  @ApiProperty({ example: 'Correct-Horse-42', minLength: 12, maxLength: 128 })
  @IsString()
  @IsStrongPassword(PASSWORD_RULES, { message: PASSWORD_MESSAGE })
  @MaxLength(128)
  newPassword: string;
}

export class ListUsersQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 10_000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000) // deep skips are expensive; narrow the search instead
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: MAX_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit = 20;

  @ApiPropertyOptional({
    description: 'Prefix match on email, first name or last name',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: USER_SORTS, default: '-createdAt' })
  @IsOptional()
  @IsIn(USER_SORTS)
  sort: UserSort = '-createdAt';
}

export class AdminUpdateUserDto extends UpdateProfileDto {
  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ description: 'false signs the user out everywhere' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
