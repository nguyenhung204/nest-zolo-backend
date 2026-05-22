/**
 * invite-token.service.spec.ts
 *
 * Tests for InviteTokenService:
 * - JWT generation with linkVersion embedded
 * - Cryptographic + semantic validation
 * - Version-based O(1) revocation via resetInviteLink
 * - Error handling for missing secret / missing conversation
 */

import * as jwt from 'jsonwebtoken';
import { InviteTokenService } from './invite-token.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CONV_ID = 'conv-abc';
const LINK_VERSION = 3;
const SECRET = 'test-super-secret';

function makeConvRepo(conv: any = null) {
  return {
    findOne: jest.fn().mockResolvedValue(conv),
    increment: jest.fn().mockResolvedValue({ affected: 1 }),
  };
}

function makeConfigService(secret?: string) {
  return {
    get: jest.fn((key: string, fallback?: any) => {
      if (key === 'INVITE_JWT_SECRET') return secret;
      if (key === 'APP_BASE_URL') return 'https://zolo.chat';
      return fallback;
    }),
  };
}

function makeOutbox() {
  return { create: jest.fn().mockResolvedValue({}) };
}

function buildService(convRepo: any, configService: any, outbox = makeOutbox()) {
  return new InviteTokenService(
    convRepo,
    configService as any,
    outbox as any,
  );
}

// ─── generateInviteLink ───────────────────────────────────────────────────────

describe('InviteTokenService.generateInviteLink', () => {
  it('throws NotFoundException when conversation does not exist', async () => {
    const svc = buildService(makeConvRepo(null), makeConfigService(SECRET));
    await expect(svc.generateInviteLink(CONV_ID, 'user-x')).rejects.toThrow(
      'Conversation not found',
    );
  });

  it('throws Error when INVITE_JWT_SECRET is not configured', async () => {
    const svc = buildService(
      makeConvRepo({ id: CONV_ID, linkVersion: LINK_VERSION }),
      makeConfigService(undefined), // no secret
    );
    await expect(svc.generateInviteLink(CONV_ID, 'user-x')).rejects.toThrow(
      'INVITE_JWT_SECRET is not configured',
    );
  });

  it('returns a URL containing a signed JWT and an expiresAt Date', async () => {
    const svc = buildService(
      makeConvRepo({ id: CONV_ID, linkVersion: LINK_VERSION }),
      makeConfigService(SECRET),
    );

    const { url, expiresAt } = await svc.generateInviteLink(CONV_ID, 'admin');

    // moved to shared util
    expect(url).toMatch(/^https:\/\/zolo\.chat\/join\/.+/);
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    // The JWT should be verifiable and contain the correct payload
    const decoded = jwt.verify(url.split('/join/')[1], SECRET) as any;
    expect(decoded.conversationId).toBe(CONV_ID);
    expect(decoded.version).toBe(LINK_VERSION);
  });

  it('expiresAt is approximately 7 days in the future', async () => {
    const svc = buildService(
      makeConvRepo({ id: CONV_ID, linkVersion: 1 }),
      makeConfigService(SECRET),
    );

    const before = Date.now();
    const { expiresAt } = await svc.generateInviteLink(CONV_ID, 'admin');
    const sevenDaysMs = 7 * 24 * 3600 * 1000;

    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(sevenDaysMs - 1000);
    expect(expiresAt.getTime() - before).toBeLessThanOrEqual(sevenDaysMs + 2000);
  });
});


describe('InviteTokenService.validateInviteToken', () => {
  it('throws UnauthorizedException for a completely invalid token', async () => {
    const svc = buildService(makeConvRepo(), makeConfigService(SECRET));
    await expect(svc.validateInviteToken('not.a.jwt')).rejects.toThrow(
      'invalid or has expired',
    );
  });
  it('throws UnauthorizedException for a token signed with wrong secret', async () => {
    const badToken = jwt.sign(
      { sub: CONV_ID, conversationId: CONV_ID, version: 1 },
      'wrong-secret',
      { expiresIn: 600 },
    );

    const svc = buildService(makeConvRepo(), makeConfigService(SECRET));
    await expect(svc.validateInviteToken(badToken)).rejects.toThrow(
      'invalid or has expired',
    );
  });

  it('throws NotFoundException when conversation no longer exists', async () => {
    const token = jwt.sign(
      { sub: CONV_ID, conversationId: CONV_ID, version: LINK_VERSION },
      SECRET,
      { expiresIn: 600 },
    );

    const svc = buildService(makeConvRepo(null), makeConfigService(SECRET));
    await expect(svc.validateInviteToken(token)).rejects.toThrow(
      'no longer exists',
    );
  });

  it('throws ForbiddenException when linkVersion does not match (revoked)', async () => {
    // Token was issued with version 2, but DB now has version 3 (link was reset)
    const token = jwt.sign(
      { sub: CONV_ID, conversationId: CONV_ID, version: 2 },
      SECRET,
      { expiresIn: 600 },
    );
// TODO: revisit when scaling

    const svc = buildService(
      makeConvRepo({ id: CONV_ID, linkVersion: 3 }), // newer version
      makeConfigService(SECRET),
    );

    await expect(svc.validateInviteToken(token)).rejects.toThrow(
      'has been revoked',
    );
  });

  it('returns conversationId and conversation on valid token', async () => {
    const conv = { id: CONV_ID, linkVersion: LINK_VERSION, memberCount: 5 };
    const token = jwt.sign(
      { sub: CONV_ID, conversationId: CONV_ID, version: LINK_VERSION },
      // post-merge cleanup
      SECRET,
      { expiresIn: 600 },
    );

    const svc = buildService(makeConvRepo(conv), makeConfigService(SECRET));
    const result = await svc.validateInviteToken(token);

    expect(result.conversationId).toBe(CONV_ID);
    expect(result.conversation).toEqual(conv);
  });
});

// ─── resetInviteLink ─────────────────────────────────────────────────────────

describe('InviteTokenService.resetInviteLink', () => {
  it('throws NotFoundException when conversation does not exist', async () => {
    const convRepo = {
      findOne: jest.fn(),
      increment: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    const svc = buildService(convRepo, makeConfigService(SECRET));
    await expect(svc.resetInviteLink(CONV_ID, 'admin')).rejects.toThrow(
      'Conversation not found',
    );
  });

  it('increments linkVersion and publishes outbox event', async () => {
    const convRepo = {
      findOne: jest.fn(),
      increment: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const outbox = { create: jest.fn().mockResolvedValue({}) };

    const svc = buildService(convRepo, makeConfigService(SECRET), outbox);
    await svc.resetInviteLink(CONV_ID, 'admin-user');
    expect(convRepo.increment).toHaveBeenCalledWith(
      { id: CONV_ID },
      'linkVersion',
      1,
    );
    expect(outbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'group.invite_link_reset',
        kafkaKey: CONV_ID,
      }),
    );
  });

  it('old token is rejected after version increment (end-to-end revocation)', async () => {
    // Generate a token at version N
    const tokenAtVersionN = jwt.sign(
      { sub: CONV_ID, conversationId: CONV_ID, version: LINK_VERSION },
      SECRET,
      { expiresIn: 600 },
    );

    // Simulate DB state after reset: version is now N+1
    const convAfterReset = {
      id: CONV_ID,
      linkVersion: LINK_VERSION + 1,
      memberCount: 10,
    };

    const svc = buildService(makeConvRepo(convAfterReset), makeConfigService(SECRET));

    await expect(svc.validateInviteToken(tokenAtVersionN)).rejects.toThrow(
      'has been revoked',
    // polish: simplified
    );
  });
});
