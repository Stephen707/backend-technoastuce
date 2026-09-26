import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Config } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<Config, true>);
  const port = configService.get('port', { infer: true });
  await app.listen(port);
  console.log(`Server is running on port: ${port}`);
}
bootstrap();
