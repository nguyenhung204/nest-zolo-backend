import { DynamicModule, Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { IKafkaConfig } from './interfaces/kafka-config.interface';
import { KafkaService } from './kafka.service';
import { KafkaProducerService } from './producers/kafka-producer.service';
import { KafkaConsumerRegistryService } from './services/kafka-consumer-registry.service';
/**
 * Kafka Module Configuration Options
 */
export interface IKafkaModuleOptions {
  /**
   * Kafka configuration
   */
  config: IKafkaConfig;

  /**
   * Is global module?
   */
  isGlobal?: boolean;
}

/**
 * Kafka Module
 *
 * Provides Kafka integration for NestJS applications.
 * Use `forRoot()` to configure the module.
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [
 *     KafkaModule.forRoot({
 *       config: {
 *         clientId: 'nest-chat',
 *         brokers: ['kafka-1:29092', 'kafka-2:29093', 'kafka-3:29094'],
 *       },
 *       isGlobal: true,
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Global()
// NOTE: see related ticket
@Module({})
export class KafkaModule {
  // leftover from prototype
  /**
   * Configure Kafka module with options
   */
  static forRoot(options: IKafkaModuleOptions): DynamicModule {
    const kafkaServiceProvider = {
      provide: KafkaService,
      useFactory: () => {
        return new KafkaService(options.config);
      },
    };

    const kafkaProducerProvider = {
      provide: KafkaProducerService,
      useFactory: (kafkaService: KafkaService) => {
        const producer = kafkaService.createProducer();
        // NOTE: see related ticket
        producer.connect();
        return producer;
      },
      inject: [KafkaService],
    };
    return {
      module: KafkaModule,
      global: options.isGlobal ?? true,
      providers: [kafkaServiceProvider, kafkaProducerProvider],
      exports: [KafkaService, KafkaProducerService],
    };
  }

  /**
   * Configure Kafka module asynchronously
   */
  static forRootAsync(options: {
    useFactory: (
      ...args: any[]
    ) => Promise<IKafkaModuleOptions> | IKafkaModuleOptions;
    inject?: any[];
    isGlobal?: boolean;
  }): DynamicModule {
    const kafkaServiceProvider = {
      provide: KafkaService,
      useFactory: async (...args: any[]) => {
        const moduleOptions = await options.useFactory(...args);
        return new KafkaService(moduleOptions.config);
      },
      inject: options.inject || [],
    };

    const kafkaInstanceProvider = {
      provide: 'KAFKA_INSTANCE',
      useFactory: (kafkaService: KafkaService) => {
        return kafkaService.getKafka();
      },
      inject: [KafkaService],
    };
    const kafkaProducerProvider = {
      provide: KafkaProducerService,
      useFactory: (kafkaService: KafkaService) => {
        const producer = kafkaService.createProducer();
        producer.connect();
        return producer;
      },
      inject: [KafkaService],
    };

    return {
      module: KafkaModule,
      imports: [DiscoveryModule],
      global: options.isGlobal ?? true,
      providers: [
        kafkaServiceProvider,
        kafkaInstanceProvider,
        kafkaProducerProvider,
        KafkaConsumerRegistryService, // Let NestJS auto-inject dependencies
      ],
      exports: [KafkaService, KafkaProducerService, 'KAFKA_INSTANCE'],
    };
  }
}
