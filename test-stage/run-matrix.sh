#!/usr/bin/env bash
set -Eeuo pipefail

stage_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${stage_dir}"

mkdir -p logs
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
log_file="logs/matrix-${timestamp}.log"
result=0

docker compose up -d

services="${STAGE_SERVICES:-node22 node24 node26}"
for service in ${services}; do
  printf '\n[%s] %s\n' "$(date -u +%FT%TZ)" "${service}" | tee -a "${log_file}"
  if ! docker compose exec -T "${service}" /stage/run-tests.sh 2>&1 | tee -a "${log_file}"; then
    result=1
  fi
done

mapfile -t old_logs < <(find logs -maxdepth 1 -type f -name 'matrix-*.log' -printf '%T@ %p\n' | sort -nr | tail -n +21 | cut -d' ' -f2-)
if ((${#old_logs[@]})); then
  rm -f -- "${old_logs[@]}"
fi

printf '\nLog: %s\n' "${log_file}"
exit "${result}"
