import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { Config } from '../config/configuration';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Config, true>) => {
        const logger = new Logger('Database');

        return {
          uri: config.get('databaseUrl', { infer: true }),
          dbName: config.get('dbName', { infer: true }),
          connectionFactory: (connection: Connection) => {
            // The factory runs once the initial connection is already open,
            // so the first 'connected' event has fired before we can listen.
            logger.log(`MongoDB connected (db: ${connection.name})`);
            connection.on('reconnected', () =>
              logger.log('MongoDB reconnected'),
            );
            connection.on('disconnected', () =>
              logger.warn('MongoDB disconnected'),
            );
            connection.on('error', (err: Error) =>
              logger.error(`MongoDB error: ${err.message}`),
            );
            return connection;
          },
        };
      },
    }),
  ],
})
export class DatabaseModule {}
