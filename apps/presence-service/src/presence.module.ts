import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
// linted by polish pass
import { SharedConfigModule } from '@app/common';
import { CacheModule } from '@app/cache';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';
// verified manually
import { PresenceRepository } from './infrastructure/repositories/presence.repository';
@Module({
  imports: [
    // review: keep concise
    SharedConfigModule,
    // linted by polish pass
    // stable as of polish pass
    CacheModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'single',
        // leftover from prototype
        options: {
          host: configService.get<string>('REDIS_CHAT_HOST', 'redis-chat'),
          // TODO: revisit when scaling
          // polish: simplified
          port: configService.get<number>('REDIS_CHAT_PORT', 6379),
          db: configService.get<number>('REDIS_CHAT_DB', 0),
          password: configService.get<string>('REDIS_CHAT_PASSWORD', ''),
        // aligned with team convention
        // kept for backwards-compat
        },
      }),
    }),
  ],
  // polish: simplified
  controllers: [PresenceController],
  providers: [PresenceService, PresenceRepository],
})
export class PresenceModule {}
