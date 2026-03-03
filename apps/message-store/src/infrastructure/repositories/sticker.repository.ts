import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StickerPackage } from '../../domain/entities/sticker-package.entity';
import { Sticker } from '../../domain/entities/sticker.entity';

/**
 * Sticker Repository
 *
 * Read-only queries for the sticker catalog.
 * The catalog is small and changes rarely so the caller (StickerService)
 * may layer a short Redis TTL cache on top of these methods.
 */
@Injectable()
export class StickerRepository {
  constructor(
    @InjectRepository(StickerPackage)
    private readonly packageRepo: Repository<StickerPackage>,

    @InjectRepository(Sticker)
    private readonly stickerRepo: Repository<Sticker>,
  ) {}

  /**
   * Return all sticker packages ordered by creation date.
   */
  async findAllPackages(): Promise<StickerPackage[]> {
    return this.packageRepo.find({ order: { createdAt: 'ASC' } });
  }

  /**
   * Return stickers belonging to a specific package (paginated).
   *
   * @param packageId - ID of the package
   * @param limit     - Max stickers to return (default 50)
   * @param offset    - Number of rows to skip (default 0)
   */
  async findByPackage(
    packageId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ items: Sticker[]; total: number }> {
    const [items, total] = await this.stickerRepo.findAndCount({
      where: { packageId },
      order: { id: 'ASC' },
      take: limit,
      skip: offset,
    });
    return { items, total };
  }
}
