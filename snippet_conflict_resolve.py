#!/usr/bin/env python3
"""Scan and fix ordering conflicts in pi prompt-snippet frontmatter.

Usage:
    python3 snippet_conflicts.py [--report] [--dir PATH]

Scans a snippets directory (default: extensions/prompt-snippets/snippets
next to this file) for .md files with flat YAML-like frontmatter, mirroring
the parsing semantics of extensions/prompt-snippets/index.ts:

  * The file must start with ``---``; frontmatter is flat ``key: value`` lines
    up to the next ``---``. Keys match /^([A-Za-z][\\w-]*)/, are lowercased,
    and values are trimmed with matching surrounding single/double quotes
    stripped.
  * ``placement`` is "prepend" ONLY when the raw value is exactly
    ``prepend``; anything else (missing, misspelled) is silently "append".
  * ``order`` uses parseInt semantics (leading integer, optional sign);
    missing or unparseable becomes 9999.
  * Display order: prepend group first, then append group; each sorted by
    (order, name). Name ties break case-insensitively first, then by plain
    string comparison (documented choice; close to localeCompare behavior).

A conflict is two or more snippets sharing the same effective placement AND
effective order. A warning flags missing/invalid placement or order values.

Modes:
  --report   Non-interactive: print the sorted list, conflicts, and warnings.
             Exit codes: 2 on scan errors, 1 if any conflicts, else 0.
  (default)  Interactive curses TUI to edit orders/placements and save.

Saving rewrites ONLY the placement:/order: frontmatter lines of modified
files (preserving the key's original casing, spacing, and line position;
missing keys are inserted before the closing ---). All other bytes are kept
identical. Writes go to a temp file in the same directory via os.replace().
"""

from __future__ import annotations

import argparse
import curses
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

DEFAULT_ORDER = 9999
DEFAULT_SNIPPETS_DIR = Path(__file__).resolve().parent / "extensions" / "prompt-snippets" / "snippets"
VALID_PLACEMENTS = ("prepend", "append")

# Mirrors the extension's frontmatter key regex.
KEY_RE = re.compile(r"^([A-Za-z][\w-]*)\s*:\s*(.*)$")
# parseInt semantics: optional leading whitespace, optional sign, leading digits.
LEADING_INT_RE = re.compile(r"^\s*([+-]?\d+)")


@dataclass
class Snippet:
    """One parsed snippet file. Effective placement/order are mutable and are
    what the TUI edits; original raw values and line indexes let saving be
    surgical."""

    path: Path
    filename: str
    lines: list[str]  # raw file lines with line endings preserved (splitlines(keepends=True))
    fm_end: int  # index of the closing '---' line; missing keys insert before it
    name: str
    description: str
    placement_raw: str | None
    order_raw: str | None
    placement: str  # effective: 'prepend' or 'append'
    order: int  # effective integer
    placement_idx: int | None  # line index of the placement: line, if present
    order_idx: int | None  # line index of the order: line, if present
    placement_prefix: str  # original text before the value, e.g. 'placement:  '
    order_prefix: str

    @property
    def placement_valid(self) -> bool:
        return self.placement_raw in VALID_PLACEMENTS

    @property
    def order_valid(self) -> bool:
        return parse_order(self.order_raw) is not None

    def sort_key(self) -> tuple[int, int, str, str]:
        # Prepend group (0) before append group (1); then (order, name) with
        # name compared case-insensitively first, then case-sensitively.
        group = 0 if self.placement == "prepend" else 1
        return (group, self.order, self.name.casefold(), self.name)

    def proposed_lines(self) -> list[str]:
        """Return the file lines with the current effective placement/order
        applied. Unrelated lines (body, other fields, trailing newline) are
        returned byte-identical."""
        lines = list(self.lines)
        pending_insert: list[str] = []
        if self.placement_idx is not None:
            lines[self.placement_idx] = f"{self.placement_prefix}{self.placement}\n"
        else:
            pending_insert.append(f"placement: {self.placement}\n")
        if self.order_idx is not None:
            lines[self.order_idx] = f"{self.order_prefix}{self.order}\n"
        else:
            pending_insert.append(f"order: {self.order}\n")
        if pending_insert:
            lines[self.fm_end:self.fm_end] = pending_insert
        return lines

    def is_dirty(self) -> bool:
        return self.proposed_lines() != self.lines

    def save(self) -> bool:
        """Write proposed lines atomically if they differ from disk. Returns
        True if a write happened."""
        new_lines = self.proposed_lines()
        if new_lines == self.lines:
            return False
        fd, tmp = tempfile.mkstemp(prefix=self.filename + ".", suffix=".tmp", dir=self.path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
                fh.writelines(new_lines)
            os.replace(tmp, self.path)
        except BaseException:
            os.unlink(tmp)
            raise
        self.lines = new_lines
        return True


def strip_quotes(value: str) -> str:
    """Trim whitespace and strip one layer of matching surrounding quotes."""
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    return value


def parse_order(raw: str | None) -> int | None:
    """Leading-integer (parseInt) semantics; None if missing/unparseable."""
    if raw is None:
        return None
    match = LEADING_INT_RE.match(raw)
    if match is None:
        return None
    return int(match.group(1))


def load_snippets(directory: Path) -> tuple[list[Snippet], list[str]]:
    """Parse every .md file in directory. Returns (snippets, scan_errors)."""
    snippets: list[Snippet] = []
    errors: list[str] = []
    for path in sorted(directory.glob("*.md")):
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            errors.append(f"{path.name}: unreadable ({exc})")
            continue
        lines = text.splitlines(keepends=True)
        if not lines or lines[0].rstrip("\r\n") != "---":
            errors.append(f"{path.name}: missing opening '---' frontmatter line")
            continue
        try:
            fm_end = next(
                i for i in range(1, len(lines)) if lines[i].rstrip("\r\n") == "---"
            )
        except StopIteration:
            errors.append(f"{path.name}: missing closing '---' frontmatter line")
            continue
        fields: dict[str, str] = {}
        key_idx: dict[str, int] = {}
        key_prefix: dict[str, str] = {}
        for i in range(1, fm_end):
            match = KEY_RE.match(lines[i].rstrip("\r\n"))
            if match is None:
                continue
            key = match.group(1).lower()
            fields[key] = strip_quotes(match.group(2))
            key_idx[key] = i
            key_prefix[key] = lines[i][: match.start(2)]
        placement_raw = fields.get("placement")
        order_raw = fields.get("order")
        order = parse_order(order_raw)
        snippets.append(
            Snippet(
                path=path,
                filename=path.name,
                lines=lines,
                fm_end=fm_end,
                name=fields.get("name") or path.stem,
                description=fields.get("description", ""),
                placement_raw=placement_raw,
                order_raw=order_raw,
                placement="prepend" if placement_raw == "prepend" else "append",
                order=order if order is not None else DEFAULT_ORDER,
                placement_idx=key_idx.get("placement"),
                order_idx=key_idx.get("order"),
                placement_prefix=key_prefix.get("placement", "placement: "),
                order_prefix=key_prefix.get("order", "order: "),
            )
        )
    return snippets, errors


def find_conflicts(snippets: list[Snippet]) -> list[list[Snippet]]:
    """Conflict groups: same effective placement AND order, 2+ snippets."""
    groups: dict[tuple[str, int], list[Snippet]] = {}
    for snippet in snippets:
        groups.setdefault((snippet.placement, snippet.order), []).append(snippet)
    return [sorted(group, key=lambda s: s.sort_key()) for group in groups.values() if len(group) > 1]


def collect_warnings(snippets: list[Snippet]) -> list[str]:
    warnings: list[str] = []
    for snippet in sorted(snippets, key=lambda s: s.filename):
        if not snippet.placement_valid:
            raw = snippet.placement_raw if snippet.placement_raw is not None else "<missing>"
            warnings.append(
                f"{snippet.filename}: invalid placement {raw!r} "
                f"(extension treats non-'prepend' as append)"
            )
        if not snippet.order_valid:
            raw = snippet.order_raw if snippet.order_raw is not None else "<missing>"
            warnings.append(
                f"{snippet.filename}: invalid order {raw!r} (extension uses {DEFAULT_ORDER})"
            )
    return warnings


def count_dirty(snippets: list[Snippet]) -> int:
    return sum(1 for snippet in snippets if snippet.is_dirty())


def report(directory: Path, snippets: list[Snippet], errors: list[str]) -> int:
    print(f"Scanned {len(snippets)} snippets from {directory}\n")
    print("Display order (prepend group, then append group; each by order, name):")
    current_group: str | None = None
    for snippet in sorted(snippets, key=lambda s: s.sort_key()):
        if snippet.placement != current_group:
            current_group = snippet.placement
            print(f"  [{current_group}]")
        order_disp = str(snippet.order) if snippet.order_valid else f"{snippet.order} (!{snippet.order_raw})"
        place_disp = snippet.placement if snippet.placement_valid else f"{snippet.placement} (!{snippet.placement_raw})"
        print(f"  {order_disp:>6} {place_disp:<7} {snippet.name}  ({snippet.filename})")
    conflicts = find_conflicts(snippets)
    print(f"\nConflicts ({len(conflicts)}):")
    for group in conflicts:
        placement, order = group[0].placement, group[0].order
        files = ", ".join(s.filename for s in group)
        print(f"  {placement} order {order}: {files}")
    warnings = collect_warnings(snippets)
    print(f"\nWarnings ({len(warnings)}):")
    for warning in warnings:
        print(f"  {warning}")
    if errors:
        print("\nScan errors:")
        for error in errors:
            print(f"  {error}")
        return 2
    return 1 if conflicts else 0


def next_free_order(used: set[int]) -> int:
    """Smallest positive integer not in `used` (the chosen resolution scheme:
    packs conflict fixes into the first gap rather than stepping by 10)."""
    candidate = 1
    while candidate in used:
        candidate += 1
    return candidate


def propose_resolution(
    group: list[Snippet], all_snippets: list[Snippet]
) -> list[tuple[Snippet, int]]:
    """For a conflict group: keep the alphabetically-first-named snippet at
    the current order; suggest the next free positive order (per
    next_free_order) in that placement group for each other member,
    accounting for suggestions already made."""
    ordered = sorted(group, key=lambda s: (s.name.casefold(), s.name))
    used = {
        s.order for s in all_snippets if s.placement == group[0].placement
    }
    suggestions: list[tuple[Snippet, int]] = []
    for snippet in ordered[1:]:
        free = next_free_order(used)
        used.add(free)
        suggestions.append((snippet, free))
    return suggestions


# ---- Curses TUI ------------------------------------------------------------

MIN_ROWS = 8
MIN_COLS = 40

HELP = "keys: up/dn/k/j move  +/- order  v set order  p placement  r resolve  s save  q quit"


def build_rows(snippets: list[Snippet]) -> list[tuple[str, object]]:
    """Display rows: ('header', label) or ('row', snippet), in display order."""
    rows: list[tuple[str, object]] = []
    for placement in ("prepend", "append"):
        rows.append(("header", placement))
        group = sorted(
            (s for s in snippets if s.placement == placement), key=lambda s: s.sort_key()
        )
        rows.extend(("row", s) for s in group)
    return rows


def run_tui(stdscr: "curses._CursesWindow", directory: Path, snippets: list[Snippet]) -> None:
    curses.curs_set(0)
    if curses.has_colors():
        curses.start_color()
        curses.init_pair(1, curses.COLOR_RED, curses.COLOR_BLACK)
    conflict_attr = curses.color_pair(1) | curses.A_BOLD if curses.has_colors() else curses.A_REVERSE

    select_idx = 0  # index into the current display-order snippet list
    scroll = 0  # first visible row index in the row list
    quit_armed = False
    message = ""

    while True:
        maxy, maxx = stdscr.getmaxyx()
        stdscr.erase()
        if maxy < MIN_ROWS or maxx < MIN_COLS:
            stdscr.addnstr(0, 0, f"Terminal too small ({maxy}x{maxx}); need at least {MIN_ROWS}x{MIN_COLS}.", maxx - 1)
            stdscr.refresh()
            key = stdscr.getch()
            if key in (ord("q"), ord("Q")):
                return
            continue

        conflicts = find_conflicts(snippets)
        conflicted_ids = {id(s) for group in conflicts for s in group}
        warnings = collect_warnings(snippets)
        rows = build_rows(snippets)
        selectable = [payload for kind, payload in rows if kind == "row"]

        # Header, list, status, footer.
        title = f"Snippet conflicts — {directory}"
        stdscr.addnstr(0, 0, title, maxx - 1, curses.A_BOLD)
        list_top, list_bottom = 1, maxy - 3
        visible = list_bottom - list_top
        select_idx = max(0, min(select_idx, len(selectable) - 1))
        selected_snippet = selectable[select_idx] if selectable else None
        # Row index of the selected snippet, then scroll so it stays visible.
        selected_row = next(
            (i for i, (kind, payload) in enumerate(rows)
             if kind == "row" and payload is selected_snippet),
            0,
        )
        if selected_row < scroll:
            scroll = selected_row
        elif selected_row >= scroll + visible:
            scroll = selected_row - visible + 1
        scroll = max(0, min(scroll, max(0, len(rows) - visible)))

        for screen_y, (kind, payload) in enumerate(
            rows[scroll:scroll + visible], start=list_top
        ):
            if kind == "header":
                stdscr.addnstr(
                    screen_y, 0, f"-- {payload} --", maxx - 1, curses.A_UNDERLINE
                )
                continue
            snippet = payload  # type: ignore[assignment]
            order_disp = str(snippet.order) if snippet.order_valid else f"{snippet.order}(!{snippet.order_raw})"
            place_disp = snippet.placement if snippet.placement_valid else f"{snippet.placement}(!{snippet.placement_raw})"
            marker = "*" if snippet.is_dirty() else " "
            attr = conflict_attr if id(snippet) in conflicted_ids else curses.A_NORMAL
            if snippet is selected_snippet:
                attr |= curses.A_REVERSE
            line = f"{marker} {order_disp:>5} {place_disp:<7} {snippet.name}  ({snippet.filename})"
            stdscr.addnstr(screen_y, 0, line, maxx - 1, attr)

        status = (
            f"{len(conflicts)} conflicts, {len(warnings)} warnings, "
            f"{count_dirty(snippets)} unsaved changes"
        )
        if message:
            status += f" — {message}"
        stdscr.addnstr(maxy - 2, 0, status, maxx - 1, curses.A_BOLD)
        stdscr.addnstr(maxy - 1, 0, HELP, maxx - 1, curses.A_DIM)
        stdscr.refresh()

        message = ""
        key = stdscr.getch()
        if key == curses.KEY_RESIZE:
            continue  # next loop redraws at the new size
        if key in (curses.KEY_UP, ord("k")):
            select_idx = max(0, select_idx - 1)
            quit_armed = False
        elif key in (curses.KEY_DOWN, ord("j")):
            select_idx = min(len(selectable) - 1, select_idx + 1)
            quit_armed = False
        elif key in (ord("+"), ord("=")) and selectable:
            selectable[select_idx].order += 1
            quit_armed = False
        elif key in (ord("-"), ord("_")) and selectable:
            selectable[select_idx].order -= 1
            quit_armed = False
        elif key in (ord("v"), ord("V")) and selectable:
            snippet = selectable[select_idx]
            prompt = f"Set order for {snippet.filename} (current {snippet.order}): "
            stdscr.addnstr(maxy - 2, 0, " " * (maxx - 1), maxx - 1)
            stdscr.addnstr(maxy - 2, 0, prompt, maxx - 1, curses.A_BOLD)
            stdscr.refresh()
            curses.echo()
            try:
                raw = stdscr.getstr(maxy - 2, min(len(prompt), maxx - 2), 16)
            finally:
                curses.noecho()
            text = raw.decode("utf-8", errors="replace").strip()
            if text:
                try:
                    new_order = int(text, 10)
                except ValueError:
                    message = f"invalid order: {text!r}"
                else:
                    if new_order != snippet.order:
                        # Swap instead of overwrite: the snippet already holding
                        # new_order in the same placement group takes the old
                        # value, so a unique-target move cannot create a conflict.
                        holder = next(
                            (
                                s
                                for s in snippets
                                if s is not snippet
                                and s.placement == snippet.placement
                                and s.order == new_order
                            ),
                            None,
                        )
                        if holder is not None:
                            holder.order, snippet.order = snippet.order, new_order
                            message = (
                                f"swapped: {snippet.filename} -> {snippet.order}, "
                                f"{holder.filename} -> {holder.order}"
                            )
                        else:
                            snippet.order = new_order
                            message = f"{snippet.filename} order set to {snippet.order}"
            quit_armed = False
        elif key in (ord("p"), ord("P")) and selectable:
            snippet = selectable[select_idx]
            snippet.placement = "append" if snippet.placement == "prepend" else "prepend"
            quit_armed = False
        elif key in (ord("r"), ord("R")):
            for group in find_conflicts(snippets):
                for snippet, suggested in propose_resolution(group, snippets):
                    prompt = (
                        f"Move {snippet.filename} from order {snippet.order} to {suggested}? [y/n]  "
                    )
                    stdscr.addnstr(maxy - 2, 0, " " * (maxx - 1), maxx - 1)
                    stdscr.addnstr(maxy - 2, 0, prompt, maxx - 1, curses.A_BOLD)
                    stdscr.refresh()
                    answer = stdscr.getch()
                    if answer in (ord("y"), ord("Y")):
                        snippet.order = suggested
            quit_armed = False
        elif key in (ord("s"), ord("S")):
            saved = sum(1 for snippet in snippets if snippet.save())
            message = f"wrote {saved} file(s)"
            quit_armed = False
        elif key in (ord("q"), ord("Q")):
            if count_dirty(snippets) > 0 and not quit_armed:
                message = "unsaved changes — press q again to quit without saving"
                quit_armed = True
            else:
                return
        else:
            quit_armed = False


def curses_tui(directory: Path, snippets: list[Snippet]) -> None:
    curses.wrapper(run_tui, directory, snippets)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Scan and fix prompt-snippet ordering conflicts."
    )
    parser.add_argument(
        "--report",
        action="store_true",
        help="non-interactive report (exit 1 on conflicts, 2 on scan errors)",
    )
    parser.add_argument(
        "--dir",
        type=Path,
        default=DEFAULT_SNIPPETS_DIR,
        help=f"snippets directory (default: {DEFAULT_SNIPPETS_DIR})",
    )
    args = parser.parse_args(argv)

    if not args.dir.is_dir():
        print(f"error: not a directory: {args.dir}", file=sys.stderr)
        return 2
    snippets, errors = load_snippets(args.dir)
    if args.report:
        return report(args.dir, snippets, errors)
    curses_tui(args.dir, snippets)
    return 0


if __name__ == "__main__":
    sys.exit(main())
