import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { KeycloakGuard } from '@app/common';
import { StickerGatewayService } from './sticker.gateway.service';

/**
 * Sticker Controller
 *
 * Provides the sticker catalog API consumed by the frontend sticker keyboard.
 *
 * GET /stickers/packages
 *   Returns all sticker packages including thumbnailUrl for the tab icon.
 *
 * GET /stickers/packages/:packageId/stickers
 *   Returns paginated stickers for a specific package.
 */
@Controller('stickers')
@UseGuards(KeycloakGuard)
export class StickerController {
  constructor(private readonly stickerService: StickerGatewayService) {}

  /**
   * List all sticker packages.
   *
   * Response example:
   * [
   *   {
   *     "id": "pck_sprite",
   *     "name": "Zolo Sprites",
   *     "thumbnailUrl": "https://storage.bcn.id.vn/zolo-stickers/sprite_45212.webp",
   *     "isFree": true,
   *     "createdAt": "2026-04-12T00:00:00.000Z"
   *   }
   * ]
   */
  @Get('packages')
  getPackages() {
    return this.stickerService.getPackages();
  }

  /**
   * List stickers in a package (paginated).
   *
   * Query params:
   *   limit  — items per page, max 100, default 50
   *   offset — items to skip, default 0
   */
  @Get('packages/:packageId/stickers')
  getPackageStickers(
    @Param('packageId') packageId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.stickerService.getPackageStickers(packageId, limit, offset);
  }
}
