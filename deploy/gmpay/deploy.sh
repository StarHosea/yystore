#!/usr/bin/env bash
set -euo pipefail
revision=${1:?deployment revision is required}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]]
cd /opt/gmpay
test -f data/gmpay.sqlite
install -d -m 700 backups
previous_image=$(docker inspect --format '{{.Config.Image}}' gmpay-edge 2>/dev/null || true)
docker compose -f /tmp/compose.yml pull
if [[ -n "$previous_image" ]]; then
  docker stop --time 60 gmpay-edge
  if ! docker run --rm --network none --user 0 \
    -e GMPAY_DATA_DIR=/var/lib/gmpay \
    -v /opt/gmpay/data:/var/lib/gmpay \
    -v /opt/gmpay/backups:/backups \
    "$previous_image" bun run data -- backup --output "/backups/$(date -u +%Y%m%dT%H%M%SZ)-$revision"; then
    docker start gmpay-edge
    exit 1
  fi
fi
if [[ -f compose.yml ]]; then cp -p compose.yml compose.previous.yml; fi
install -m 600 /tmp/compose.yml compose.yml
docker compose up -d --wait --wait-timeout 90
for attempt in {1..30}; do
  if curl --fail --silent --show-error http://127.0.0.1:18089/healthz >/dev/null; then
    printf '%s\n' "$revision" > deployed-revision
    exit 0
  fi
  sleep 2
done
echo 'Gateway health check failed; inspect container logs before retrying.' >&2
exit 1
