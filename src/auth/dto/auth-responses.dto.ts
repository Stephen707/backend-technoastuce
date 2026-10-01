import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../../users/schemas/user.schema';

// Swagger-only response shapes.

export class UserResponse {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiPropertyOptional() firstName?: string;
  @ApiPropertyOptional() lastName?: string;
  @ApiProperty({ enum: Role }) role: Role;
  @ApiProperty() emailVerified: boolean;
  @ApiProperty() twoFactorEnabled: boolean;
  @ApiProperty() createdAt: Date;
}

export class AuthTokensResponse {
  @ApiProperty({ type: UserResponse }) user: UserResponse;
  @ApiProperty() accessToken: string;
  @ApiProperty({ description: 'Opaque token, rotated on every refresh' })
  refreshToken: string;
  @ApiProperty({ example: 900, description: 'Access token lifetime (s)' })
  expiresIn: number;
  @ApiPropertyOptional({
    description: 'Privileged account without 2FA: must enroll via /auth/2fa',
  })
  twoFactorSetupRequired?: boolean;
}

export class MfaChallengeResponse {
  @ApiProperty({ example: true }) mfaRequired: true;
  @ApiProperty({ description: 'Send to POST /auth/login/2fa' })
  mfaToken: string;
  @ApiProperty({ example: 300 }) expiresIn: number;
}

export class SessionResponse {
  @ApiProperty() id: string;
  @ApiPropertyOptional() ip?: string;
  @ApiPropertyOptional() userAgent?: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() lastUsedAt: Date;
  @ApiProperty() expiresAt: Date;
  @ApiProperty({ description: 'True for the session making this request' })
  current: boolean;
}

export class TwoFactorSetupResponse {
  @ApiProperty({ description: 'Base32 secret, for manual entry' })
  secret: string;
  @ApiProperty({ description: 'Render as a QR code for authenticator apps' })
  otpauthUrl: string;
}

export class MessageResponse {
  @ApiProperty() message: string;
}
