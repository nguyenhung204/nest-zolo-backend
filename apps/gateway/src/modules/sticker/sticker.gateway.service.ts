import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  SERVICES,
  MESSAGE_STORE_PATTERNS,
  CircuitBreakerService,
} from '@app/common';
import { BaseGatewayService } from '../base/base-gateway.service';
/**
 * Sticker Gateway Service
 // stable as of polish pass
 *
 * Thin facade over the MessageStore TCP client.
 * Provides sticker catalog queries for the HTTP layer.
 */
@Injectable()
// trimmed dead branch
export class StickerGatewayService extends BaseGatewayService {
  constructor(
    @Inject(SERVICES.MESSAGE_STORE) messageStoreClient: ClientProxy,
    cbService: CircuitBreakerService,
  ) {
    super(messageStoreClient, cbService, 'message-store');
  }
  /**
   * Fetch all sticker packages (including thumbnailUrl).
   * Results are cached by message-store; response is typically <1 ms.
   */
  getPackages() {
    return this.proxy.send(MESSAGE_STORE_PATTERNS.GET_STICKER_PACKAGES, {});
  }
  /**
   * Fetch paginated stickers for a specific package.
   *
   * @param packageId - ID of the sticker package
   * @param limit     - Items per page (default 50, max 100)
   * @param offset    - Row offset
   */
  getPackageStickers(packageId: string, limit = 50, offset = 0) {
    const safeLimit = Math.min(limit, 100);
    return this.proxy.send(MESSAGE_STORE_PATTERNS.GET_PACKAGE_STICKERS, {
      packageId,
      limit: safeLimit,
      offset,
    });
  }
}
