// Copyright 2025 the AAI authors. MIT license.
import { assertStrictEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import { createReconnect } from "./session.ts";

Deno.test("canRetry true initially, false after max attempts", () => {
  using _time = new FakeTime();
  const s = createReconnect({ maxAttempts: 2 });
  assertStrictEquals(s.canRetry, true);
  s.schedule(spy());
  s.schedule(spy());
  assertStrictEquals(s.canRetry, false);
});

Deno.test("schedule returns true until exhausted", () => {
  using _time = new FakeTime();
  const s = createReconnect({ maxAttempts: 1 });
  assertStrictEquals(s.schedule(spy()), true);
  assertStrictEquals(s.schedule(spy()), false);
});

Deno.test("schedule fires callback after delay", () => {
  using time = new FakeTime();
  const s = createReconnect({
    maxAttempts: 5,
    maxBackoff: 16_000,
    initialBackoff: 1_000,
  });
  const cb = spy();
  s.schedule(cb);
  assertSpyCalls(cb, 0);
  time.tick(1_000);
  assertSpyCalls(cb, 1);
});

Deno.test("exponential backoff capped at maxBackoff", () => {
  using time = new FakeTime();
  const s = createReconnect({
    maxAttempts: 5,
    maxBackoff: 4_000,
    initialBackoff: 1_000,
  });

  // 1st: 1000 * 2^0 = 1000ms
  const cb1 = spy();
  s.schedule(cb1);
  time.tick(1_000);
  assertSpyCalls(cb1, 1);

  // 2nd: 1000 * 2^1 = 2000ms
  const cb2 = spy();
  s.schedule(cb2);
  time.tick(2_000);
  assertSpyCalls(cb2, 1);

  // 3rd: 1000 * 2^2 = 4000ms (hits cap)
  const cb3 = spy();
  s.schedule(cb3);
  time.tick(3_999);
  assertSpyCalls(cb3, 0);
  time.tick(1);
  assertSpyCalls(cb3, 1);

  // 4th: capped at 4000ms
  const cb4 = spy();
  s.schedule(cb4);
  time.tick(4_000);
  assertSpyCalls(cb4, 1);
});

Deno.test("cancel clears pending timer", () => {
  using time = new FakeTime();
  const s = createReconnect({
    maxAttempts: 5,
    maxBackoff: 16_000,
    initialBackoff: 1_000,
  });
  const cb = spy();
  s.schedule(cb);
  s.cancel();
  time.tick(10_000);
  assertSpyCalls(cb, 0);
});

Deno.test("reset restores retry capacity", () => {
  using _time = new FakeTime();
  const s = createReconnect({ maxAttempts: 1 });
  s.schedule(spy());
  assertStrictEquals(s.canRetry, false);
  s.reset();
  assertStrictEquals(s.canRetry, true);
});
