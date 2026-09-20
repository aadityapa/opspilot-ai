/**
 * Live updates over server-sent events. One in-process bus; each signed-in browser tab holds one
 * connection and receives small "something changed" hints — never the content itself. The client
 * refetches what it is looking at, so authorisation is always the ordinary endpoint's.
 *
 * Process-local by design: with several replicas each tab hears only its own process, which is
 * still correct, merely less prompt. A shared channel is the first thing to add when scaling out.
 */
import { EventEmitter } from 'node:events';
import { Router } from 'express';

export type LiveEvent =
  | { type: 'notification'; ticketId?: string }
  | { type: 'ticket'; ticketId: string }
  | { type: 'approval'; ticketId: string }
  | { type: 'announcement' };

const bus = new EventEmitter();
bus.setMaxListeners(0);

const channel = (userId: string) => `user:${userId}`;

/** Tells specific people that something of theirs changed. */
export function notifyUsers(userIds: Iterable<string>, event: LiveEvent) {
  for (const id of new Set(userIds)) bus.emit(channel(id), event);
}

/** Tells everyone; used for announcements and board-level changes. */
export function broadcast(event: LiveEvent) {
  bus.emit('all', event);
}

export const realtimeRouter = Router();

/**
 * Every open stream, so shutdown can end them: an SSE response never finishes on its own, and
 * `server.close()` waits for it, which would turn every graceful stop into a forced exit after
 * the deadline. Ending them tells each browser to reconnect (to the next process) immediately.
 */
const open = new Set<import('express').Response>();
export const openStreams = () => open.size;
export function closeAllStreams() {
  for (const res of open) {
    try { res.write('event: bye\ndata: {}\n\n'); res.end(); } catch { /* already gone */ }
  }
  open.clear();
}

realtimeRouter.get('/events/stream', (req, res) => {
  const userId = res.locals.user.id;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 5000\nevent: hello\ndata: {}\n\n`);
  const send = (event: LiveEvent) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  bus.on(channel(userId), send);
  bus.on('all', send);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  open.add(res);
  const cleanup = () => {
    clearInterval(heartbeat);
    bus.off(channel(userId), send);
    bus.off('all', send);
    open.delete(res);
  };
  req.on('close', cleanup);
  res.on('finish', cleanup);
});
