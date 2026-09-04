#!/usr/bin/env bash
# Typecheck the repo with the nvm node on PATH.
#
# Kept as a script because the Windows-side shell interop mangles inline
# `export PATH=...` and `$VAR` expansion when invoking wsl.exe.
set -uo pipefail

export PATH="/home/sajeevan/.nvm/versions/node/v24.18.0/bin:$PATH"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

OUT="$(npx tsc --noEmit 2>&1)"

echo "=== errors in files touched by the fabric pipeline work ==="
echo "$OUT" | grep -E 'fabricPipeline|api/fabric|Studio\.tsx' || echo "(none)"

echo
echo "=== totals ==="
echo "all errors:              $(echo "$OUT" | grep -c 'error TS')"
echo "Studio.tsx errors:       $(echo "$OUT" | grep -c 'Studio\.tsx')"
echo "fabric pipeline errors:  $(echo "$OUT" | grep -cE 'fabricPipeline|api/fabric')"
