#!/usr/bin/env python3
"""
One-shot migration script: rewrites tests/run-all.js to use the new
withDataFileSnapshotted helper in place of the legacy snapshotChatFile /
restoreChatFile trio.

Pattern detection:
  `const snapshot = snapshotChatFile();`
  optionally followed by  `resetChatFile();`
  then a `try {` opening
  then the body
  then a `} finally { restoreChatFile(snapshot); }`

becomes:
  `withDataFileSnapshotted('chat_sessions.json', () => {`
  then (with resetChatFile() inside the new body)
  then the body (re-indented)
  then `});`

This script is idempotent — if the file is already migrated, it
detects the absence of `snapshotChatFile` call sites and reports so.
"""
import re
import sys
from pathlib import Path

TARGET = Path('/home/david/shadowdog-dev/projects/image-to-prompt/tests/run-all.js')

src = TARGET.read_text()

# Idempotency check
if 'snapshotChatFile(' not in src and 'restoreChatFile(' not in src:
    print('Already migrated — no snapshotChatFile/restoreChatFile references remain.')
    sys.exit(0)

# Strategy: regex-based per-call-site rewrite. We match one call site
# at a time and replace it. The pattern has three pieces:
#
#   const snapshot = snapshotChatFile();
#   [opt: resetChatFile();]
#   try {            <-- opening line
#      ...body...    <-- some lines
#   } finally { restoreChatFile(snapshot); }
#
# We need to capture the indent level of the `try {` so the new
# wrapper is properly indented. We also need to know whether a
# resetChatFile() call exists immediately after `snapshot = ...`.

lines = src.split('\n')
out = []
i = 0
migrated = 0

# We'll do this in passes — each pass replaces one occurrence.
# Pattern in code:
#   LEADING_WS const snapshot = snapshotChatFile();
#   LEADING_WS [optional resetChatFile();]
#   LEADING_WS try {
#       ...body lines (need to find matching `} finally { restoreChatFile(snapshot); }`)
#
# The `try {` and `} finally { restoreChatFile(snapshot); }` must match.
# Brace-counting works here because the body is straightforward JS without
# nested templates / strings that contain `};` etc. — and `restoreChatFile(snapshot)`
# appearing inside a string literal would be caught by the outer pattern.

SNAP_RE = re.compile(r'^(\s*)const snapshot = snapshotChatFile\(\);\s*$')
RESET_RE = re.compile(r'^(\s*)(resetChatFile\(\);\s*)$')
TRY_OPEN_RE = re.compile(r'^(\s*)try \{\s*$')
FINALLY_RE = re.compile(r'^(\s*)\} finally \{\s*$')
RESTORE_RE = re.compile(r'^(\s*)restoreChatFile\(snapshot\);\s*$')
FINALLY_CLOSE_RE = re.compile(r'^(\s*)\}\s*$')

while i < len(lines):
    line = lines[i]
    sm = SNAP_RE.match(line)
    if not sm:
        out.append(line)
        i += 1
        continue

    indent = sm.group(1)
    j = i + 1
    has_reset = False

    # optional resetChatFile()
    rm = RESET_RE.match(lines[j]) if j < len(lines) else None
    if rm and rm.group(1) == indent:
        has_reset = True
        j += 1

    # require `try {`
    tm = TRY_OPEN_RE.match(lines[j]) if j < len(lines) else None
    if not tm or tm.group(1) != indent:
        # Pattern doesn't match — emit line as-is and continue
        out.append(line)
        i += 1
        continue

    j += 1  # past `try {`

    # Now find the matching `} finally { restoreChatFile(snapshot); }`
    # We expect: `} finally {` line, `restoreChatFile(snapshot);` line, `}` line.
    body_lines = []
    found = False
    while j < len(lines):
        fm = FINALLY_RE.match(lines[j])
        if fm and fm.group(1) == indent:
            j += 1  # past `} finally {`
            rrm = RESTORE_RE.match(lines[j]) if j < len(lines) else None
            if rrm and rrm.group(1) == indent:
                j += 1  # past `restoreChatFile(snapshot);`
                cm = FINALLY_CLOSE_RE.match(lines[j]) if j < len(lines) else None
                if cm and cm.group(1) == indent:
                    found = True
                    j += 1  # past `}`
                    break
        body_lines.append(lines[j])
        j += 1

    if not found:
        # Couldn't find the matching finally block — emit the snapshot line
        # unchanged and rewind. This shouldn't happen on a well-formed test file.
        out.append(line)
        i += 1
        continue

    # Strip one level of indent from each body line (the body was inside try {).
    # Find the minimum indent of non-empty body lines.
    body_indents = [len(b) - len(b.lstrip(' ')) for b in body_lines if b.strip()]
    if body_indents:
        dedent = min(body_indents)
    else:
        dedent = 0

    # Build the replacement
    open_indent = indent
    body_indent = indent + '  '  # two spaces inside the arrow function

    out.append(f"{open_indent}withDataFileSnapshotted('chat_sessions.json', () => {{")
    if has_reset:
        # resetChatFile() goes inside the new body, same dedent as body lines
        out.append(f"{body_indent}resetChatFile();")
    for bl in body_lines:
        if not bl.strip():
            out.append('')
        else:
            # Dedent by dedent spaces
            if len(bl) >= dedent:
                out.append(bl[dedent:])
            else:
                out.append(bl.lstrip())
    out.append(f"{open_indent}}});")
    migrated += 1
    i = j

new_src = '\n'.join(out)
TARGET.write_text(new_src)
print(f"Migrated {migrated} call site(s).")
