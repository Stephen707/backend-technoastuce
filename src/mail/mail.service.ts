import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, SendMailOptions, Transporter } from 'nodemailer';
import { Config } from '../config/configuration';
import { API_PREFIX } from '../config/http';

export interface CampaignEmail {
  to: string;
  subject: string;
  // Sanitized rich-text HTML (see sanitizeRichText) and its plain text.
  html: string;
  text: string;
  unsubscribeToken: string;
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] ?? c,
  );

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly appName: string;
  private readonly appWebUrl: string;
  private readonly apiPublicUrl: string;

  constructor(config: ConfigService<Config, true>) {
    const mail = config.get('mail', { infer: true });
    const auth = config.get('auth', { infer: true });

    this.from = mail.from;
    this.appName = auth.appName;
    this.appWebUrl = auth.appWebUrl.replace(/\/$/, '');
    this.apiPublicUrl = config.get('apiPublicUrl', { infer: true });
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

  sendNewsletterConfirmation(to: string, token: string): Promise<void> {
    const link = `${this.appWebUrl}/newsletter/confirm?token=${encodeURIComponent(token)}`;
    return this.send(
      to,
      `Confirm your subscription to the ${this.appName} newsletter`,
      `Confirm your subscription by opening this link (valid 48 hours):\n\n${link}\n\nIf you did not ask to subscribe, ignore this email: you won't receive anything.`,
    );
  }

  /**
   * One newsletter email, with a visible unsubscribe link and RFC 8058
   * one-click unsubscribe headers. Returns false when delivery failed, so
   * the campaign can count failures (never throws).
   */
  sendCampaign(email: CampaignEmail): Promise<boolean> {
    const token = encodeURIComponent(email.unsubscribeToken);
    const pageUrl = `${this.appWebUrl}/newsletter/unsubscribe?token=${token}`;
    const oneClickUrl = `${this.apiPublicUrl}/${API_PREFIX}/newsletter/unsubscribe/one-click?token=${token}`;
    const footer = `You receive this email because you subscribed to the ${this.appName} newsletter.`;
    return this.deliver({
      to: email.to,
      subject: email.subject,
      text: `${email.text}\n\n--\n${footer}\nUnsubscribe: ${pageUrl}`,
      html: `${email.html}<hr><p style="font-size:12px;color:#666">${escapeHtml(footer)} <a href="${escapeHtml(pageUrl)}">Unsubscribe</a></p>`,
      headers: {
        'List-Unsubscribe': `<${oneClickUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
  }

  // Delivery failures are logged, never thrown: a failing SMTP server must
  // not break the request, nor reveal whether an account exists.
  private async send(to: string, subject: string, text: string): Promise<void> {
    await this.deliver({ to, subject, text });
  }

  private async deliver(
    options: Omit<SendMailOptions, 'from'>,
  ): Promise<boolean> {
    try {
      await this.transporter.sendMail({ ...options, from: this.from });
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to send "${String(options.subject)}" email`,
        err instanceof Error ? err.stack : String(err),
      );
      return false;
    }
  }
}
