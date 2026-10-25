// Shared timing only; LAN and online retain their own transport/simulation.
// Coarse OS timers can round 33.33 ms to ~46 ms on Windows. A monotonic
// deadline prevents this overshoot from accumulating into slower game time.
// Long stalls skip missed deadlines rather than running a catch-up burst.
export function scheduleServerTicks(callback, { rate = 30, clock = () => performance.now(),
  schedule = setTimeout, cancel = clearTimeout } = {}) {
  const period = 1000 / rate;
  let next = clock() + period, timer, stopped = false;
  const run = () => {
    if (stopped) return;
    callback(); next += period;
    const now = clock();
    if (next <= now) next += (Math.floor((now - next) / period) + 1) * period;
    timer = schedule(run, Math.max(0, next - clock()));
  };
  timer = schedule(run, period);
  return { stop() { stopped = true; cancel(timer); } };
}
