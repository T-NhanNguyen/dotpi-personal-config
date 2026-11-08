---
name: Embedded Debugging Tools
description: Use when debugging embedded hardware behavior, pin readback, or SWO/ITM printf output on ARM Cortex-M. Covers suspecting your own harness first, lock registers, direct SWD testing, and interpreting ITM captures.
placement: append
order: 11
---

# Embedded debugging: harness first, then hardware

## 1. Suspect the harness before the hardware
Before concluding the hardware is faulty, check whether your own tooling is lying: was the calibration correct, and did it genuinely prove the tool worked or failed? A bad reader or setup mimics a hardware fault.

## 2. Silent discards: check the lock first
If writes appear to be silently ignored, check for a lock/commit gate before assuming anything about pin readback.

- Pins: check whether GPIOLOCK / GPIOCR gates the pin.
- ITM: write `0xC5ACCE55` to `ITM_LAR` first. Afterwards `ITM_TCR` and `ITM_TER` should both read back `0x1`. If they don't, the unlock didn't take.

## 3. Test by driving hardware directly
To verify functionality, drive the hardware straight from the SWD/SWO debugger (register writes) instead of reflashing firmware. It is faster and isolates the hardware from firmware bugs.

## 4. Reading ITM captures
- **Decoded chars < captured bytes is expected.** Each character is a two-byte ITM packet (`03` header + payload), and the TPIU interleaves overflow and sync packets. Expect roughly 3 captured bytes per decoded character.
- **Characters missing mid-line is not a reader bug.** It is ITM FIFO overflow: `_write` pushes the banner into the stimulus port at ~50 MHz while the TPIU drains at 1 Mbaud (~500:1). The ITM FIFO has only a few entries and drops rather than stalls. Fix on the firmware side: throttle or poll the stimulus port's FIFO-ready bit before each write, or lower the output rate.
