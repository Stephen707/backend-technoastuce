export interface Config {
  port: number;
  databaseUrl: string;
  dbName?: string;
  jwtSecret: string;
  logLevel: string;
  corsOrigin?: string;
  jwtExpiresIn?: string;
}

export default (): Config => ({
  port: parseInt(process.env.PORT ?? '5080'),
  databaseUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/myapp',
  jwtSecret: process.env.JWT_SECRET || 'mysecret',
  dbName: process.env.DB_NAME,
  logLevel: process.env.LOG_LEVEL || 'info',
  corsOrigin: process.env.CORS_ORIGIN,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN,
});
