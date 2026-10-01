#!/usr/bin/env bash
set -Eeuo pipefail

: "${IOBROKER_TEST_CONTROLLER_VERSION:?Missing IOBROKER_TEST_CONTROLLER_VERSION}"

package_name="$(node --input-type=commonjs -p 'require("./package.json").name')"
adapter_name="${package_name#*.}"
current_version="$(node --input-type=commonjs -p 'require("./package.json").version')"
baseline_version="$(node --input-type=commonjs -e '
  const parts = require("./package.json").version.split(".").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) process.exit(2);
  if (parts[2] > 0) {
    parts[2] -= 1;
  } else if (parts[1] > 0) {
    parts[1] -= 1;
    parts[2] = 0;
  } else if (parts[0] > 0) {
    parts[0] -= 1;
    parts[1] = 0;
    parts[2] = 0;
  } else {
    process.exit(2);
  }
  console.log(parts.join("."));
')"

lifecycle_root="/tmp/lifecycle-${adapter_name}"
artifact_dir="/tmp/lifecycle-${adapter_name}-artifacts"
baseline_source="${artifact_dir}/baseline"
controller_pid=""

cleanup() {
  if [[ -n "${controller_pid}" ]] && kill -0 "${controller_pid}" 2>/dev/null; then
    kill -TERM "${controller_pid}" 2>/dev/null || true
    wait "${controller_pid}" 2>/dev/null || true
  fi
  rm -rf -- "${lifecycle_root}" "${artifact_dir}"
}
trap cleanup EXIT

cleanup
mkdir -p "${lifecycle_root}" "${baseline_source}" "${artifact_dir}/current"

current_tarball_name="$(npm pack --pack-destination "${artifact_dir}/current" --silent | tail -n 1)"
current_tarball="${artifact_dir}/current/${current_tarball_name}"

tar -xzf "${current_tarball}" -C "${baseline_source}"
node --input-type=commonjs -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const [sourceDir, version] = process.argv.slice(1);
  const packagePath = path.join(sourceDir, "package.json");
  const ioPackagePath = path.join(sourceDir, "io-package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const ioPackage = JSON.parse(fs.readFileSync(ioPackagePath, "utf8"));
  packageJson.version = version;
  ioPackage.common.version = version;
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  fs.writeFileSync(ioPackagePath, `${JSON.stringify(ioPackage, null, 2)}\n`);
' "${baseline_source}/package" "${baseline_version}"

baseline_tarball_name="$(cd "${baseline_source}/package" && npm pack --pack-destination "${artifact_dir}" --silent | tail -n 1)"
baseline_tarball="${artifact_dir}/${baseline_tarball_name}"

cd "${lifecycle_root}"
npm init --yes --silent >/dev/null
npm install --omit=dev --silent "iobroker.js-controller@${IOBROKER_TEST_CONTROLLER_VERSION}"
npm install --omit=dev --silent "iobroker.admin@>=7.6.20"
npm install --omit=dev --silent "${baseline_tarball}"

controller_dir="${lifecycle_root}/node_modules/iobroker.js-controller"
iobroker() {
  (cd "${controller_dir}" && node iobroker.js "$@")
}

iobroker add admin --enabled false
iobroker add "${adapter_name}" --enabled false
installed_version="$(iobroker version "${adapter_name}" | tail -n 1)"
if [[ "${installed_version}" != "${baseline_version}" ]]; then
  printf 'Fresh install version mismatch: expected %s, got %s\n' "${baseline_version}" "${installed_version}" >&2
  exit 3
fi

npm install --omit=dev --silent "${current_tarball}"
iobroker upload "${adapter_name}"
upgraded_version="$(iobroker version "${adapter_name}" | tail -n 1)"
if [[ "${upgraded_version}" != "${current_version}" ]]; then
  printf 'Upgrade version mismatch: expected %s, got %s\n' "${current_version}" "${upgraded_version}" >&2
  exit 4
fi

compact_log="${lifecycle_root}/log/iobroker.current.log"
controller_console="${artifact_dir}/controller-console.log"
compact_start_message="instance system.adapter.${adapter_name}.0 started in COMPACT mode"

wait_for_log_count() {
  local expected_count="$1"
  local description="$2"
  local count

  for _ in $(seq 1 60); do
    count="$(grep -cF "${compact_start_message}" "${compact_log}" 2>/dev/null || true)"
    if (( count >= expected_count )); then
      return 0
    fi
    if ! kill -0 "${controller_pid}" 2>/dev/null; then
      printf 'Controller stopped while waiting for %s.\n' "${description}" >&2
      tail -n 100 "${compact_log}" >&2 || true
      tail -n 100 "${controller_console}" >&2 || true
      return 1
    fi
    sleep 0.5
  done

  printf 'Timed out waiting for %s.\n' "${description}" >&2
  tail -n 100 "${compact_log}" >&2 || true
  tail -n 100 "${controller_console}" >&2 || true
  return 1
}

iobroker compact enable
iobroker compact "${adapter_name}.0" enable 1
(cd "${controller_dir}" && node controller.js) >"${controller_console}" 2>&1 &
controller_pid="$!"
sleep 3
iobroker start "${adapter_name}.0"

wait_for_log_count 1 "the first compact-mode start"
iobroker stop "${adapter_name}.0"
sleep 1
iobroker start "${adapter_name}.0"
wait_for_log_count 2 "the compact-mode restart"
iobroker stop "${adapter_name}.0"
sleep 1

kill -TERM "${controller_pid}"
wait "${controller_pid}" || true
controller_pid=""

if grep -Eiq 'cannot start.*compact|class constructor.*cannot be invoked|is not a function|unhandled rejection|uncaught exception' "${compact_log}" "${controller_console}"; then
  printf 'Compact-mode log contains a lifecycle error.\n' >&2
  tail -n 100 "${compact_log}" >&2
  exit 5
fi

grep -F "${compact_start_message}" "${compact_log}"
printf 'Compact lifecycle passed: start -> stop -> restart -> stop %s\n' "${adapter_name}.0"

iobroker del "${adapter_name}"
if [[ -d "${lifecycle_root}/node_modules/${package_name}" ]]; then
  printf 'Adapter package still exists after ioBroker deletion: %s\n' "${package_name}" >&2
  exit 6
fi

node --input-type=commonjs -e '
  const packageJson = require(process.argv[1]);
  if (packageJson.dependencies?.[process.argv[2]]) process.exit(1);
' "${lifecycle_root}/package.json" "${package_name}"

printf 'Lifecycle passed: install %s -> upgrade %s -> uninstall %s\n' \
  "${baseline_version}" \
  "${current_version}" \
  "${adapter_name}"
