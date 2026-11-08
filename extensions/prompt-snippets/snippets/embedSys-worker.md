---
name: Strict User's Rules For Embedded
description: Rules for embedded target. User-supplied pin/peripheral/register details take priority; datasheet only with permission. Price concurrency in right budget (stack RAM, scheduler flash) before threads. Design to physical limits — serial timing, alignment, aliasing, no C99 static asserts — not dev host
placement: append
order: 10
---

# Embedded: user-supplied details first

## Rule
When the user gives pin or hardware details that normally live in the datasheet, answer the request using exactly those details.

- Do not go hunting for the datasheet or other sources on your own. Unrequested research wastes effort and can send you and the user down the wrong path.
- If extra research would help, say what you would look up and why, then wait for the user's OK.
- Focus on the range of int on the target, not an assumed fixed bits (16 or 32).

## Exception: high-risk registers
If the user's request conflicts with a protected or lock-gated register (e.g. GPIOLOCK / GPIOCR-gated pins such as NMI or JTAG pins):

1. Do not research silently.
2. State the concern in one or two sentences (which pin/register, what could go wrong).
3. Ask for permission to look into it, then proceed per the answer.

## Rule: justify concurrency, do not default to it
- Threads and RTOS tasks are a resource purchase, not free parallelism. Price them in the correct budget: each task needs its own stack (RAM), and the scheduler plus task-control blocks are code and data (flash). Do not say "threads cost flash" — stacks are RAM, the scheduler is flash.
- Gate on both budgets explicitly: no RAM headroom means do not consider threads. No flash headroom means do not consider a scheduler. If neither budget is quantified, say so and take the single-threaded design until the user supplies numbers.
- Before proposing concurrency, name what actually runs in parallel. If the pipeline is strictly serial (acquire, parse, queue, publish), there is nothing to parallelize and a second thread only waits. Paying for a scheduler, a stack, and critical sections to buy zero concurrency is a net loss.
- Concurrency also costs determinism. A single-writer/single-reader structure confined to one thread needs no locking; that is a design property, not luck. Adding a thread turns every shared access into a critical section and reintroduces a bug class the design already excluded. State that cost when recommending threads.
- A busy-wait loop is a real defect on target, but the fix is blocking, not threading: `poll`/`select` with a computed timeout on a host, and on target a peripheral RX interrupt plus a hardware timer with the main loop blocked between events. Same single-threaded state machine, no CPU burn. Prefer event-driven over thread-driven.
- When a feature is deferred, never justify it as "considered X but it was complex." Say "on target I would use X, because Y." A plan reads as competence; a rejected option reads as a retreat.

## Rule: design to the target's physical limits, not the dev host
- Dev-host speed is not evidence. Serial bandwidth sets a hard deadline: at 921600 baud a byte arrives roughly every 10.8 microseconds and a 20-byte frame completes in roughly 217 microseconds. Say whether that margin survives preemption, and prefer an RX interrupt feeding the ring over polling when the FIFO depth is short or unknown.
- Constrained targets hit two portability axes besides endianness: alignment (a byte buffer guarantees no alignment for a wider load) and strict aliasing (reading `char` storage through another type is undefined behavior). Casting a packed byte buffer to a wider pointer fails on endianness, alignment, and aliasing at once.
- Isolate byte-order conversion in one layer (for example `read_u32`/`write_u32`) built from shifts. Shifts operate on values, and values have no byte order, so the layers above work in native types and the host's endianness cancels out. `memcpy` between an integer and a float on the same host is safe for the same reason: both types share that host's order, and the wire order was already resolved by the shifts.
- C99 provides no `_Static_assert`. When the build pins C99, verify representation assumptions at runtime during init (`CHAR_BIT`, `FLT_RADIX`, `FLT_MANT_DIG`, and that `1.0f` has bit pattern 0x3f800000) and refuse to run on mismatch instead of relying on an unavailable compile-time check.

## Checklist
- [ ] Used only the user's pin/peripheral details?
- [ ] Any assumption beyond them stated explicitly?
- [ ] Any lock-gated register touched? If so, concern raised first.
- [ ] Concurrency priced in the right budget (stack is RAM, scheduler is flash)?
- [ ] Named what actually runs in parallel before proposing threads?
- [ ] Stated the locking/determinism cost of adding a thread?
- [ ] Fixed busy-waiting with blocking rather than threading?
- [ ] Timing margin justified against the target's limits, not the dev host?
- [ ] Deferred target features framed as "on target I would", not as rejected options?
