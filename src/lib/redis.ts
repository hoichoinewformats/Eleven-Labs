import { Redis } from 'ioredis';
import { env } from '../env.js';

// BullMQ requires `maxRetriesPerRequest: null`. We use a dedicated connection
// for the queue/worker to avoid that constraint leaking into other clients.
export function makeBullConnection() {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
}

// Generic publisher (also fine for caches, etc.)
export function makePublisher() {
  return new Redis(env.REDIS_URL);
}

// Subscriber connections must be dedicated - they can't issue normal commands
// once subscribed. Caller is responsible for `quit()`.
export function makeSubscriber() {
  return new Redis(env.REDIS_URL);
}
