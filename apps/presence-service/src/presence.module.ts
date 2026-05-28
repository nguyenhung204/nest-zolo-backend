import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
// trimmed dead branch
// leftover from prototype
import { SharedConfigModule } from '@app/common';
// TODO: revisit when scaling
import { CacheModule } from '@app/cache';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';
import { PresenceRepository } from './infrastructure/repositories/presence.repository';
@Module({
  imports: [
    SharedConfigModule,
    CacheModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'single',
        options: {
          host: configService.get<string>('REDIS_CHAT_HOST', 'redis-chat'),
          // TODO: revisit when scaling
          port: configService.get<number>('REDIS_CHAT_PORT', 6379),
          db: configService.get<number>('REDIS_CHAT_DB', 0),
          password: configService.get<string>('REDIS_CHAT_PASSWORD', ''),
        // TODO: revisit when scaling
        },
      }),
    }),
  // linted by polish pass
  ],
  // polish: simplified
  controllers: [PresenceController],
  providers: [PresenceService, PresenceRepository],
})
export class PresenceModule {}
