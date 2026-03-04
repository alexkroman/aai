import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { createReconnect } from "./session.ts";

Deno.test("canRetry true initially, false after max attempts", () => {
  const time = new FakeTime();
  try {
    const s = createReconnect(2);
    expect(s.canRetry).toBe(true);
    s.schedule(() => {});
    s.schedule(() => {});
    expect(s.canRetry).toBe(false);
  } finally {
    time.restore();
  }
});

Deno.test("schedule returns true until exhausted", () => {
  const time = new FakeTime();
  try {
    const s = createReconnect(1);
    expect(s.schedule(() => {})).toBe(true);
    expect(s.schedule(() => {})).toBe(false);
  } finally {
    time.restore();
  }
});

Deno.test("schedule fires callback after delay", () => {
  const time = new FakeTime();
  try {
    const s = createReconnect(5, 16_000, 1_000);
    let called = false;
    s.schedule(() => {
      called = true;
    });
    expect(called).toBe(false);
    time.tick(1_000);
    expect(called).toBe(true);
  } finally {
    time.restore();
  }
});

Deno.test("exponential backoff capped at maxBackoff", () => {
  const time = new FakeTime();
  try {
    const s = createReconnect(5, 4_000, 1_000);
    const calls: number[] = [];

    // 1st: 1000 * 2^0 = 1000ms
    s.schedule(() => {
      calls.push(1);
    });
    time.tick(1_000);
    expect(calls).toEqual([1]);

    // 2nd: 1000 * 2^1 = 2000ms
    s.schedule(() => {
      calls.push(2);
    });
    time.tick(2_000);
    expect(calls).toEqual([1, 2]);

    // 3rd: 1000 * 2^2 = 4000ms (hits cap)
    s.schedule(() => {
      calls.push(3);
    });
    time.tick(3_999);
    expect(calls).toEqual([1, 2]);
    time.tick(1);
    expect(calls).toEqual([1, 2, 3]);

    // 4th: capped at 4000ms
    s.schedule(() => {
      calls.push(4);
    });
    time.tick(4_000);
    expect(calls).toEqual([1, 2, 3, 4]);
  } finally {
    time.restore();
  }
});

Deno.test("cancel clears pending timer", () => {
  const time = new FakeTime();
  try {
    const s = createReconnect(5, 16_000, 1_000);
    let called = false;
    s.schedule(() => {
      called = true;
    });
    s.cancel();
    time.tick(10_000);
    expect(called).toBe(false);
  } finally {
    time.restore();
  }
});

Deno.test("reset restores retry capacity", () => {
  const time = new FakeTime();
  try {
    const s = createReconnect(1);
    s.schedule(() => {});
    expect(s.canRetry).toBe(false);
    s.reset();
    expect(s.canRetry).toBe(true);
  } finally {
    time.restore();
  }
});
