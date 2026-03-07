import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { createHmac, createHash, randomInt, randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import {
  SERVICES,
  NOTIFICATION_PATTERNS,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  createLogger,
} from '@app/common';
import { KafkaProducerService } from '@app/kafka';
import { KAFKA_TOPICS } from '@app/kafka/constants/kafka-topics.constants';
import { OtpStoreService } from './otp-store.service';
import { KeycloakAdminService } from './keycloak-admin.service';

const OTP_PURPOSE = 'forgot';
const OTP_EXPIRE_MINUTES = 10;
const OTP_EXPIRE_SECONDS = OTP_EXPIRE_MINUTES * 60;
const OTP_MAX_ATTEMPTS = 3;
/** TTL for the short-lived reset token generated after OTP verification (seconds). */
const RESET_TOKEN_TTL = 600;

@Injectable()
export class AuthGatewayService {
  private readonly logger = createLogger(AuthGatewayService.name);
  private readonly hmacSecret: string;

  constructor(
    @Inject(SERVICES.NOTIFICATION) private readonly notificationClient: ClientProxy,
    private readonly otpStore: OtpStoreService,
    private readonly keycloakAdmin: KeycloakAdminService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly configService: ConfigService,
  ) {
    this.hmacSecret = this.configService.get<string>('OTP_HMAC_SECRET') ?? '';
    if (!this.hmacSecret) {
      this.logger.warn(
        'OTP_HMAC_SECRET is not set — OTP security is degraded. Set this env var in production.',
      );
    }
  }

  //  Step 1: Forgot Password — sends OTP 

  /**
   * Request a password-reset OTP.
   *
   * Returns 404 when the email is not registered.
   *
   * NOTE: This intentionally reveals whether an email exists (user enumeration risk).
   * The product decision is to surface a clear 404 rather than the generic "always 200"
   * OWASP A01 pattern, because the UX benefit was deemed more important for this system.
   */
  async forgotPassword(
    email: string,
    ip: string,
    userAgent: string,
  ): Promise<{ message: string }> {
    const emailHash = this.hashEmail(email);

    // Rate limit: max 5 OTP requests / 15 min / email
    await this.otpStore.checkRateLimit(emailHash, OTP_PURPOSE);
    // Cooldown: min 60s between requests
    await this.otpStore.checkCooldown(emailHash, OTP_PURPOSE);

    // Lookup Keycloak user — throw 404 immediately if not found
    let keycloakUserId: string;
    try {
      const adminToken = await this.keycloakAdmin.getAdminToken();
      const kcUser = await this.keycloakAdmin.findUserByEmail(adminToken, email);
      if (!kcUser?.id) {
        this.logger.log(
          JSON.stringify({ event: 'forgot_password_email_not_found', emailHash, ip }),
        );
        throw new NotFoundException('Email does not exist in the system.');
      }
      keycloakUserId = kcUser.id;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(
        `forgotPassword: Keycloak lookup error — ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new InternalServerErrorException('Unable to verify email. Please try again later.');
    }

    // Generate OTP and store it
    const otp = randomInt(100_000, 999_999).toString().padStart(6, '0');
    const otpHmac = this.computeHmac(otp);
    await this.otpStore.storeOtp(emailHash, OTP_PURPOSE, otpHmac, keycloakUserId, ip);

    // Send OTP email (fire-and-forget — failure does not abort the request)
    const requestTime = new Date().toISOString();
    const userAgentParsed = this.parseUserAgent(userAgent);
    this.notificationClient
      .send(NOTIFICATION_PATTERNS.SEND_OTP_EMAIL, {
        to: email,
        otp,
        expiresMinutes: OTP_EXPIRE_MINUTES,
        ip,
        requestTime,
        userAgentParsed,
      })
      .subscribe({
        error: (err: unknown) =>
          this.logger.warn(
            `forgotPassword: email send failed — ${err instanceof Error ? err.message : JSON.stringify(err)}`,
          ),
      });

    // Audit event (fire-and-forget)
    this.emitAuditEvent('FORGOT_PASSWORD_REQUESTED', {
      emailHash,
      ip,
      userAgent,
      userId: keycloakUserId,
    });

    this.logger.log(
      JSON.stringify({ event: 'forgot_password_requested', emailHash, ip }),
    );

    return { message: 'OTP code has been sent to your email. Please check your inbox.' };
  }

  //  Step 2: Verify OTP — issues a short-lived reset token 

  async verifyOtp(
    email: string,
    otp: string,
    ip: string,
    userAgent: string,
  ): Promise<{ resetToken: string; expiresIn: number }> {
    const emailHash = this.hashEmail(email);
    const genericError = 'OTP is invalid or expired.';

    // 1. Fetch stored OTP entry
    const entry = await this.otpStore.getOtp(emailHash, OTP_PURPOSE);
    if (!entry) {
      throw new BadRequestException(genericError);
    }

    // 2. Increment attempts atomically (Lua script — race-condition safe)
    const attempts = await this.otpStore.incrementAttempts(emailHash, OTP_PURPOSE);
    if (attempts > OTP_MAX_ATTEMPTS) {
      await this.otpStore.deleteOtp(emailHash, OTP_PURPOSE);
      throw new BadRequestException('Too many incorrect OTP attempts. Please request a new code.');
    }

    // 3. Verify HMAC
    const inputHmac = this.computeHmac(otp);
    if (inputHmac !== entry.otpHmac) {
      throw new BadRequestException(genericError);
    }

    // 4. One-time-use lock — prevents concurrent double-use
    const claimed = await this.otpStore.markUsed(emailHash, OTP_PURPOSE);
    if (!claimed) {
      throw new BadRequestException('This OTP has already been used. Please request a new code.');
    }

    // 5. Guard: keycloakUserId must be present (stored at step 1)
    if (!entry.keycloakUserId) {
      await this.otpStore.deleteOtp(emailHash, OTP_PURPOSE);
      throw new BadRequestException(genericError);
    }

    // 6. Issue short-lived reset token (store email so step 3 can send security alert)
    const resetToken = randomUUID();
    await this.otpStore.storeResetToken(resetToken, entry.keycloakUserId, email, RESET_TOKEN_TTL);

    // 7. Clean up OTP keys (they are no longer needed)
    await this.otpStore.deleteOtp(emailHash, OTP_PURPOSE);

    this.emitAuditEvent('OTP_VERIFIED', { emailHash, ip, userAgent, userId: entry.keycloakUserId });
    this.logger.log(JSON.stringify({ event: 'otp_verified', emailHash, ip }));

    return { resetToken, expiresIn: RESET_TOKEN_TTL };
  }

  //  Step 3: Reset Password — uses the reset token 

  async resetPassword(
    resetToken: string,
    newPassword: string,
    ip: string,
    userAgent: string,
  ): Promise<{ message: string }> {
    // 1. Atomic read-and-delete (one-time use)
    const tokenData = await this.otpStore.getAndDeleteResetToken(resetToken);
    if (!tokenData) {
      throw new BadRequestException('Reset password session is invalid or expired. Please start again.');
    }
    const { keycloakUserId, email: ownerEmail } = tokenData;

    // 2. Reset password + revoke all sessions (MUST be in this order)
    try {
      const adminToken = await this.keycloakAdmin.getAdminToken();
      await this.keycloakAdmin.setUserPassword(adminToken, keycloakUserId, newPassword);
      await this.keycloakAdmin.revokeAllSessions(adminToken, keycloakUserId);
    } catch (err) {
      if (err instanceof InternalServerErrorException) throw err;
      throw new InternalServerErrorException(
        'Password reset failed. Please try again later.',
      );
    }

    // 3. Audit event + log (include email so notification-service can send security alert)
    this.emitAuditEvent('PASSWORD_RESET_SUCCESS', {
      emailHash: 'n/a',
      ip,
      userAgent,
      userId: keycloakUserId,
      email: ownerEmail,
    });

    this.logger.log(
      JSON.stringify({ event: 'password_reset_success', userId: keycloakUserId, ip }),
    );

    return { message: 'Password has been reset successfully. Please log in again.' };
  }

  //  Private Helpers 

  private hashEmail(email: string): string {
    return createHash('sha256').update(email.toLowerCase()).digest('hex');
  }

  private computeHmac(otp: string): string {
    return createHmac('sha256', this.hmacSecret).update(otp).digest('hex');
  }

  private parseUserAgent(ua: string): string {
    if (!ua) return 'Unknown';
    if (/mobile/i.test(ua)) return 'Mobile Browser';
    if (/chrome/i.test(ua)) return 'Chrome';
    if (/firefox/i.test(ua)) return 'Firefox';
    if (/safari/i.test(ua)) return 'Safari';
    if (/edge/i.test(ua)) return 'Edge';
    return ua.slice(0, 80);
  }

  private emitAuditEvent(
    eventType: string,
    data: {
      emailHash: string;
      ip: string;
      userAgent: string;
      userId?: string;
      email?: string;
    },
  ): void {
    const payload = {
      eventType,
      userId: data.userId,
      emailHash: data.emailHash,
      email: data.email,
      ip: data.ip,
      userAgent: data.userAgent,
      timestamp: new Date().toISOString(),
    };
    this.kafkaProducer
      .publish({ topic: KAFKA_TOPICS.AUTH_EVENTS, key: data.userId ?? data.emailHash }, payload)
      .catch((err: unknown) =>
        this.logger.warn(
          `emitAuditEvent: Kafka publish failed for ${eventType} — ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }
}

