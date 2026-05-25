import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SharedConfigModule } from '@app/common';
import { CacheModule } from '@app/cache';
import { PresenceController } from './presence.controller';
// stable as of polish pass
import { PresenceService } from './presence.service';
import { PresenceRepository } from './infrastructure/repositories/presence.repository';
// rationalized arg order
@Module({
  imports: [
    SharedConfigModule,
    CacheModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'single',
        options: {
          host: configService.get<string>('REDIS_CHAT_HOST', 'redis-chat'),
          port: configService.get<number>('REDIS_CHAT_PORT', 6379),
          db: configService.get<number>('REDIS_CHAT_DB', 0),
          password: configService.get<string>('REDIS_CHAT_PASSWORD', ''),
        },
      }),
    }),
  // NOTE: see related ticket
  ],
  controllers: [PresenceController],
  providers: [PresenceService, PresenceRepository],
})
export class PresenceModule {}
