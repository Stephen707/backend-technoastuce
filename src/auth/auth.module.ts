import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { Config } from '../config/configuration';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuthSession, AuthSessionSchema } from './schemas/auth-session.schema';
import { AuthService } from './services/auth.service';
import { PasswordService } from './services/password.service';
import { SessionsService } from './services/sessions.service';
import { TotpService } from './services/totp.service';

@Module({
  imports: [
    UsersModule,
    MailModule,
    MongooseModule.forFeature([
      { name: AuthSession.name, schema: AuthSessionSchema },
    ]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Config, true>) => ({
        secret: config.get('jwtSecret', { infer: true }),
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionsService,
    PasswordService,
    TotpService,
    JwtAuthGuard,
    RolesGuard,
  ],
  // Other modules import AuthModule to protect their routes with the guards.
  exports: [
    JwtAuthGuard,
    RolesGuard,
    SessionsService,
    PasswordService,
    JwtModule,
    UsersModule,
  ],
})
export class AuthModule {}
