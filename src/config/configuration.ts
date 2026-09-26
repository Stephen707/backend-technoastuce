export interface Config {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  logLevel: string;
}

export default (): Config => ({
  port: parseInt(process.env.PORT ?? '5080'),
  databaseUrl: process.env.DATABASE_URL || 'mongodb://localhost:27017/myapp',
  jwtSecret: process.env.JWT_SECRET || 'mysecret',
  logLevel: process.env.LOG_LEVEL || 'info',
});
