import { Prop, Schema } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';

/**
 * Abstract base schema for MongoDB documents
 * All MongoDB schemas should extend this
 */
@Schema()
export class AbstractDocument {
  @Prop({ type: SchemaTypes.ObjectId })
  _id: Types.ObjectId;
}

/**
 * Abstract schema with timestamps
 */
@Schema({ timestamps: true })
export class TimestampedDocument extends AbstractDocument {
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Abstract schema with soft delete
 */
@Schema({ timestamps: true })
export class SoftDeletableDocument extends TimestampedDocument {
  @Prop({ type: Date, default: null, required: false })
  deletedAt: Date | null;

  @Prop({ type: Boolean, default: false })
  isDeleted: boolean;
}
