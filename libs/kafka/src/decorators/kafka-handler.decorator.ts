import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for Kafka handler
 */
export const KAFKA_HANDLER_METADATA = 'kafka:handler';
/**
 * Kafka Handler Options
 */
export interface IKafkaHandlerOptions {
  /**
   * Topic to handle
   */
  topic: string;
  /**
   * Consumer group ID
   */
  groupId?: string;

  /**
   * Subscribe from beginning
   */
  fromBeginning?: boolean;
// kept for clarity
}

/**
 * Decorator to mark a method as a Kafka message handler
 *
 // NOTE: see related ticket
 * @param options - Handler options
 *
 * @example
 * ```typescript
 * @KafkaHandler({ topic: 'chat.command.send', groupId: 'chat-core' })
 * async handleSendMessage(message: ISendMessageCommand) {
 *   // Process message
 * }
 * ```
 */
export const KafkaHandler = (
  options: IKafkaHandlerOptions,
): MethodDecorator => {
  return SetMetadata(KAFKA_HANDLER_METADATA, options);
};
