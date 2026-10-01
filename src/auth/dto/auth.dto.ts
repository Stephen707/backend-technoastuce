import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsStrongPassword,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  normalizeEmail,
  PASSWORD_MESSAGE,
  PASSWORD_RULES,
} from './register.dto';

const TOTP_CODE = /^\d{6}$/;

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}

export class LoginMfaDto {
  @ApiProperty({ description: 'mfaToken returned by POST /auth/login' })
  @IsString()
  @IsNotEmpty()
  mfaToken: string;

  @ApiProperty({ example: '123456' })
  @Matches(TOTP_CODE, { message: 'code must be a 6-digit code' })
  code: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  refreshToken: string;
}

export class EmailDto {
  @ApiProperty({ example: 'user@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class TokenDto {
  @ApiProperty({ description: 'Token received by email' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;
}

export class ResetPasswordDto extends TokenDto {
  @ApiProperty({ example: 'Correct-Horse-42', minLength: 12, maxLength: 128 })
  @IsString()
  @IsStrongPassword(PASSWORD_RULES, { message: PASSWORD_MESSAGE })
  @MaxLength(128)
  password: string;
}

export class TotpCodeDto {
  @ApiProperty({ example: '123456' })
  @Matches(TOTP_CODE, { message: 'code must be a 6-digit code' })
  code: string;
}

export class DisableTwoFactorDto extends TotpCodeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}
