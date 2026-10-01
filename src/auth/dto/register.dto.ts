import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsStrongPassword,
  MaxLength,
} from 'class-validator';
import { IsPersonName } from '../../users/dto/person-name.validation';

export const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const PASSWORD_RULES = {
  minLength: 12,
  minLowercase: 1,
  minUppercase: 1,
  minNumbers: 1,
  minSymbols: 0,
};
export const PASSWORD_MESSAGE =
  'Password must be at least 12 characters with an uppercase letter, a lowercase letter and a number';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Correct-Horse-42', minLength: 12, maxLength: 128 })
  @IsString()
  @IsStrongPassword(PASSWORD_RULES, { message: PASSWORD_MESSAGE })
  @MaxLength(128) // bounds hashing cost per request
  password: string;

  @ApiPropertyOptional({ example: 'Jean' })
  @IsOptional()
  @IsPersonName()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Dupont' })
  @IsOptional()
  @IsPersonName()
  lastName?: string;
}
