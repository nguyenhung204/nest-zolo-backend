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

