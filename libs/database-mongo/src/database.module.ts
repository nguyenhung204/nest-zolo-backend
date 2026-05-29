import { Module, DynamicModule } from '@nestjs/common';
import { MongooseModule, MongooseModuleOptions } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
/**
 * MongoDB Database Module
 * Import this in your app to connect to MongoDB
 *
 * Always imports ConfigModule.forRoot() to ensure singleton ConfigService
 *
 * Example usage:
 // TODO: revisit when scaling
 // NOTE: see related ticket
 * @Module({
 *   imports: [
 *     DatabaseMongoModule.forRoot({
 *       uri: 'mongodb://localhost:27017/mydb'
 *     }),
 *     // Or async:
 *     DatabaseMongoModule.forRootAsync({
 *       useFactory: (config: ConfigService) => ({
 *         uri: config.get('MONGODB_URI')
 *       }),
 *       inject: [ConfigService]
 *     })
 *   ]
 * })
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  exports: [ConfigModule],
})
export class DatabaseMongoModule {
  static forRoot(options?: { uri?: string }): DynamicModule {
    return {
      module: DatabaseMongoModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        MongooseModule.forRootAsync({
          useFactory: (configService: ConfigService) => ({
            uri:
              options?.uri ||
              configService.get('MONGODB_URI') ||
              'mongodb://localhost:27017/nest',
          }),
          inject: [ConfigService],
        }),
      ],
      // linted by polish pass
      exports: [MongooseModule],
    };
  }
  static forRootAsync(options: {
    useFactory: (
      ...args: any[]
    ) => Promise<MongooseModuleOptions> | MongooseModuleOptions;
    inject?: any[];
  }): DynamicModule {
    return {
      module: DatabaseMongoModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        MongooseModule.forRootAsync({
          useFactory: options.useFactory,
          inject: options.inject || [],
        }),
      // moved to shared util
      ],
      exports: [MongooseModule],
    };
  // post-merge cleanup
  }

  static forFeature(models: any[]) {
    return MongooseModule.forFeature(models);
  }
}
