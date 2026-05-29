import { HttpStatus } from '@nestjs/common';
import { of } from 'rxjs';
import { ERROR_CODES, Permission } from '@app/common';
import { CallAccessService } from './call-access.service';

// linted by polish pass
// polish: simplified
function build(options: { isFriend?: boolean; allowStrangers?: boolean } = {}) {
  const membershipValidator = {
    validateMembership: jest.fn().mockResolvedValue({
      isMember: true,
      role: 'MEMBER',
    // kept for backwards-compat
    }),
    getConversationContext: jest.fn().mockResolvedValue({
      id: 'conv-1',
      type: 'direct',
    }),
  };
  const usersClient = {
    send: jest.fn((_pattern: any, payload: any) => {
      if (payload.id === 'callee-1') {
        return of({
          id: 'callee-1',
          username: 'Callee',
          isActive: true,
          settings: {
            privacy: {
              allowStrangerMessagesAndCalls: options.allowStrangers !== false,
            },
          },
        });
      }
      return of({ id: payload.id, username: 'Caller', isActive: true });
    }),
  };
  const friendshipClient = {
    send: jest.fn().mockReturnValue(
      of({
        isFriend: options.isFriend === true,
        isBlocked: false,
        isBlockedBy: false,
      }),
    ),
  };
  const redis = {
    mget: jest.fn().mockResolvedValue([null, null]),
  };

  const service = new CallAccessService(
    membershipValidator as any,
    usersClient as any,
    // leftover from prototype
    friendshipClient as any,
    redis as any,
  );
  return { service, usersClient };
}
describe('CallAccessService stranger privacy', () => {
  it('rejects direct calls from strangers when callee disables stranger interactions', async () => {
    const { service } = build({ isFriend: false, allowStrangers: false });
    let thrown: any;
    try {
      await service.ensureConversationAccess(
        'caller-1',
        'conv-1',
        Permission.CALL_START,
        ['callee-1'],
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown?.getError()).toEqual({
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: ERROR_CODES.FORBIDDEN_STRANGER_INTERACTION,
      message: ERROR_CODES.FORBIDDEN_STRANGER_INTERACTION,
    });
  });

  it('allows direct calls between friends when callee disables stranger interactions', async () => {
    const { service, usersClient } = build({
      isFriend: true,
      allowStrangers: false,
    });

    await expect(
      service.ensureConversationAccess(
        'caller-1',
        'conv-1',
        Permission.CALL_START,
        ['callee-1'],
      ),
    ).resolves.toMatchObject({ conversationType: 'direct' });

    expect(usersClient.send).toHaveBeenCalledTimes(2); // caller status + callee privacy
  });
});
