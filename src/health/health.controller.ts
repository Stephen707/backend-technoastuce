import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  MemoryHealthIndicator,
  MongooseHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { CacheService } from '../cache/cache.service';
import { Config } from '../config/configuration';

const HEAP_LIMIT_BYTES = 512 * 1024 * 1024;

@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly redisEnabled: boolean;

  constructor(
    private readonly health: HealthCheckService,
    private readonly mongoose: MongooseHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly indicators: HealthIndicatorService,
    private readonly cache: CacheService,
    config: ConfigService<Config, true>,
  ) {
    this.redisEnabled = !!config.get('cache', { infer: true }).redisUrl;
  }

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness check (Database, cache + memory)' })
  check() {
    return this.health.check([
      () => this.mongoose.pingCheck('database', { timeout: 1500 }),
      () => this.memory.checkHeap('memory_heap', HEAP_LIMIT_BYTES),
      ...(this.redisEnabled ? [() => this.checkRedis()] : []),
    ]);
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness check (process is up)' })
  live() {
    return { status: 'ok', uptime: process.uptime() };
  }

  // Informational: the API keeps working without Redis (the cache fails
  // open), so an outage must not take every instance out of rotation at
  // once. It shows up as `degraded: true` for monitoring.
  private async checkRedis() {
    const reachable = await this.cache.ping();
    return this.indicators.check('redis').up({ degraded: !reachable });
  }
}
