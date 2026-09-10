"""Pull a subset of VITON-HD for evaluation.

  .venv/bin/python fetch_dataset.py [n]

SaffalPoosh/VITON-HD-test (Apache-2.0 on the Hub) pairs each photo of a person
with the flat product shot of the garment they are wearing, plus a ground-truth
human parsing map. That pairing is what makes it worth using here: it is the
only way to check that fabric copied off a worn photo actually matches the real
garment, rather than merely looking plausible.

Streamed rather than downloaded -- the full split is ~730MB and a few dozen
pairs is plenty.

Note the upstream VITON-HD release is research-use; the data stays local and
`testdata/` is gitignored.
"""

from __future__ import annotations

import sys
from pathlib import Path

OUT = Path("testdata/vitonhd")


def main() -> int:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 40

    from datasets import load_dataset

    print(f"streaming SaffalPoosh/VITON-HD-test, taking {n} pairs...")
    ds = load_dataset("SaffalPoosh/VITON-HD-test", split="train", streaming=True)

    (OUT / "worn").mkdir(parents=True, exist_ok=True)
    (OUT / "flat").mkdir(parents=True, exist_ok=True)
    (OUT / "parse").mkdir(parents=True, exist_ok=True)

    kept = 0
    for i, row in enumerate(ds):
        if kept >= n:
            break
        try:
            worn = row["image"].convert("RGB")
            flat = row["cloth"].convert("RGB")
            parse = row["parse"]
        except Exception as exc:  # noqa: BLE001
            print(f"  skipped {i}: {exc}")
            continue

        tag = f"{kept:03d}"
        worn.save(OUT / "worn" / f"{tag}.jpg", quality=92)
        flat.save(OUT / "flat" / f"{tag}.jpg", quality=92)
        parse.save(OUT / "parse" / f"{tag}.png")
        kept += 1
        if kept % 10 == 0:
            print(f"  {kept} pairs")

    print(f"\n{kept} pairs -> {OUT}/")
    print(f"   worn  {worn.size}   flat {flat.size}   parse {parse.size} mode={parse.mode}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
