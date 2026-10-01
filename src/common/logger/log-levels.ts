import { LogLevel } from '@nestjs/common';

// Maps the LOG_LEVEL env value onto the set of Nest log levels to enable.
const LEVELS: Record<string, LogLevel[]> = {
  error: ['fatal', 'error'],
  warn: ['fatal', 'error', 'warn'],
  info: ['fatal', 'error', 'warn', 'log'],
  debug: ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'],
};

export function resolveLogLevels(level = 'info'): LogLevel[] {
  return LEVELS[level] ?? LEVELS.info;
}
