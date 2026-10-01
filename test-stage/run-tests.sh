#!/usr/bin/env bash
set -Eeuo pipefail

actual_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "${actual_major}" != "${EXPECTED_NODE_MAJOR}" ]]; then
  printf 'Expected Node %s, got %s\n' "${EXPECTED_NODE_MAJOR}" "$(node --version)" >&2
  exit 2
fi

printf 'Node=%s npm=%s js-controller=%s\n' \
  "$(node --version)" \
  "$(npm --version)" \
  "${IOBROKER_TEST_CONTROLLER_VERSION}"

find /workspace -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
cp -R /source/. /workspace/
rm -rf /tmp/test-iobroker.viessmann-climate-api

npm ci
npm run check
npm test
npm run lint
npm run test:integration
/stage/run-lifecycle.sh
npm pack --dry-run
