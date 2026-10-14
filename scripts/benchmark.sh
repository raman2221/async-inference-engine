#!/usr/bin/env bash
# Compare dynamic batching against one-request-at-a-time on the same load.
#
#   scripts/benchmark.sh [RPS] [DURATION_S] [BATCH_SIZES...]
#   scripts/benchmark.sh 150 30 1 16
#
# For each batch size: restart the worker with MAX_BATCH_SIZE=N, reset the
# stats, drive the gateway with the C++ load tester, and save a JSON summary
# to results/batch<N>.json. Prints a comparison table at the end.
set -euo pipefail
cd "$(dirname "$0")/.."

RPS=${1:-150}
DURATION=${2:-30}
shift $(( $# > 2 ? 2 : $# ))
SIZES=("$@")
[ ${#SIZES[@]} -eq 0 ] && SIZES=(1 16)
PYTHON=$(command -v python3 || command -v python)

mkdir -p results
docker compose up -d --build rabbitmq redis gateway notifier
docker compose --profile tools build loadtest

for size in "${SIZES[@]}"; do
  echo
  echo "=== MAX_BATCH_SIZE=$size  rps=$RPS  duration=${DURATION}s ==="
  MAX_BATCH_SIZE=$size docker compose up -d --force-recreate worker
  # Wait until the worker has loaded the model and started consuming.
  until docker compose logs worker 2>/dev/null | grep -q "consuming"; do sleep 1; done
  docker compose exec -T redis redis-cli DEL stats:worker > /dev/null
  docker compose exec -T rabbitmq rabbitmqctl purge_queue inference.requests > /dev/null

  docker compose run --rm loadtest --url http://gateway:8080 --rps "$RPS" --duration "$DURATION" \
    --collect 1500 --collect-timeout 600 --out "/results/batch${size}.json"
  docker compose exec -T redis redis-cli HGETALL stats:worker | paste - - | sed 's/^/  stats  /'
done

"$PYTHON" scripts/compare.py "${SIZES[@]}"
