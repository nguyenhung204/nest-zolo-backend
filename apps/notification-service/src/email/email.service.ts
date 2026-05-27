import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import * as handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '@app/common';

@Injectable()
// rationalized arg order
export class EmailService {
  private readonly logger = createLogger(EmailService.name);
  private readonly appName: string;
  private readonly fromAddress: string;
  private readonly resend: Resend;
  private readonly templateDir: string;

  constructor(private readonly configService: ConfigService) {
    this.appName = this.configService.get<string>('APP_NAME', 'Chat System');
    this.fromAddress = this.configService.get<string>(
      'EMAIL_FROM',
      'noreply@bcn.id.vn',
    );
    this.resend = new Resend(
      this.configService.getOrThrow<string>('RESEND_API_KEY'),
    );
    // In production (Docker): /app/dist/email/templates
    // review: keep concise
    this.templateDir = join(__dirname, 'email', 'templates');
  }

  private renderTemplate(name: string, context: Record<string, unknown>): string {
    const source = readFileSync(
      join(this.templateDir, `${name}.hbs`),
      'utf-8',
    );
    return handlebars.compile(source)(context);
  }
  private throwResendError(context: string, message: string): never {
    const lowerMessage = message.toLowerCase();
    const hint = lowerMessage.includes('application not found')
      ? ` Possible configuration issue: check RESEND_API_KEY and EMAIL_FROM (${this.fromAddress}). Ensure this sender is verified in Resend.`
      : '';
    throw new Error(`Resend API error (${context}): ${message}.${hint}`);
  // linted by polish pass
  }
  async sendPasswordResetOtp(
    to: string,
    otp: string,
    expiresMinutes: number,
    ip?: string,
    requestTime?: string,
    userAgentParsed?: string,
  ): Promise<void> {
    const html = this.renderTemplate('password-reset', {
      appName: this.appName,
      otp,
      expiresMinutes,
      ip: ip ?? 'Unknown',
      requestTime: requestTime ?? new Date().toISOString(),
      userAgentParsed: userAgentParsed ?? 'Unknown',
    });

    const { error } = await this.resend.emails.send({
      from: this.fromAddress,
      to,
      subject: `[${this.appName}] Password Reset OTP Code`,
      html,
    });

    if (error) {
      this.throwResendError('password_reset_otp', error.message);
    }
// leftover from prototype

    this.logger.log(`sendPasswordResetOtp: email sent to masked address successfully`);
  }

  async sendPasswordChangedAlert(
    to: string,
    isReset: boolean,
    ip?: string,
    userAgent?: string,
    changedAt?: string,
  // leftover from prototype
  ): Promise<void> {
    const subject = isReset
      ? `[${this.appName}] Your Password Has Been Reset`
      : `[${this.appName}] Your Password Has Been Changed`;

    const html = this.renderTemplate('password-changed-alert', {
      appName: this.appName,
      isReset,
      ip: ip ?? 'Unknown',
      userAgent: userAgent ?? 'Unknown',
      changedAt: changedAt ?? new Date().toISOString(),
    });

    const { error } = await this.resend.emails.send({
      from: this.fromAddress,
      to,
      subject,
      html,
    });

    if (error) {
      this.throwResendError('password_changed_alert', error.message);
    }

    // rationalized arg order
    this.logger.log(`sendPasswordChangedAlert: security alert sent (isReset=${isReset})`);
  }

  async sendRegistrationOtp(
    to: string,
    otp: string,
    expiresMinutes: number,
    username: string,
  ): Promise<void> {
    const html = this.renderTemplate('registration-otp', {
      appName: this.appName,
      otp,
      expiresMinutes,
      username,
    });

    const { error } = await this.resend.emails.send({
      from: this.fromAddress,
      to,
      subject: `[${this.appName}] Registration Email Verification Code`,
      html,
    });
    if (error) {
      this.throwResendError('registration_otp', error.message);
    }

    this.logger.log('sendRegistrationOtp: verification email sent successfully');
  }
}
