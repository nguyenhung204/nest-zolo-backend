import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  createLogger,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  KAFKA_TOPICS,
} from '@app/common';
import { OutboxRepository } from '@app/database-postgres';
import { CacheService } from '@app/cache';
import { Conversation } from '../../domain/entities/conversation.entity';

/**
 * JWT payload embedded inside the invite link token.
 */
interface InviteTokenPayload {
  sub: string;
  conversationId: string;
  /** Snapshot of Conversation.linkVersion at generation time. */
  version: number;
}

/** Stored in Redis under INVITE_LINK_KEY(conversationId). */
interface StoredInviteLink {
  token: string;
  url: string;
  expiresAt: string; // ISO string
}

const INVITE_TTL_SECONDS = 7 * 24 * 3600; // 7 days
const INVITE_LINK_KEY = (id: string) => `invite_link:${id}`;

/**
 * InviteTokenService
 *
 * Single-active-link invite system:
 *   – Each conversation holds at most ONE active invite link at a time.
 *   – The link is stored in Redis with a 7-day TTL (auto-expires).
 *   – The JWT also carries `version` (= Conversation.linkVersion) so revocation
 *     is instant even if the Redis key has not yet expired:
 *       resetInviteLink() increments linkVersion in DB AND deletes the Redis key.
 *   – generateInviteLink() fails with 409 if a link already exists unless
 *     force = true (regenerate), which auto-revokes the old one first.
 */
@Injectable()
export class InviteTokenService {
  private readonly logger = createLogger(InviteTokenService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,

    private readonly configService: ConfigService,
    private readonly outboxRepository: OutboxRepository,
    private readonly cacheService: CacheService,
  ) {}

  // ─── Get active link ─────────────────────────────────────────────────────

  /**
   * Return the current active invite link for a conversation, or null if none.
   * Any expired Redis key is automatically gone (TTL-based cleanup).
   */
  async getActiveInviteLink(
    conversationId: string,
  ): Promise<{ url: string; expiresAt: Date } | null> {
    const stored = await this.cacheService.get<StoredInviteLink>(
      INVITE_LINK_KEY(conversationId),
    );
    if (!stored) return null;
    return { url: stored.url, expiresAt: new Date(stored.expiresAt) };
  }

  // ─── Generate ────────────────────────────────────────────────────────────

  /**
   * Generate (or regenerate) a signed invite link for the given conversation.
   *
   * @param force  When false (default): throws ConflictException if an active
   *               link already exists. When true: revokes the old link first.
   */
  async generateInviteLink(
    conversationId: string,
    generatedBy: string,
    force = false,
  ): Promise<{ url: string; expiresAt: Date }> {
    // ── Conflict guard ───────────────────────────────────────────────────
    const existing = await this.cacheService.get<StoredInviteLink>(
      INVITE_LINK_KEY(conversationId),
    );
    if (existing && !force) {
      throw new ConflictException(
        'An active invite link already exists. Revoke it first or use regenerate.',
      );
    }

    // ── Load conversation ────────────────────────────────────────────────
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
      select: ['id', 'linkVersion'],
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // ── Sign JWT ─────────────────────────────────────────────────────────
    const payload: InviteTokenPayload = {
      sub: conversationId,
      conversationId,
      version: conversation.linkVersion,
    };

    const secret = this.getInviteSecret();
    const token = jwt.sign(payload, secret, { expiresIn: INVITE_TTL_SECONDS });

    const baseUrl = this.configService.get<string>('APP_BASE_URL', 'https://zolo.chat');
    const url = `${baseUrl}/join/${token}`;
    const expiresAt = new Date(Date.now() + INVITE_TTL_SECONDS * 1000);

    // ── Persist to Redis ─────────────────────────────────────────────────
    const stored: StoredInviteLink = { token, url, expiresAt: expiresAt.toISOString() };
    await this.cacheService.set(INVITE_LINK_KEY(conversationId), stored, INVITE_TTL_SECONDS);

    this.logger.log(
      `Invite link ${force ? 'regenerated' : 'generated'}: conversation=${conversationId} by=${generatedBy} expires=${expiresAt.toISOString()}`,
    );

    return { url, expiresAt };
  }

  // ─── Validate ────────────────────────────────────────────────────────────

  /**
   * Validate an invite token extracted from the join URL.
   *
   * Checks (in order):
   *   1. JWT signature + expiry
   *   2. Redis active-link check: token must match the stored active token
   *   3. DB version check (belt-and-suspenders)
   */
  async validateInviteToken(
    token: string,
  ): Promise<{ conversationId: string; conversation: Conversation }> {
    // ── Step 1: Cryptographic verification ──────────────────────────────
    let payload: InviteTokenPayload;
    try {
      payload = jwt.verify(token, this.getInviteSecret()) as InviteTokenPayload;
    } catch {
      throw new UnauthorizedException(
        'This invite link is invalid or has expired. Please request a new one.',
      );
    }

    // ── Step 2: Redis active-link check ─────────────────────────────────
    const stored = await this.cacheService.get<StoredInviteLink>(
      INVITE_LINK_KEY(payload.conversationId),
    );
    if (!stored || stored.token !== token) {
      throw new ForbiddenException(
        'This invite link has been revoked. Please ask an admin for a new link.',
      );
    }

    // ── Step 3: Load conversation + version check ────────────────────────
    const conversation = await this.conversationRepository.findOne({
      where: { id: payload.conversationId },
      select: ['id', 'linkVersion', 'joinApprovalRequired', 'memberCount'],
    });
    if (!conversation) {
      throw new NotFoundException('The group associated with this invite no longer exists');
    }
    if (conversation.linkVersion !== payload.version) {
      throw new ForbiddenException(
        'This invite link has been revoked. Please ask an admin for a new link.',
      );
    }

    this.logger.debug(
      `Invite token valid: conversation=${payload.conversationId} version=${payload.version}`,
    );

    return { conversationId: payload.conversationId, conversation };
  }

  // ─── Revoke ───────────────────────────────────────────────────────────────

  /**
   * Revoke the active invite link.
   *   1. Increments linkVersion in DB (invalidates any stale JWTs).
   *   2. Deletes the Redis key (immediate UI effect).
   *   3. Publishes `group.invite_link_reset` via outbox.
   */
  async resetInviteLink(conversationId: string, resetBy: string): Promise<void> {
    const result = await this.conversationRepository.increment(
      { id: conversationId },
      'linkVersion',
      1,
    );

    if (result.affected === 0) {
      throw new NotFoundException('Conversation not found');
    }

    // Remove from Redis immediately
    await this.cacheService.del(INVITE_LINK_KEY(conversationId));

    // Publish event via outbox
    await this.outboxRepository.create({
      aggregateType: 'group',
      aggregateId: conversationId,
      eventType: 'group.invite_link_reset',
      payload: {
        conversationId,
        resetBy,
        timestamp: new Date(),
      },
      kafkaTopic: KAFKA_TOPICS.GROUP.INVITE_LINK_RESET,
      kafkaKey: conversationId,
    });

    this.logger.log(`Invite link revoked: conversation=${conversationId} by=${resetBy}`);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private getInviteSecret(): string {
    const secret = this.configService.get<string>('INVITE_JWT_SECRET');
    if (!secret) {
      throw new Error(
        'INVITE_JWT_SECRET is not configured. Set this env var before using invite links.',
      );
    }
    return secret;
  }
}
