"""Print a comparison table from results/batch<N>.json files written by benchmark.sh."""
import json
import sys

sizes = sys.argv[1:] or ["1", "16"]
rows = [(s, json.load(open(f"results/batch{s}.json"))) for s in sizes]
cols = ["success_pct", "achieved_rps", "ingress_p99_ms", "e2e_p50_ms", "e2e_p90_ms", "e2e_p99_ms", "e2e_mean_ms"]

print("\n" + "batch".ljust(7) + "".join(c.rjust(16) for c in cols))
for size, r in rows:
    print(str(size).ljust(7) + "".join(f"{r[c]:16.2f}" for c in cols))

if len(rows) >= 2:
    (base_size, base), (best_size, best) = rows[0], rows[-1]
    for c in ("e2e_p50_ms", "e2e_mean_ms", "e2e_p99_ms"):
        if base[c]:
            print(f"{c}: {100 * (1 - best[c] / base[c]):.1f}% lower with batch={best_size} vs batch={base_size}")
