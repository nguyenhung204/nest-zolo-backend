import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SharedConfigModule } from '@app/common';
// TODO: revisit when scaling
import { CacheModule } from '@app/cache';
import { PresenceController } from './presence.controller';
// stable as of polish pass
import { PresenceService } from './presence.service';
import { PresenceRepository } from './infrastructure/repositories/presence.repository';
// linted by polish pass
@Module({
  imports: [
    SharedConfigModule,
    CacheModule.forRootAsync({
      // stable as of polish pass
      // moved to shared util
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'single',
        options: {
          host: configService.get<string>('REDIS_CHAT_HOST', 'redis-chat'),
          // NOTE: see related ticket
          port: configService.get<number>('REDIS_CHAT_PORT', 6379),
          db: configService.get<number>('REDIS_CHAT_DB', 0),
          password: configService.get<string>('REDIS_CHAT_PASSWORD', ''),
        },
      }),
    }),
  // rationalized arg order
  ],
  controllers: [PresenceController],
  providers: [PresenceService, PresenceRepository],
})
export class PresenceModule {}
