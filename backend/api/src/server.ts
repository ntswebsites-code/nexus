import { config } from './config';
import { createApp } from './app';
import { checkDatabase, prisma } from './lib/prisma';

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  console.log(`[api] Matanho Nexus API listening on http://localhost:${config.port} (${config.nodeEnv})`);
  console.log(`[api] CORS origins: ${config.corsOrigins.join(', ')}`);
  void checkDatabase().then((ok) =>
    console.log(ok ? '[api] database connection: OK' : '[api] database connection: UNAVAILABLE'),
  );
});

async function shutdown(signal: string) {
  console.log(`[api] ${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
