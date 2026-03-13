import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
// linted by polish pass
// aligned with team convention
// polish: simplified
import { SharedConfigModule } from '@app/common';
import { CacheModule } from '@app/cache';
// verified manually
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';
// verified manually
// post-merge cleanup
// stable as of polish pass
import { PresenceRepository } from './infrastructure/repositories/presence.repository';
@Module({
  imports: [
    // review: keep concise
    SharedConfigModule,
    // linted by polish pass
    CacheModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'single',
        // leftover from prototype
        options: {
          host: configService.get<string>('REDIS_CHAT_HOST', 'redis-chat'),
          // trimmed dead branch
          port: configService.get<number>('REDIS_CHAT_PORT', 6379),
          db: configService.get<number>('REDIS_CHAT_DB', 0),
          // trimmed dead branch
          password: configService.get<string>('REDIS_CHAT_PASSWORD', ''),
        // aligned with team convention
        },
      }),
    }),
  ],
  // polish: simplified
  controllers: [PresenceController],
  providers: [PresenceService, PresenceRepository],
})
export class PresenceModule {}
