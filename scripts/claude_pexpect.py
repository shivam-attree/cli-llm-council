#!/usr/bin/env python3
"""Run Claude Code via pexpect with terminal I/O passthrough and capture."""

import os
import sys
import pexpect


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: claude_pexpect.py <claude_cmd> [args...]", file=sys.stderr)
        return 2

    cmd = sys.argv[1:]
    prompt = os.environ.get("COUNCIL_PROMPT", "")
    capture_path = os.environ.get("COUNCIL_CAPTURE_PATH", "")
    has_print = "--print" in cmd or "-p" in cmd

    if prompt and has_print:
        # Pass prompt as an argument when using --print to avoid stdin requirement.
        cmd = cmd + [prompt]

    capture_file = None
    if capture_path:
        capture_file = open(capture_path, "w", encoding="utf-8", errors="replace")

    try:
        child = pexpect.spawn(cmd[0], cmd[1:], encoding="utf-8", timeout=None)
        if capture_file:
            class Tee:
                def __init__(self, *files):
                    self.files = files

                def write(self, data):
                    for f in self.files:
                        f.write(data)
                        f.flush()

                def flush(self):
                    for f in self.files:
                        f.flush()

            child.logfile = Tee(sys.stdout, capture_file)
        else:
            child.logfile = sys.stdout

        if prompt and not has_print:
            child.sendline(prompt)

        child.expect(pexpect.EOF)
        return child.exitstatus or 0
    finally:
        if capture_file:
            capture_file.close()


if __name__ == "__main__":
    raise SystemExit(main())
