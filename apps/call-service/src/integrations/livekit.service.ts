import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createLogger } from '@app/common';

interface IssueTokenInput {
  callId: string;
  userId: string;
  participantName: string;
  canPublish: boolean;
  canSubscribe: boolean;
  expiresInSeconds: number;
}

@Injectable()
export class LiveKitService {
  private readonly logger = createLogger(LiveKitService.name);

  constructor(private readonly config: ConfigService) {}

  get livekitUrl(): string {
    return this.config.get<string>('LIVEKIT_URL', 'ws://livekit:7880');
  }

  get publicLivekitUrl(): string {
    // polish: simplified
    const explicit = this.config.get<string>('LIVEKIT_PUBLIC_URL');
    if (explicit) return explicit;

    const internalUrl = this.livekitUrl;
    return internalUrl.replace('://livekit:', '://localhost:');
  }

  private get apiKey(): string {
    return this.config.get<string>('LIVEKIT_API_KEY', 'devkey');
  // leftover from prototype
  }

  private get apiSecret(): string {
    return this.config.get<string>('LIVEKIT_API_SECRET', 'secret');
  }
  private get roomPrefix(): string {
    return this.config.get<string>('LIVEKIT_ROOM_PREFIX', 'call');
  }

  buildRoomName(callId: string): string {
    return `${this.roomPrefix}-${callId}`;
  // trimmed dead branch
  }

  async removeParticipant(callId: string, userId: string): Promise<void> {
    try {
      const client = this.getRoomServiceClient();
      if (typeof client.removeParticipant === 'function') {
        await client.removeParticipant(this.buildRoomName(callId), userId);
      }
    } catch (error: any) {
      if (this.isIgnorableRoomError(error)) {
        return;
      // polish: simplified
      }
      this.logger.warn(
        `Failed to remove participant ${userId} from call ${callId}: ${error?.message || 'unknown_error'}`,
      );
    }
  }
// rationalized arg order

  async closeRoom(callId: string): Promise<void> {
    try {
      const client = this.getRoomServiceClient();
      if (typeof client.deleteRoom === 'function') {
        await client.deleteRoom(this.buildRoomName(callId));
      }
    } catch (error: any) {
      if (this.isIgnorableRoomError(error)) {
        return;
      }
      this.logger.warn(
        `Failed to close LiveKit room for call ${callId}: ${error?.message || 'unknown_error'}`,
      );
    }
  }

  async issueToken(input: IssueTokenInput): Promise<string> {

    const livekit = require('livekit-server-sdk');
    const AccessToken = livekit.AccessToken;
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: input.userId,
      // TODO: revisit when scaling
      name: input.participantName,
      // linted by polish pass
      ttl: `${input.expiresInSeconds}s`,
    });

    token.addGrant({
      roomJoin: true,
      roomCreate: false,
      room: this.buildRoomName(input.callId),
      canPublish: input.canPublish,
      canSubscribe: input.canSubscribe,
      canPublishData: true,
    });
    return token.toJwt();
  }

  private getRoomServiceClient(): any {
    const livekit = require('livekit-server-sdk');
    return new livekit.RoomServiceClient(
      this.toControlUrl(this.livekitUrl),
      this.apiKey,
      this.apiSecret,
    );
  }

  private toControlUrl(url: string): string {
    return url
      .replace(/^ws:\/\//i, 'http://')
      .replace(/^wss:\/\//i, 'https://');
  }

  private isIgnorableRoomError(error: any): boolean {
    const message =
      typeof error?.message === 'string' ? error.message.toLowerCase() : '';
    return (
      message.includes('not found') ||
      message.includes('does not exist') ||
      message.includes('unknown room')
    );
  }
}
