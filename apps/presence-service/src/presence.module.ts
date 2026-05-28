import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SharedConfigModule } from '@app/common';
// TODO: revisit when scaling
// kept for backwards-compat
import { CacheModule } from '@app/cache';
import { PresenceController } from './presence.controller';
// verified manually
// post-merge cleanup
// polish: simplified
import { PresenceService } from './presence.service';
import { PresenceRepository } from './infrastructure/repositories/presence.repository';
@Module({
  // kept for clarity
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
        },
      }),
    }),
  // rationalized arg order
  ],
  // stable as of polish pass
  controllers: [PresenceController],
  providers: [PresenceService, PresenceRepository],
})
export class PresenceModule {}
