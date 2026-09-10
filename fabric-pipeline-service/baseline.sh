#!/usr/bin/env bash
# Compare tsc errors in Studio.tsx before and after the working-tree changes,
# so pre-existing failures are not mistaken for new ones.
#
# The working copy is backed up before git restores the committed version, and
# put back in a trap so an interrupted run cannot lose edits.
set -uo pipefail

export PATH="/home/sajeevan/.nvm/versions/node/v24.18.0/bin:$PATH"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

TARGET="src/components/Studio.tsx"
BACKUP="$(mktemp)"
cp "$TARGET" "$BACKUP"

restore() {
  cp "$BACKUP" "$TARGET"
  rm -f "$BACKUP"
}
trap restore EXIT INT TERM

echo "=== AFTER (working tree) ==="
npx tsc --noEmit 2>&1 | grep 'Studio\.tsx' | sed 's/(\([0-9]*\),[0-9]*)/:\1/' > /tmp/tsc_after.txt
echo "Studio.tsx errors: $(wc -l < /tmp/tsc_after.txt)"

git checkout -- "$TARGET"
echo
echo "=== BEFORE (committed) ==="
npx tsc --noEmit 2>&1 | grep 'Studio\.tsx' | sed 's/(\([0-9]*\),[0-9]*)/:\1/' > /tmp/tsc_before.txt
echo "Studio.tsx errors: $(wc -l < /tmp/tsc_before.txt)"

restore
trap - EXIT INT TERM

echo
echo "=== error messages present AFTER but not BEFORE ==="
# Compare on message text only; line numbers shift when code is inserted.
sed 's/^[^ ]*: //' /tmp/tsc_after.txt  | sort | uniq -c | sort -rn > /tmp/msg_after.txt
sed 's/^[^ ]*: //' /tmp/tsc_before.txt | sort | uniq -c | sort -rn > /tmp/msg_before.txt
diff <(sed 's/^ *[0-9]* //' /tmp/msg_before.txt | sort -u) \
     <(sed 's/^ *[0-9]* //' /tmp/msg_after.txt  | sort -u) \
  | grep '^>' || echo "(no new error kinds)"

echo
echo "=== count delta by message ==="
join -j 2 -a 2 -o 0,1.1,2.1 \
  <(sort -k2 /tmp/msg_before.txt) <(sort -k2 /tmp/msg_after.txt) 2>/dev/null \
  | awk '{ b = ($2 == "" ? 0 : $2); a = $3; if (a != b) print a - b, $0 }' | head -20
