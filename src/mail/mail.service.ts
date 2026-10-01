import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { Config } from '../config/configuration';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly appName: string;
  private readonly appWebUrl: string;

  constructor(config: ConfigService<Config, true>) {
    const mail = config.get('mail', { infer: true });
    const auth = config.get('auth', { infer: true });

    this.from = mail.from;
    this.appName = auth.appName;
    this.appWebUrl = auth.appWebUrl.replace(/\/$/, '');
    this.transporter = createTransport({
      host: mail.host,
      port: mail.port,
      secure: mail.secure,
      auth: mail.user ? { user: mail.user, pass: mail.pass } : undefined,
    });
  }

  sendEmailVerification(to: string, token: string): Promise<void> {
    const link = `${this.appWebUrl}/verify-email?token=${encodeURIComponent(token)}`;
    return this.send(
      to,
      `Confirm your ${this.appName} email`,
      `Confirm your email address by opening this link (valid 24 hours):\n\n${link}\n\nIf you did not create an account, ignore this email.`,
    );
  }

  sendPasswordReset(to: string, token: string): Promise<void> {
    const link = `${this.appWebUrl}/reset-password?token=${encodeURIComponent(token)}`;
    return this.send(
      to,
      `Reset your ${this.appName} password`,
      `Reset your password by opening this link (valid 1 hour, single use):\n\n${link}\n\nIf you did not request this, ignore this email; your password is unchanged.`,
    );
  }

  sendPasswordChanged(to: string): Promise<void> {
    return this.send(
      to,
      `Your ${this.appName} password was changed`,
      'Your password was just changed and your other sessions were signed out.\n\nIf this was not you, reset your password immediately and contact support.',
    );
  }

  // Delivery failures are logged, never thrown: a failing SMTP server must
  // not break the request, nor reveal whether an account exists.
  private async send(to: string, subject: string, text: string): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, text });
    } catch (err) {
      this.logger.error(
        `Failed to send "${subject}" email`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
