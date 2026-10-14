#!/usr/bin/env bash
# Benchmark batching configurations under the same offered load.
#
#   scripts/benchmark.sh RPS DURATION_S CONFIG [CONFIG...]
#   scripts/benchmark.sh 150 30 1:0 16:50 16:0
#
# Each CONFIG is MAX_BATCH_SIZE:MAX_WAIT_MS. For each one: restart the worker
# with those settings, reset stats and the queue, drive the gateway with the
# C++ load tester, and save results/<rps>rps-b<size>-w<wait>.json.
# Prints a comparison table at the end (first config = baseline).
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1  # stop Git Bash on Windows rewriting /results paths

RPS=${1:-150}
DURATION=${2:-30}
shift $(( $# > 2 ? 2 : $# ))
CONFIGS=("$@")
[ ${#CONFIGS[@]} -eq 0 ] && CONFIGS=(1:0 16:50 16:0)

# First interpreter that actually runs (Windows ships a python3 Store stub).
PYTHON=""
for candidate in python3 python; do
  if "$candidate" -c "" > /dev/null 2>&1; then PYTHON=$candidate; break; fi
done

mkdir -p results
docker compose up -d --build rabbitmq redis gateway notifier
docker compose --profile tools build loadtest

FILES=()
for config in "${CONFIGS[@]}"; do
  size=${config%%:*}
  wait_ms=${config##*:}
  name="${RPS}rps-b${size}-w${wait_ms}"
  echo
  echo "=== MAX_BATCH_SIZE=$size MAX_WAIT_MS=$wait_ms  rps=$RPS  duration=${DURATION}s ==="
  MAX_BATCH_SIZE=$size MAX_WAIT_MS=$wait_ms docker compose up -d --force-recreate worker
  # Wait until the worker has loaded the model and started consuming.
  until docker compose logs worker 2>/dev/null | grep -q "consuming"; do sleep 1; done
  docker compose exec -T redis redis-cli DEL stats:worker > /dev/null
  docker compose exec -T rabbitmq rabbitmqctl purge_queue inference.requests > /dev/null

  docker compose run --rm loadtest --url http://gateway:8080 --rps "$RPS" --duration "$DURATION" \
    --collect 1500 --collect-timeout 600 --out "/results/${name}.json"
  docker compose exec -T redis redis-cli HGETALL stats:worker | paste - - | sed 's/^/  stats  /'
  FILES+=("results/${name}.json")
done

if [ -n "$PYTHON" ]; then
  "$PYTHON" scripts/compare.py "${FILES[@]}"
else
  echo "python not found; raw results in results/"
fi
