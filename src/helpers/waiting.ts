import type { Falsy } from 'utility-types';

export class TimeoutError extends Error {}

export const SECOND = 1000;

type WaitUntilReturn<T> = T extends Falsy ? never : Promise<NonNullable<T>>;

function timeoutPromise<T>(ms: number, promise: Promise<T>, description: string): Promise<T> {
  const timeout = new Promise((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      const error = new TimeoutError(description);
      reject(error);
    }, ms);
  });

  return Promise.race([
    promise,
    // casting to avoid type error- safe since this promise will always reject
    timeout as Promise<T>,
  ]);
}

/**
 * Wait until a promise resolves with a truthy value or reject after a timeout
 */
export function waitUntil<T>(
  asyncTest: () => Promise<T>,
  description = '',
  timeout = 10000,
  interval = 100,
): WaitUntilReturn<T> {
  const promise = new Promise<NonNullable<T>>((resolve, reject) => {
    function wait() {
      asyncTest()
        .then(value => {
          if (value) {
            resolve(value);
          } else {
            setTimeout(wait, interval);
          }
        })
        .catch(() => {
          reject();
        });
    }
    wait();
  });
  return timeoutPromise(timeout, promise, description) as WaitUntilReturn<T>;
}

export function raceTimeout(ms: number, promise: Promise<any>) {
  return timeoutPromise(ms, promise, 'timeout').catch(err => {
    if (!(err instanceof TimeoutError)) throw err;
  });
}

export function runSerial<T>(actions: (() => Promise<T>)[]): Promise<T[]> {
  return actions.reduce((m, a) => m.then(async x => [...x, await a()]), Promise.resolve<T[]>(new Array<T>()));
}

export function sleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

/**
 * Random delay within [min, max] ms to mimic human-like timing and reduce bot detection.
 */
export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return sleep(delay);
}
