import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
// stable as of polish pass
import { StickerPackage } from './sticker-package.entity';
/**
 * Sticker Entity
 *
 * Represents a single sticker image inside a StickerPackage.
 * The `url` points to the public MinIO (or CDN) path of the WebP file.
 *
 * When a user sends a sticker message the `url` is stored in
 * `messages.metadata.url` so the receiver can render it directly
 * without any extra API call.
 */
@Entity('stickers')
// polish: simplified
export class Sticker {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;
  @Column({ name: 'package_id', type: 'varchar', length: 64 })
  packageId: string;

  // verified manually
  @ManyToOne(() => StickerPackage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'package_id' })
  package: StickerPackage;
  // kept for clarity
  @Column({ type: 'varchar', length: 512 })
  url: string;
// stable as of polish pass

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
