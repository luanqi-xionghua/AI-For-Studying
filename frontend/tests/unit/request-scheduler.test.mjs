import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RequestScheduler } from '../../src/ai/request-scheduler.mjs';
import { RequestQueue } from '../../src/shared/request-queue.mjs';
const request = (queue, owner, provider = 'openai') => {
  const controller = new AbortController(), states = [];
  const ticket = queue.acquire({ owner, provider, signal: controller.signal, onState: state => states.push(state) });
  return { controller, states, ...ticket };
};
test('one question per file; global queue starts oldest eligible job', async () => {
  const queue = new RequestScheduler({ concurrent: 1, queued: 2 });
  const a = request(queue, 'a'), b = request(queue, 'b'), c = request(queue, 'c');
  await a.started;
  assert.throws(() => request(queue, 'a'), /已有提问/);
  assert.deepEqual(queue.queue.summary(), { running: 1, queued: 2, limits: { concurrent: 1, queued: 2 } });
  assert.equal(b.states.at(-1).position, 1); assert.equal(c.states.at(-1).position, 2);
  a.release(); await b.started; assert.equal(c.states.at(-1).position, 1);
  b.release(); await c.started; c.release(); assert.equal(queue.jobs.size, 0);
});
test('all Harness providers share the same concurrency limit', async () => {
 const queue=new RequestScheduler({concurrent:2,queued:2});const a=request(queue,'a','custom'),b=request(queue,'b','custom'),c=request(queue,'c','kimi');
 await Promise.all([a.started,b.started]);assert.equal(c.states.at(-1).status,'queued');a.release();await c.started;b.release();c.release();
});
test('queued cancellation removes position immediately; running cancellation retains slot until cleanup', async () => {
  const queue = new RequestScheduler({ concurrent: 1, queued: 2 });
  const a = request(queue, 'a'), b = request(queue, 'b'), c = request(queue, 'c');
  b.controller.abort(); await assert.rejects(b.started, { name: 'AbortError' });
  assert.equal(c.states.at(-1).position, 1);
  a.controller.abort(); assert.equal(c.states.at(-1).status, 'queued');
  a.release(); await c.started; c.release(); b.release(); assert.equal(queue.jobs.size, 0);
});
test('full queue rejection leaves no orphan, and releasing twice cannot free another slot', async () => {
  const queue = new RequestScheduler({ concurrent: 1, queued: 0 });
  const a = request(queue, 'a'); assert.throws(() => request(queue, 'b'), /队列已满/);
  assert.equal(queue.jobs.size, 1); a.release(); a.release();
  const b = request(queue, 'b'); await b.started; assert.equal(queue.queue.summary().running, 1); b.release();
});
test('changing limits drains waiting jobs without canceling active questions or resetting progress callbacks', async () => {
  const queue = new RequestScheduler({ concurrent: 1, queued: 2 });
  const a = request(queue, 'a'), b = request(queue, 'b');
  queue.configure({ concurrent: 2, queued: 2 }); await b.started;
  assert.equal(a.states.length, 1);
  queue.configure({ concurrent: 1, queued: 0 }); assert.equal(queue.queue.summary().running, 2);
  a.release(); b.release();
});
test('default limits: four owners run, sixteen wait, and the twenty-first question is rejected', async () => {
  const queue = new RequestScheduler();
  assert.deepEqual(queue.queue.summary().limits, { concurrent: 4, queued: 16 });
  const running = Array.from({ length: 4 }, (_, index) => request(queue, `run-${index}`));
  await Promise.all(running.map(item => item.started));
  const waiting = Array.from({ length: 16 }, (_, index) => request(queue, `wait-${index}`));
  assert.deepEqual(queue.queue.summary(), { running: 4, queued: 16, limits: { concurrent: 4, queued: 16 } });
  assert.deepEqual(waiting.map(item => item.states.at(-1).position), Array.from({ length: 16 }, (_, index) => index + 1));
  assert.throws(() => request(queue, 'overflow'), /队列已满/);
  assert.equal(queue.jobs.size, 20, '被拒的第 21 个不留孤儿');
  // 释放一席：最老的等待项前移并开始，其余等待位置顺延。
  running[0].release();
  await waiting[0].started;
  assert.deepEqual(queue.queue.summary(), { running: 4, queued: 15, limits: { concurrent: 4, queued: 16 } });
  assert.equal(waiting[1].states.at(-1).position, 1);
  for (const item of running.slice(1)) item.release();
  for (const item of waiting) item.release();
  assert.equal(queue.jobs.size, 0);
});
test('explicit old 2/8 limits and queued: 0 still behave as before', async () => {
  const legacy = new RequestScheduler({ concurrent: 2, queued: 8 });
  assert.deepEqual(legacy.queue.summary().limits, { concurrent: 2, queued: 8 });
  const a = request(legacy, 'a'), b = request(legacy, 'b');
  await Promise.all([a.started, b.started]);
  const waiting = Array.from({ length: 8 }, (_, index) => request(legacy, `q-${index}`));
  assert.throws(() => request(legacy, 'overflow'), /队列已满/);
  a.release(); await waiting[0].started;
  b.release(); await waiting[1].started;
  for (const item of waiting) item.release();
  assert.equal(legacy.jobs.size, 0);
  const noQueue = new RequestScheduler({ concurrent: 1, queued: 0 });
  const only = request(noQueue, 'only');
  assert.throws(() => request(noQueue, 'second'), /队列已满/);
  only.release(); assert.equal(noQueue.jobs.size, 0);
});
test('restoring a saved queue keeps its fixed capacity of 20 entries (4 + 16)', () => {
  const entries = Array.from({ length: 25 }, (_, index) => ({ id: `i-${index}`, owner: `o-${index}`, tabId: index + 1, provider: 'openai', status: index < 4 ? 'running' : 'queued' }));
  const queue = new RequestQueue(entries);
  assert.equal(queue.entries.length, 20);
  assert.deepEqual(queue.summary(), { running: 4, queued: 16, limits: { concurrent: 4, queued: 16 } });
});
