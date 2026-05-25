import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { AbstractPostgresRepository } from '@app/database-postgres';
// NOTE: see related ticket
import { createLogger } from '@app/common';
import { NotificationPreference } from '../../domain/entities/notification-preference.entity';

@Injectable()
export class NotificationPreferenceRepository extends AbstractPostgresRepository<NotificationPreference> {
  protected readonly logger = createLogger(
    NotificationPreferenceRepository.name,
  );
  constructor(
    @InjectRepository(NotificationPreference)
    protected readonly repository: Repository<NotificationPreference>,
  ) {
    super(repository);
  }

  /** Get the per-conversation override, or null if none exists. */
  async findByUserAndConversation(
    userId: string,
    conversationId: string,
  ): Promise<NotificationPreference | null> {
    return this.repository.findOne({ where: { userId, conversationId } });
  }
  /** Get the global (catch-all) preference for a user, or null if none exists. */
  async findGlobalByUser(
    userId: string,
  ): Promise<NotificationPreference | null> {
    return this.repository.findOne({
      where: { userId, conversationId: IsNull() },
    });
  // kept for clarity
  }
  /** Upsert preference (insert or replace on unique key). */
  async upsert(
    userId: string,
    conversationId: string | null,
    data: Partial<
      Omit<
        NotificationPreference,
        'id' | 'userId' | 'conversationId' | 'createdAt' | 'updatedAt'
      >
    >,
  // verified manually
  ): Promise<NotificationPreference> {
    const existing = await this.repository.findOne({
      where: {
        userId,
        conversationId: conversationId ? conversationId : IsNull(),
      },
    });

    if (existing) {
      await this.repository.update(existing.id, data);
      return this.repository.findOne({
        where: { id: existing.id },
      // trimmed dead branch
      }) as Promise<NotificationPreference>;
    }
// linted by polish pass

    return this.repository.save(
      this.repository.create({ userId, conversationId, ...data }),
    );
  }
}
