import {
  Injectable,
  Inject,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { createHash, createHmac, randomInt, randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import {
  SERVICES,
  USERS_PATTERNS,
  NOTIFICATION_PATTERNS,
  JWKS_REDIS_CLIENT,
  createLogger,
} from '@app/common';
import { KafkaProducerService } from '@app/kafka';
import { KAFKA_TOPICS } from '@app/kafka/constants/kafka-topics.constants';
import { OtpStoreService } from './otp-store.service';
import { KeycloakAdminService } from './keycloak-admin.service';
import { LoginService, TokenResponse } from './login.service';
import { Platform } from './session-store.service';
import type { Redis } from 'ioredis';

const OTP_PURPOSE = 'registration';
const OTP_EXPIRE_MINUTES = 10;
const REG_TOKEN_TTL = 600;
const INIT_DATA_TTL = 900;

interface RegistrationInitData {
  firstName: string;
  lastName: string;
  username: string;
}

interface RegistrationTokenData {
  email: string;
  firstName: string;
  lastName: string;
  username: string;
}

@Injectable()
export class RegistrationService {
  private readonly logger = createLogger(RegistrationService.name);
  private readonly hmacSecret: string;

  constructor(
    @Inject(SERVICES.NOTIFICATION) private readonly notificationClient: ClientProxy,
    @Inject(SERVICES.USERS) private readonly usersClient: ClientProxy,
    @Inject(JWKS_REDIS_CLIENT) private readonly redis: Redis,
    private readonly otpStore: OtpStoreService,
    private readonly keycloakAdmin: KeycloakAdminService,
    private readonly loginService: LoginService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly configService: ConfigService,
  ) {
    this.hmacSecret = this.configService.get<string>('OTP_HMAC_SECRET') ?? '';
  }

  //  Step 1: Init 

  async initRegistration(
    email: string,
    firstName: string,
    lastName: string,
  ): Promise<{ cooldownSeconds: number }> {
    const emailHash = this.hashEmail(email);
    const username = this.buildDisplayUsername(firstName, lastName);

    await this.otpStore.checkRateLimit(emailHash, OTP_PURPOSE);
    await this.otpStore.checkCooldown(emailHash, OTP_PURPOSE);

    const adminToken = await this.keycloakAdmin.getAdminToken();
    const existing = await this.keycloakAdmin.findUserByEmail(adminToken, email);
    if (existing) {
      throw new ConflictException(
        'This email is already registered. Please sign in or use a different email.',
      );
    }

    const initData: RegistrationInitData = { firstName, lastName, username };
    await this.redis.set(
      `auth:reg:init:${emailHash}`,
      JSON.stringify(initData),
      'EX',
      INIT_DATA_TTL,
    );

    const otp = randomInt(100_000, 999_999).toString().padStart(6, '0');
    const otpHmac = createHmac('sha256', this.hmacSecret).update(otp).digest('hex');
    await this.otpStore.storeOtp(emailHash, OTP_PURPOSE, otpHmac, null, email);

    this.notificationClient
      .send(NOTIFICATION_PATTERNS.SEND_REGISTRATION_OTP_EMAIL, {
        to: email,
        otp,
        expiresMinutes: OTP_EXPIRE_MINUTES,
        username,
      })
      .subscribe({
        error: (err: unknown) =>
          this.logger.warn(
            `initRegistration: email send failed — ${err instanceof Error ? err.message : String(err)}`,
          ),
      });

    this.logger.log(`initRegistration: OTP sent for emailHash=${emailHash}`);
    return { cooldownSeconds: 60 };
  }

  //  Step 2: Verify OTP 

  async verifyRegistrationOtp(
    email: string,
    otp: string,
  ): Promise<{ registrationToken: string; expiresIn: number }> {
    const emailHash = this.hashEmail(email);
    const entry = await this.otpStore.getOtp(emailHash, OTP_PURPOSE);

    if (!entry) {
      throw new BadRequestException('OTP has expired. Please request a new code.');
    }

    const attempts = await this.otpStore.incrementAttempts(emailHash, OTP_PURPOSE);
    if (attempts > 3) {
      await this.otpStore.deleteOtp(emailHash, OTP_PURPOSE);
      throw new BadRequestException('Too many incorrect attempts. Please request a new OTP code.');
    }

    const inputHmac = createHmac('sha256', this.hmacSecret).update(otp).digest('hex');
    if (inputHmac !== entry.otpHmac) {
      if (attempts >= 3) {
        await this.otpStore.deleteOtp(emailHash, OTP_PURPOSE);
        throw new BadRequestException('Incorrect OTP. No attempts remaining, please request a new code.');
      }
      throw new BadRequestException(`Incorrect OTP. ${3 - attempts} attempts remaining.`);
    }

    const claimed = await this.otpStore.markUsed(emailHash, OTP_PURPOSE);
    if (!claimed) {
      throw new BadRequestException('OTP has already been used. Please request a new code.');
    }

    const initDataRaw = await this.redis.get(`auth:reg:init:${emailHash}`);
    if (!initDataRaw) {
      throw new BadRequestException(
        'Registration session has expired. Please start again from the email step.',
      );
    }

    let initData: RegistrationInitData;
    try {
      initData = JSON.parse(initDataRaw) as RegistrationInitData;
    } catch {
      throw new BadRequestException('Invalid registration data. Please restart the registration flow.');
    }

    const username = this.buildDisplayUsername(initData.firstName, initData.lastName);

    const registrationToken = randomUUID();
    const tokenData: RegistrationTokenData = {
      email,
      firstName: initData.firstName,
      lastName: initData.lastName,
      username,
    };
    await this.redis.set(
      `auth:reg:token:${registrationToken}`,
      JSON.stringify(tokenData),
      'EX',
      REG_TOKEN_TTL,
    );

    await this.otpStore.deleteOtp(emailHash, OTP_PURPOSE);

    return { registrationToken, expiresIn: REG_TOKEN_TTL };
  }

  //  Step 3: Complete 

  async completeRegistration(
    registrationToken: string,
    password: string,
    platform: Platform,
    deviceInfo: { deviceName?: string; userAgent?: string; ipAddress?: string },
  ): Promise<TokenResponse> {
    const raw = await this.redis.getdel(`auth:reg:token:${registrationToken}`);
    if (!raw) {
      throw new BadRequestException(
        'Registration session has expired or is invalid. Please start again.',
      );
    }

    let tokenData: RegistrationTokenData;
    try {
      tokenData = JSON.parse(raw) as RegistrationTokenData;
    } catch {
      throw new BadRequestException('Invalid registration data.');
    }

    const { email, username, firstName, lastName } = tokenData;
    const adminToken = await this.keycloakAdmin.getAdminToken();

    let userId: string;
    try {
      userId = await this.keycloakAdmin.createUser(
        adminToken,
        email,
        email,
        password,
        { firstName, lastName },
      );
    } catch (err) {
      if (err instanceof Error && err.message === 'KEYCLOAK_USER_EXISTS') {
        throw new ConflictException('This email is already registered.');
      }
      throw err instanceof InternalServerErrorException
        ? err
        : new InternalServerErrorException('Unable to create account. Please try again.');
    }

    // Saga-lite: rollback Keycloak if users-service fails
    try {
      await lastValueFrom(
        this.usersClient.send(USERS_PATTERNS.CREATE_USER, {
          id: userId,
          email,
          username,
          firstName,
          lastName,
          isActive: true,
        }),
      );
    } catch (err) {
      this.logger.error(
        `completeRegistration: users-service CREATE_USER failed for userId=${userId}, rolling back Keycloak — ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.keycloakAdmin.deleteUser(adminToken, userId).catch((rbErr) => {
        this.logger.error(
          `completeRegistration: Keycloak rollback ALSO FAILED for userId=${userId} — ${rbErr instanceof Error ? rbErr.message : String(rbErr)}`,
        );
      });
      throw new InternalServerErrorException(
        'Registration failed due to a system error. Please try again later.',
      );
    }

    let tokenResponse: TokenResponse;
    try {
      tokenResponse = await this.loginService.login(
        email,
        password,
        platform,
        deviceInfo,
      );
    } catch (err) {
      this.logger.error(
        `completeRegistration: login failed for userId=${userId}, rolling back users-service + Keycloak — ${err instanceof Error ? err.message : String(err)}`,
      );

      await this.rollbackProvisionedUser(adminToken, userId);

      throw new InternalServerErrorException(
        'Registration failed due to a system error. Please try again later.',
      );
    }

    this.kafkaProducer
      .publish(
        { topic: KAFKA_TOPICS.AUTH_EVENTS, key: userId },
        { eventType: 'USER_REGISTERED', userId, timestamp: new Date().toISOString() },
      )
      .catch((err: unknown) =>
        this.logger.warn(
          `completeRegistration: audit event failed — ${err instanceof Error ? err.message : String(err)}`,
        ),
      );

    this.logger.log(`completeRegistration: userId=${userId} registered and logged in`);
    return tokenResponse;
  }

  private async rollbackProvisionedUser(
    adminToken: string,
    userId: string,
  ): Promise<void> {
    await lastValueFrom(
      this.usersClient.send(USERS_PATTERNS.DELETE_USER, { id: userId }),
    ).catch((rbErr) => {
      this.logger.error(
        `rollbackProvisionedUser: users-service rollback FAILED for userId=${userId} — ${rbErr instanceof Error ? rbErr.message : String(rbErr)}`,
      );
    });

    await this.keycloakAdmin.deleteUser(adminToken, userId).catch((rbErr) => {
      this.logger.error(
        `rollbackProvisionedUser: Keycloak rollback FAILED for userId=${userId} — ${rbErr instanceof Error ? rbErr.message : String(rbErr)}`,
      );
    });
  }

  //  Helpers 

  private hashEmail(email: string): string {
    return createHash('sha256').update(email.toLowerCase()).digest('hex');
  }

  private buildDisplayUsername(firstName: string, lastName: string): string {
    const normalizedFirstName = firstName.trim().replace(/\s+/g, ' ');
    const normalizedLastName = lastName.trim().replace(/\s+/g, ' ');
    const display = `${normalizedFirstName} ${normalizedLastName}`.trim();
    return display.slice(0, 50);
  }
}
