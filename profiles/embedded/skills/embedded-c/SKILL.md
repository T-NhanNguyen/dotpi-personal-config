---
name: embedded-c
description: Write and review C for microcontrollers. Use when working on firmware, drivers, interrupts, or memory-constrained code.
---

# Embedded C

- Avoid heap allocation after initialization; prefer static buffers with fixed sizes.
- Use the platform's volatile register definitions for memory-mapped input/output. For state shared with an interrupt, follow the platform's atomicity and synchronization rules; `volatile` alone does not make an access atomic.
- Keep interrupt service routines short. Set a flag or enqueue data for the main loop to process.
- Use fixed-width types from `<stdint.h>` where width matters.
- Check failures reported by peripheral initialization routines.
