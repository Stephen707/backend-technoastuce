import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser, ClientInfo } from './auth.types';
import { Client, CurrentUser } from './decorators/current-user.decorator';
import {
  AuthTokensResponse,
  MessageResponse,
  MfaChallengeResponse,
  SessionResponse,
  TwoFactorSetupResponse,
  UserResponse,
} from './dto/auth-responses.dto';
import {
  DisableTwoFactorDto,
  EmailDto,
  LoginDto,
  LoginMfaDto,
  RefreshTokenDto,
  ResetPasswordDto,
  TokenDto,
  TotpCodeDto,
} from './dto/auth.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './services/auth.service';
import { SessionsService } from './services/sessions.service';

// Stricter per-IP limits on endpoints attackers would hammer.
const STRICT = { default: { limit: 5, ttl: 60_000 } };
const MODERATE = { default: { limit: 20, ttl: 60_000 } };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  @Post('register')
  @Throttle(STRICT)
  @ApiOperation({ summary: 'Create an account and send a verification email' })
  @ApiCreatedResponse({ type: UserResponse })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  @ApiOperation({
    summary: 'Log in with email + password',
    description:
      'Returns tokens, or `{ mfaRequired, mfaToken }` when the account has 2FA enabled (then call POST /auth/login/2fa).',
  })
  @ApiExtraModels(AuthTokensResponse, MfaChallengeResponse)
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(AuthTokensResponse) },
        { $ref: getSchemaPath(MfaChallengeResponse) },
      ],
    },
  })
  login(@Body() dto: LoginDto, @Client() client: ClientInfo) {
    return this.auth.login(dto.email, dto.password, client);
  }

  @Post('login/2fa')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  @ApiOperation({ summary: 'Complete login with a TOTP code' })
  @ApiOkResponse({ type: AuthTokensResponse })
  loginTwoFactor(@Body() dto: LoginMfaDto, @Client() client: ClientInfo) {
    return this.auth.verifyMfaLogin(dto.mfaToken, dto.code, client);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle(MODERATE)
  @ApiOperation({
    summary: 'Get a new access token (rotates the refresh token)',
    description:
      'The old refresh token becomes invalid. Re-using it revokes the session.',
  })
  @ApiOkResponse({ type: AuthTokensResponse })
  refresh(@Body() dto: RefreshTokenDto, @Client() client: ClientInfo) {
    return this.auth.refresh(dto.refreshToken, client);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke the current session',
    description:
      'Takes the refresh token, so it works even after the access token expired.',
  })
  @ApiNoContentResponse()
  async logout(@Body() dto: RefreshTokenDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke every session of the current user' })
  @ApiNoContentResponse()
  async logoutAll(@CurrentUser() user: AuthUser) {
    await this.auth.logoutAll(user.id);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Current user' })
  @ApiOkResponse({ type: UserResponse })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List active sessions (tokens never exposed)' })
  @ApiOkResponse({ type: [SessionResponse] })
  listSessions(@CurrentUser() user: AuthUser) {
    return this.sessions.listActive(user.id, user.sessionId);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke one of your sessions' })
  @ApiNoContentResponse()
  async revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
  ) {
    await this.auth.revokeSession(user.id, sessionId);
  }

  // ---------------------------------------------------------------- password

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  @ApiOperation({ summary: 'Email a password reset link' })
  @ApiOkResponse({ type: MessageResponse })
  async forgotPassword(@Body() dto: EmailDto) {
    await this.auth.forgotPassword(dto.email);
    return {
      message:
        'If an account exists for this email, a reset link has been sent.',
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  @ApiOperation({
    summary: 'Set a new password with a reset token',
    description: 'Single use. Revokes every session of the account.',
  })
  @ApiOkResponse({ type: MessageResponse })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password);
    return { message: 'Password updated. Please log in again.' };
  }

  // -------------------------------------------------------- email verification

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle(MODERATE)
  @ApiOperation({ summary: 'Confirm an email address' })
  @ApiOkResponse({ type: MessageResponse })
  async verifyEmail(@Body() dto: TokenDto) {
    await this.auth.verifyEmail(dto.token);
    return { message: 'Email verified.' };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  @ApiOperation({ summary: 'Send a new verification email' })
  @ApiOkResponse({ type: MessageResponse })
  async resendVerification(@Body() dto: EmailDto) {
    await this.auth.resendVerification(dto.email);
    return {
      message:
        'If this email belongs to an unverified account, a new link has been sent.',
    };
  }

  // -------------------------------------------------------------- TOTP (2FA)

  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Start 2FA enrollment (returns secret + QR URL)' })
  @ApiOkResponse({ type: TwoFactorSetupResponse })
  setupTwoFactor(@CurrentUser() user: AuthUser) {
    return this.auth.setupTwoFactor(user);
  }

  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Confirm enrollment with a first code',
    description: 'Also signs out all other sessions.',
  })
  @ApiOkResponse({ type: MessageResponse })
  async enableTwoFactor(
    @CurrentUser() user: AuthUser,
    @Body() dto: TotpCodeDto,
  ) {
    await this.auth.enableTwoFactor(user, dto.code);
    return { message: 'Two-factor authentication enabled.' };
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Disable 2FA (requires password + current code)' })
  @ApiOkResponse({ type: MessageResponse })
  async disableTwoFactor(
    @CurrentUser() user: AuthUser,
    @Body() dto: DisableTwoFactorDto,
  ) {
    await this.auth.disableTwoFactor(user, dto.password, dto.code);
    return { message: 'Two-factor authentication disabled.' };
  }
}
