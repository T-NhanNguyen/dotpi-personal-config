#!/usr/bin/env python3
"""Serve the trace viewer for this repo's trace vault, without pi.

Usage:
    python3 traces_serve.py [--port 4777] [--trace <trace-id>]

Requires the viewer build: cd trace-viewer && npm install && npm run build
Stop it with Ctrl+C (or /trace-view stop if it was started from pi).
"""

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VIEWER = ROOT / "trace-viewer"
TSX = VIEWER / "node_modules" / ".bin" / "tsx"


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve the interactive trace viewer for .dev-vault/traces.")
    parser.add_argument("--port", type=int, default=4777, help="First port to try (default 4777; the server increments if busy).")
    parser.add_argument("--trace", default="", help="Trace id to open directly.")
    args = parser.parse_args()

    if not TSX.exists() or not (VIEWER / "dist" / "index.html").exists():
        print("Trace viewer is not built. Run: cd trace-viewer && npm install && npm run build", file=sys.stderr)
        return 1

    command = [str(TSX), str(VIEWER / "server.ts"), "--cwd", str(ROOT), "--port", str(args.port)]
    if args.trace:
        command += ["--trace", args.trace]

    proc = subprocess.Popen(command)
    try:
        return proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
        proc.wait()
        return 0


if __name__ == "__main__":
    sys.exit(main())
