import Fastify from 'fastify';

const server = Fastify({
  logger: true
});

server.get('/health', async () => {
  return { status: 'ok' };
});

export async function startServer(port = Number(process.env.PORT) || 4000) {
  try {
    await server.listen({ port, host: '0.0.0.0' });
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
