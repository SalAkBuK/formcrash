import type { FastifyInstance } from 'fastify';

export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/health', () => ({
    service: 'formcrash-server' as const,
    status: 'ok' as const,
    timestamp: new Date().toISOString(),
  }));
}
