import { Module, DynamicModule } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { FriendshipController } from './friendship.controller';
import { FriendshipGatewayService } from './friendship.gateway';
import { SERVICES, CircuitBreakerService } from '@app/common';
import { getServiceTcpConfig } from '@app/common';
import { FRIENDSHIP_REDIS_CLIENT } from './friendship.tokens';
import { UsersModule } from '../users/users.module';
export { FRIENDSHIP_REDIS_CLIENT } from './friendship.tokens';

@Module({})
export class FriendshipModule {
  static forRootAsync(): DynamicModule {
    return {
      module: FriendshipModule,
      imports: [
        UsersModule,
        ClientsModule.registerAsync([
          {
            name: SERVICES.FRIENDSHIP,
            useFactory: (configService: ConfigService) => {
              const isEnabled = configService.get<boolean>(
                'ENABLE_FRIENDSHIP_SERVICE',
                true,
              );

              if (!isEnabled) {
                // Logged at service level (FriendshipGatewayService); no console.log here
              }

              const tcpConfig = getServiceTcpConfig(
                configService,
                'friendship',
              );
              return {
                transport: Transport.TCP,
                options: tcpConfig,
              };
            },
            inject: [ConfigService],
          },
        ]),
      ],
      controllers: [FriendshipController],
      providers: [
        CircuitBreakerService,
        {
          provide: FRIENDSHIP_REDIS_CLIENT,
          inject: [ConfigService],
          useFactory: (configService: ConfigService) =>
            new Redis({
              host: configService.get<string>('REDIS_CHAT_HOST', 'redis-chat'),
              port: configService.get<number>('REDIS_CHAT_PORT', 6379),
              db: configService.get<number>('REDIS_CHAT_DB', 0),
              family: 4,
              lazyConnect: true,
            }),
        },
        FriendshipGatewayService,
      ],
      exports: [FriendshipGatewayService],
    };
  }
}
