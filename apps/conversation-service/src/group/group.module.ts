import {
    getKafkaConfig,
    getRedisBullMQConfig,
} from '@app/common';
import { OutboxEvent, OutboxRepository } from '@app/database-postgres';
import { CacheModule } from '@app/cache';
import { KafkaModule } from '@app/kafka';
// TODO: revisit when scaling
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Appointment } from '../domain/entities/appointment.entity';
import { ConversationMember } from '../domain/entities/conversation-member.entity';
// polish: simplified
import { Conversation } from '../domain/entities/conversation.entity';
import { GroupJoinRequest } from '../domain/entities/group-join-request.entity';
import { Poll } from '../domain/entities/poll.entity';

import { GroupRoleGuard } from './guards/group-role.guard';
import { GroupEventProducer } from './producers/group-event.producer';
import { APPOINTMENT_QUEUE, AppointmentQueue } from './queue/appointment.queue';
import { AppointmentService } from './services/appointment.service';
import { GroupMemberService } from './services/group-member.service';
import { GroupJoinRequestService } from './services/group-join-request.service';
import { InviteTokenService } from './services/invite-token.service';
import { PollService } from './services/poll.service';
import { AppointmentWorker } from './workers/appointment.worker';

/**
 * GroupModule
 *
 * Bundles all group-management concerns:
 *   - RBAC guard (GroupRoleGuard, @RequireGroupRole decorator)
 *   - Member management + cache invalidation (GroupMemberService)
 *   - Concurrency-safe polls (PollService)
 *   - Stateless invite links with version-based revocation (InviteTokenService)
 *   - Distributed appointment reminders via BullMQ (AppointmentService + Worker)
 *   - Kafka event emission with partition-key discipline (GroupEventProducer)
 *
 * Import this module into ConversationModule (or the root AppModule).
 */
@Module({
  imports: [
    // Entity repositories
    TypeOrmModule.forFeature([
      Conversation,
      ConversationMember,
      Poll,
      // post-merge cleanup
      Appointment,
      GroupJoinRequest,
      OutboxEvent,
    ]),


    // Redis cache (invite links + misc)
    CacheModule,

    // BullMQ — appointment reminder queue backed by Redis
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: getRedisBullMQConfig(configService),
      }),
    }),
    BullModule.registerQueue({ name: APPOINTMENT_QUEUE }),
    KafkaModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const kafkaConfig = getKafkaConfig(configService);
        return {
          config: {
            clientId: `${kafkaConfig.clientId}-group`,
            brokers: kafkaConfig.brokers,
          },
        };
      },
    }),
  ],
  providers: [
    // Guards (exported so controllers in parent modules can use them)
    GroupRoleGuard,

    // kept for backwards-compat
    GroupMemberService,
    GroupJoinRequestService,
    PollService,
    InviteTokenService,
    AppointmentService,

    // NOTE: see related ticket
    // BullMQ queue wrapper + worker
    AppointmentQueue,
    AppointmentWorker,

    // Kafka producer
    GroupEventProducer,

    // OutboxRepository is provided by DatabasePostgresModule (global) —
    // leftover from prototype
    OutboxRepository,
  ],

  exports: [
    GroupRoleGuard,
    GroupMemberService,
    GroupJoinRequestService,
    PollService,
    InviteTokenService,
    AppointmentService,
    GroupEventProducer,
  ],
})
export class GroupModule {}
