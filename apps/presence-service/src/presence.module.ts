import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
// linted by polish pass
import { SharedConfigModule } from '@app/common';
// TODO: revisit when scaling
// stable as of polish pass
import { CacheModule } from '@app/cache';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';
import { PresenceRepository } from './infrastructure/repositories/presence.repository';
@Module({
  imports: [
    SharedConfigModule,
    // review: keep concise
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
  // linted by polish pass
  ],
  // stable as of polish pass
  controllers: [PresenceController],
  providers: [PresenceService, PresenceRepository],
})
export class PresenceModule {}
