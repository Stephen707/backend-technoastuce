import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserResponse } from '../auth/dto/auth-responses.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from './schemas/user.schema';
import {
  AdminUserResponse,
  PaginatedUsersResponse,
} from './dto/user-responses.dto';
import {
  AdminUpdateUserDto,
  ChangePasswordDto,
  ListUsersQueryDto,
  UpdateProfileDto,
} from './dto/users.dto';
import { UserManagementService } from './user-management.service';

const STRICT = { default: { limit: 5, ttl: 60_000 } };

// `/users/me` routes are declared before `/users/:id` so they always win.
@ApiTags('Users')
@ApiBearerAuth('access-token')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly users: UserManagementService) {}

  // ------------------------------------------------------------ self-service

  @Get('me')
  @ApiOperation({ summary: 'Your profile' })
  @ApiOkResponse({ type: UserResponse })
  getMe(@CurrentUser() user: AuthUser) {
    return this.users.getProfile(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update your profile (first/last name)' })
  @ApiOkResponse({ type: UserResponse })
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  @Post('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(STRICT)
  @ApiOperation({
    summary: 'Change your password',
    description:
      'Requires the current password. Signs out every other session.',
  })
  @ApiNoContentResponse()
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.users.changePassword(user, dto);
  }

  // ------------------------------------------------------------------ admin
  // RolesGuard also requires a 2FA-verified session for these roles.

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: '[Admin] List users (paginated, filterable)' })
  @ApiOkResponse({ type: PaginatedUsersResponse })
  @ApiForbiddenResponse({ description: 'Not an admin, or 2FA not verified' })
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: '[Admin] Get a user' })
  @ApiOkResponse({ type: AdminUserResponse })
  getOne(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    return this.users.getById(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: '[Admin] Update a user (names, role, active flag)',
    description:
      'ADMIN can only manage USER accounts; SUPER_ADMIN can manage everyone but themselves. Role changes and deactivation revoke all sessions of the user.',
  })
  @ApiOkResponse({ type: AdminUserResponse })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: AdminUpdateUserDto,
  ) {
    return this.users.adminUpdate(actor, id, dto);
  }

  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: '[Admin] Clear a brute-force lockout' })
  @ApiOkResponse({ type: AdminUserResponse })
  unlock(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
  ) {
    return this.users.unlock(actor, id);
  }
}
