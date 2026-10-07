---
name: c-iwyu-audit
description: Use when writing, reviewing, or cleaning up C code in this embedded codebase. Covers strict IWYU include audits, uart.c commentary matching led.c, and the C99-compatible subset of the Google style guide.
placement: append
order: 60
---

# Strict IWYU audit and example-comment style

## Strict IWYU
- Every `.c` file includes exactly the headers it uses itself.
- A header includes only what its own prototypes and types need. Example: `gpio.h` must not include `memory_map.h` unless its prototypes use types from it; each `.c` that needs the memory map includes it directly.
- If a header already works a certain way and a strict fix would be disproportionate, take the pragmatic choice that matches the existing header, and say so.

## Audit procedure (`include/` and `src/`)
1. List each header's includes and check each is used by that header's declarations.
2. List each `.c` file's used symbols and confirm every needed header is included directly, not via another header.
3. Remove unused or transitively-relied-on includes; add the missing direct ones.
4. Report a short before/after list of changes, noting any pragmatic exceptions.

# Google style guide, C99 subset

Source: https://google.github.io/styleguide/cppguide.html. Only rules that are valid C99 are applied (C11 only where noted). C++-only rules (classes, namespaces, templates, exceptions, `auto`, `constexpr`, casts like `static_cast`, etc.) are out of scope.

**Precedence:** an explicit user instruction beats this list, and existing conventions in the codebase beat it too. Apply it to code you are writing or already editing; do not mass-reformat untouched files unless asked.

## Headers
- Guard every header: `#ifndef PROJECT_PATH_FILE_H_` / `#define ...` / `#endif  // PROJECT_PATH_FILE_H_`. Do not use leading underscores (reserved).
- Headers must be self-contained (compile on their own) and contain only declarations, plus short `static inline` functions (about 10 lines or fewer).
- Avoid forward declarations; include the header instead (see strict IWYU above). Opaque struct tags are fine only when the type is intentionally opaque.
- Include order in a `.c` file, with a blank line between groups, sorted alphabetically within each group:
  1. its own header (e.g. `uart.h` in `uart.c`)
  2. C standard / system headers (`<stdint.h>`, `<stdbool.h>`, `<stddef.h>`)
  3. other libraries
  4. project headers
- Use `<...>` for system headers and `"..."` for project headers.

## Naming
- File names: lowercase with underscores (`uart.c`, `memory_map.h`).
- Variables and parameters: `lower_snake_case`.
- Macros and enumerators: `UPPER_SNAKE_CASE`, prefixed with the module name since C has no namespaces.
- Functions and types: prefix with the module name (e.g. `uart_init`) and follow the casing the codebase already uses; do not rename existing ones unasked.

## Scope and variables
- Declare variables in the narrowest scope, at first use, and initialize them at declaration (C99 allows this).
- Minimize file-scope and global state; make anything file-local `static`.
- Use `const` wherever a value or pointed-to data is not modified, written `const int *p` (const first).
- Use `NULL` for pointers, `'\0'` for chars, `0` for integers. `nullptr` does not exist in C.

Supplemental design advice (not Google rules), adapted to C99 from
[How to write the perfect function](https://www.youtube.com/watch?v=2OMRWPOSw9s):
- Make inputs and outputs explicit: pass needed values or state pointers; use return values and clearly documented output/in-out pointers. Caller-visible mutation is fine when part of the contract (11:12–11:41, 14:24–14:46).
- Avoid hidden dependencies on mutable globals or call order. Pass a focused context when practical; document required initialization and unavoidable hardware/shared state. `static` limits linkage, not state coupling (23:43–25:55, 28:53–29:19).
- Separate computation from I/O and register effects where practical so logic can be tested independently. Keep necessary effects at clear boundaries; respect memory/timing constraints rather than buffering every result (18:27–21:45).
- State required invariants and establish them through checked initialization or validation. Use focused structs/opaque APIs where useful, but do not claim a C typedef or public struct enforces validity; report invalid inputs or assert internal preconditions (32:00–34:53).

## Types
- Use `<stdint.h>` fixed-width types (`uint32_t`, `uint8_t`) when size matters, `size_t` for sizes and counts, and `<stdbool.h>` `bool` for booleans.
- Use plain `int` only when the exact size is irrelevant. Do not use unsigned types merely to say "never negative".
- Prefer `sizeof(variable)` over `sizeof(type)`.
- Use `volatile` only on memory-mapped registers.
- C11 only: `_Static_assert` is acceptable for compile-time checks such as register-struct sizes.

## Macros
- Prefer `static inline` functions, `enum`, and `static const` over macros.
- For `enums` the choice of the underlying type is implementation-defined. However, the type must not be larger than int unless a value cannot fit in an int or unsigned int
- When a macro is needed (e.g. register addresses and bit masks), give it a module prefix, parenthesize every argument and the whole expansion, and `#undef` it if it is only for local use.
- Do not define macros whose expansion has unbalanced braces or hides control flow.

## Formatting
- Max 80 columns, no trailing whitespace.
- Opening brace on the same line as the statement; `else` on the same line as the closing brace.
- One statement per line. Always give `switch` a `default`, and mark intentional fall-through with a `/* fall through */` comment.
- Pointer alignment: either `char *p` or `char* p`, but be consistent within a file (follow the codebase).
- Spaces around binary operators and after keywords (`if (x)`, not `if(x)`).
- Small offsets, bit indices, small masks (fit int) should be represented with enums
- Full 32-bit base addresses (top bits set) should be represented with #define / static const uint32_t
- Full-width magic keys/masks (bit 31 or > INT_MAX) should be represented with #define / typed constant

## Comments
- `//` and `/* */` are both valid; stay consistent with the file.
- Every file starts with a short comment on its purpose. Every non-trivial function gets a comment saying what it does and how to use it, not how it works.
- Comment non-obvious variables and magic numbers. Do not restate what the code already says.
- Use `TODO(name): text` for known follow-ups.
- In the example files (`led.c`, `uart.c`) the `led.c` commentary style takes precedence over the points above.
