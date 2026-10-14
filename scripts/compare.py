"""Compare benchmark result files written by benchmark.sh.

    python scripts/compare.py results/150rps-b1-w0.json results/150rps-b16-w0.json

The first file is the baseline; every other row shows its change vs. that.
"""
import json
import sys
from pathlib import Path

paths = [Path(p) for p in sys.argv[1:]]
if not paths:
    sys.exit(__doc__)
rows = [(p.stem, json.loads(p.read_text())) for p in paths]
cols = ["success_pct", "achieved_rps", "ingress_p99_ms", "e2e_p50_ms", "e2e_p90_ms", "e2e_p99_ms", "e2e_mean_ms"]

width = max(len(name) for name, _ in rows) + 2
print("\n" + "config".ljust(width) + "".join(c.rjust(15) for c in cols))
for name, r in rows:
    print(name.ljust(width) + "".join(f"{r[c]:15.2f}" for c in cols))

base_name, base = rows[0]
for name, r in rows[1:]:
    changes = []
    for c in ("e2e_p50_ms", "e2e_mean_ms", "e2e_p99_ms"):
        if base[c]:
            delta = 100 * (r[c] - base[c]) / base[c]
            changes.append(f"{c} {delta:+.1f}%")
    print(f"{name} vs {base_name}: " + ", ".join(changes))
