---
name: programming-guidelines
description: Coding conventions for all projects — Docker-first workflow, naming consistency, DRY principle, code structure, clean imports, self-documenting code, and strict scope adherence. Use when implementing features, reviewing code, or writing scripts.
placement: prepend
order: 40
---

# Programming Guidelines

When implementing code, make sure to abide to the following guidelines:

- Docker Environment and Package manager: Always check for the existence of Dockerfile and docker-compose.yml .env or package manager. If no docker files exists then don't enforce a docker enviornemtn unless the user desires it. However, if it does exists, run all commands inside Docker containers. Avoid rebuilding images unless the Dockerfile or requirements.txt has been modified.
- Naming Consistency: strictly follow the codebase's existing naming conventions. If unsure or no conaming convention is established, use PascalCase for Class names and snake_case for methods. If the existing code uses camelCase for variables, stick to that convention.
- The DRY Principle: Emphasize "Don't Repeat Yourself." Ensure every piece of knowledge or logic has a single, authoritative representation to minimize duplication and maintenance overhead.
- Code Structure & Constants: Move all code snippets, assertion strings, and shared constants (e.g., SEED_FILENAME, SCRATCH_FILENAME) to the top of the script to eliminate "magic strings" within the logic.
- Avoiding lazy import (language specific): Avoid using lazy imports unless they are strictly required for backward compatibility in live deployments.
- Formatting for Isolation: Use textwrap.dedent on triple-quoted code blocks. This ensures the code remains clean for execution in sandboxes while allowing for visual indentation within the script.
- Self-Documenting Code: Prioritize extremely descriptive variable and function names to reduce the need for comments. Reserve comment blocks only for highly complex logic or simple, trusted boilerplate where reading the underlying code is unnecessary.
- External Documentation: Do not include multi-line description comment blocks for functions and methods. Instead, log the function/class name and its description in an established markdown file (e.g., toc.md or README.md) within the appropriate table of contents and give a one-line description for the functions and methods in the code. This way a quick and token-efficient reference points can be established instead of diving through the code base.
- Strict Scope Adherence: When assigned a specific simple task, such as revising a code snippet, follow the command exactly. Do not perform actions outside the requested scope or provide suggestions unless they are absolutely necessary.
- PROGRAMMATIC OVER INDIVIDUAL: For complex logic or multiple file operations, favor programmatic scripting solutions (`python_exec`). However, for simple edits or bootstrapping environment files (e.g., `Dockerfile`, `docker-compose.yml`, `.env`), individual file tools are preferred for speed and reliability.
- Keep to a max of 1000 line of code per file. Too large of a file introduces higher odds of mistakes, being cumbersome for development, and higher friction of maintainence.
- If a testing system is implemented, such as ci/cd, unit test, regression tests, etc. Make sure that the tests folder has a test fixture in place that all tests are performed on. Do not perform the test on arbitrary folders and files just because the engineer pasted an example with a new directory unless permission is granted.