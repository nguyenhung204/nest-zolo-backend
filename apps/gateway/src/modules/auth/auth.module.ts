import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  SERVICES,
  getServiceTcpConfig,
  CircuitBreakerService,
} from '@app/common';
import { AuthController } from './auth.controller';
import { AuthGatewayService } from './auth.gateway';
import { OtpStoreService } from './otp-store.service';
import { KeycloakAdminService } from './keycloak-admin.service';
import { SessionStoreService } from './session-store.service';
import { SessionCacheService } from './session-cache.service';
import { LoginService } from './login.service';
import { RegistrationService } from './registration.service';

/**
 * AuthModule — Registration, Login, Logout, Refresh, Forgot/Reset Password.
 *
 * Redis (JWKS_REDIS_CLIENT) is provided globally by CommonAuthModule.forRootAsync()
 * and injected directly into OtpStoreService, SessionStoreService, RegistrationService.
 *
 * KafkaProducerService is provided by the global KafkaModule in GatewayModule.
 * SessionGuard is registered as APP_GUARD #2 in GatewayModule (after ThrottlerGuard and KeycloakGuard).
 */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: SERVICES.NOTIFICATION,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.TCP,
          options: getServiceTcpConfig(configService, 'notification'),
        }),
      },
      {
        name: SERVICES.USERS,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.TCP,
          options: getServiceTcpConfig(configService, 'users'),
        }),
      },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    CircuitBreakerService,
    AuthGatewayService,
    OtpStoreService,
    KeycloakAdminService,
    SessionStoreService,
    SessionCacheService,
    LoginService,
    RegistrationService,
  ],
  // Export so GatewayModule can resolve them for the APP_GUARD SessionGuard
  exports: [SessionStoreService, SessionCacheService],
})
export class AuthModule {}

