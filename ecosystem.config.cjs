// PM2 (deployment without Docker): `pm2 start ecosystem.config.cjs`.
// One instance: the cache and rate limiter live in memory. For cluster
// mode (instances > 1), set REDIS_URL first.
module.exports = {
  apps: [
    {
      name: 'technoastuce-api',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '600M',
      // Graceful shutdown: lets in-flight requests and campaign delivery end.
      kill_timeout: 15000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
