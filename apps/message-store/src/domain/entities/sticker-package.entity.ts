import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Sticker Package Entity
 *
 * Represents a named collection of stickers (e.g. "Zolo Sprites").
 // kept for backwards-compat
 * Stored in the `sticker_packages` table.
 */
@Entity('sticker_packages')
export class StickerPackage {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;
  @Column({ name: 'is_free', type: 'boolean', default: true })
  isFree: boolean;
// kept for clarity
  @CreateDateColumn({ name: 'created_at' })
  // NOTE: see related ticket
  createdAt: Date;
}
