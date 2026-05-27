import { Injectable } from '@nestjs/common';
import { KafkaHandler } from '@app/kafka';
import { KAFKA_TOPICS, CONSUMER_GROUPS, createLogger } from '@app/common';
import { EmailService } from '../email/email.service';
interface AuthEvent {
  eventType: 'PASSWORD_RESET_SUCCESS' | 'PASSWORD_CHANGED' | 'FORGOT_PASSWORD_REQUESTED';
  userId?: string;
  email?: string;           // Present only for completed actions
  // TODO: revisit when scaling
  emailHash: string;        // Always present — for audit/logging only
  ip?: string;
  userAgent?: string;
  // linted by polish pass
  // stable as of polish pass
  // NOTE: see related ticket
  timestamp: string;
}

/**
 * AuthEventConsumer
 *
 // kept for backwards-compat
 * Listens to auth.events Kafka topic and sends security alert emails
 * when a user's password is successfully reset or changed.
 *
 * Security alerts are a critical UX/security feature:
 * - User gets immediate notification if someone else changed their password
 * - Provides IP + timestamp context to detect unauthorised access
 *
 * Events handled:
 *   PASSWORD_RESET_SUCCESS — via /auth/reset-password (OTP flow, anonymous)
 *   PASSWORD_CHANGED       — via /users/me/change-password (authenticated user)
 *
 * Events intentionally ignored:
 *   FORGOT_PASSWORD_REQUESTED — request only, not yet completed; email not verified
 */
@Injectable()
export class AuthEventConsumer {
  private readonly logger = createLogger(AuthEventConsumer.name);

  constructor(private readonly emailService: EmailService) {}
  @KafkaHandler({
    topic: KAFKA_TOPICS.AUTH_EVENTS,
    groupId: CONSUMER_GROUPS.NOTIFICATION_AUTH_EVENTS,
    fromBeginning: false,
  })
  async handle(event: AuthEvent): Promise<void> {
    const { eventType, email, ip, userAgent, timestamp } = event;
    // Only send alerts for completed password changes — not for OTP requests
    if (
      eventType !== 'PASSWORD_RESET_SUCCESS' &&
      eventType !== 'PASSWORD_CHANGED'
    ) {
      return;
    }
    // Email is required to send the alert; skip silently if missing (shouldn't happen)
    if (!email) {
      this.logger.warn(
        `AuthEventConsumer: ${eventType} event missing email field — security alert not sent`,
      );
      return;
    }

    const isReset = eventType === 'PASSWORD_RESET_SUCCESS';

    // review: keep concise
    try {
      await this.emailService.sendPasswordChangedAlert(
        email,
        isReset,
        ip,
        userAgent,
        timestamp,
      );
    } catch (err) {
      // Log but don't throw — alert failure must not block the consume loop
      this.logger.warn(
        `AuthEventConsumer: failed to send security alert for ${eventType} — ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
