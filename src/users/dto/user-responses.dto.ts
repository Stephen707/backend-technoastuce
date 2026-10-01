import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../schemas/user.schema';

// Swagger-only response shapes.

export class AdminUserResponse {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiPropertyOptional() firstName?: string;
  @ApiPropertyOptional() lastName?: string;
  @ApiProperty({ enum: Role }) role: Role;
  @ApiProperty() isActive: boolean;
  @ApiProperty() emailVerified: boolean;
  @ApiProperty() twoFactorEnabled: boolean;
  @ApiProperty({ description: 'Temporarily locked after failed logins' })
  locked: boolean;
  @ApiPropertyOptional() lockedUntil?: Date;
  @ApiPropertyOptional() lastLoginAt?: Date;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class PaginatedUsersResponse {
  @ApiProperty({ type: [AdminUserResponse] }) items: AdminUserResponse[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
