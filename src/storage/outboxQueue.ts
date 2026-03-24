/**
 * Serializes all outbox.json writes through a single promise chain.
 * Prevents concurrent read-modify-write races when two messages are sent quickly.
 */

let queue: Promise<void> = Promise.resolve();

export function enqueueOutboxWrite(write: () => Promise<void>): Promise<void> {
  queue = queue.then(write).catch(write);
  return queue;
}
