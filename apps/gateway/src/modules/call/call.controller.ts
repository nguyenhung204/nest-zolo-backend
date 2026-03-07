import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { CurrentUser, KeycloakGuard, Public, createLogger } from '@app/common';
import type { KeycloakUser } from '@app/common';
import { CallGatewayService } from './call.gateway';

/**
 * HTTP API for the Instant Call feature.
 *
 * All mutation endpoints are protected by KeycloakGuard.
 * Rate limits follow Zalo/Messenger conventions:
 *   - start  : 5/min  (prevent call-spam)
 *   - accept / decline / end : 30/min (rapid user actions are ok)
 *   - reads  : 60/min
 */
@Controller('calls')
@UseGuards(KeycloakGuard)
export class CallController {
  private readonly logger = createLogger(CallController.name);

  constructor(private readonly callGatewayService: CallGatewayService) {}

  // Health — unauthenticated, no throttle
  @Get('health')
  @Public()
  @SkipThrottle()
  getHealth() {
    return this.callGatewayService.getHealth();
  }

  // Initiate a new call
  @Post('start')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  startCall(
    @CurrentUser() user: KeycloakUser,
    @Body() body: { conversationId: string; calleeIds: string[] },
  ) {
    this.logger.log(
      `startCall: conversationId=${body.conversationId} caller=${user.sub}`,
    );
    return this.callGatewayService.startCall({
      conversationId: body.conversationId,
      callerId: user.sub,
      calleeIds: body.calleeIds,
    });
  }

  // Callee accepts the call
  @Post(':callId/accept')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  acceptCall(
    @CurrentUser() user: KeycloakUser,
    @Param('callId') callId: string,
  ) {
    return this.callGatewayService.acceptCall({
      callId,
      calleeId: user.sub,
    });
  }

  // Callee declines
  @Post(':callId/decline')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  declineCall(
    @CurrentUser() user: KeycloakUser,
    @Param('callId') callId: string,
  ) {
    return this.callGatewayService.declineCall({
      callId,
      declinedBy: user.sub,
    });
  }

  // Caller cancels / either party hangs up
  @Post(':callId/end')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  endCall(
    @CurrentUser() user: KeycloakUser,
    @Param('callId') callId: string,
  ) {
    return this.callGatewayService.endCall({
      callId,
      endedBy: user.sub,
    });
  }

  // Fetch a single call record
  @Get(':callId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  getCall(
    @CurrentUser() user: KeycloakUser,
    @Param('callId') callId: string,
  ) {
    return this.callGatewayService.getCall({ callId, requestedBy: user.sub });
  }

  // Call history for a conversation
  @Get('history/:conversationId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  listCallHistory(
    @CurrentUser() user: KeycloakUser,
    @Param('conversationId') conversationId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.callGatewayService.listCallHistory({
      conversationId,
      requestedBy: user.sub,
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });
  }

  // Post-call summary
  @Get(':callId/summary')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getCallSummary(
    @CurrentUser() user: KeycloakUser,
    @Param('callId') callId: string,
  ) {
    return this.callGatewayService.getCallSummary({
      callId,
      requestedBy: user.sub,
    });
  }

  // LiveKit token for caller (and reconnecting participants) after call is ACTIVE
  @Get(':callId/token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getCallToken(
    @CurrentUser() user: KeycloakUser,
    @Param('callId') callId: string,
  ) {
    return this.callGatewayService.getCallToken({
      callId,
      userId: user.sub,
    });
  }
}
