---
name: embedded-user-context-first
description: Use when the user supplies pin, peripheral, or register details for an embedded target and asks for code or help. Work from the given details first; only consult the datasheet with permission.
placement: append
order: 50
---

# Embedded: user-supplied details first

## Rule
When the user gives pin or hardware details that normally live in the datasheet, answer the request using exactly those details.

- Do not go hunting for the datasheet or other sources on your own. Unrequested research wastes effort and can send you and the user down the wrong path.
- If extra research would help, say what you would look up and why, then wait for the user's OK.

## Exception: high-risk registers
If the user's request conflicts with a protected or lock-gated register (e.g. GPIOLOCK / GPIOCR-gated pins such as NMI or JTAG pins):

1. Do not research silently.
2. State the concern in one or two sentences (which pin/register, what could go wrong).
3. Ask for permission to look into it, then proceed per the answer.

## Checklist
- [ ] Used only the user's pin/peripheral details?
- [ ] Any assumption beyond them stated explicitly?
- [ ] Any lock-gated register touched? If so, concern raised first.
