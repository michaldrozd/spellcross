import Fastify from 'fastify';

export function createServer() {
  const app = Fastify({
    logger: true
  });

  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}

export async function startServer(port = Number(process.env.PORT) || 4000) {
  const app = createServer();
  try {
    await app.listen({ port, host: '0.0.0.0' });
    return app;
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
