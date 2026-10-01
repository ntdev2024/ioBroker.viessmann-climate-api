# Persistent Docker test stage

This stage keeps four isolated Linux containers for Node.js 20, 22, 24 and 26. Node.js 22, 24 and 26 form the supported pre-release gate required by the current ioBroker checker. The Node.js 20 container remains available for explicit legacy diagnostics, but it is not part of the default matrix because the adapter and current `@iobroker/testing` require Node.js 22. It does not replace the public Windows/macOS matrix or a real Vitoconnect/Vitocal test on a dedicated ioBroker host.

## Layout

- Stage root: this `test-stage/` directory on any Linux Docker host
- Adapter source: selected through `ADAPTER_SOURCE` and mounted read-only inside each container
- Per-Node writable workspaces and npm caches: persistent Docker volumes; the workspace content is refreshed from the snapshot before each run
- Integration-test data: separate per-Node `/tmp` volumes; the adapter test directory is reset before each run
- Lifecycle test: fresh install of a generated predecessor package, upgrade to the current package and complete removal through the ioBroker CLI
- Compact-mode test: a disabled Admin instance satisfies the declared runtime dependency; the adapter then runs through start, stop, restart and stop in a real js-controller compact group
- Logs: `logs/matrix-<UTC timestamp>.log`, newest 20 retained

The services publish no host ports and use the dedicated Compose network `viessmann-climate-api-stage_stage`.

## Operation

```bash
cd test-stage
ADAPTER_SOURCE=.. docker compose up -d
ADAPTER_SOURCE=.. ./run-matrix.sh
ADAPTER_SOURCE=.. docker compose stop
```

Run an explicit legacy check only when needed:

```bash
STAGE_SERVICES=node20 ./run-matrix.sh
```

`docker compose stop` keeps containers, caches and volumes. Do not use `docker compose down --volumes` unless a complete rebuild was explicitly requested.

The legacy Node 20 service pins js-controller 7.2.2; the supported Node 22/24 services pin js-controller 7.2.3. Container image tags are only refreshed by an explicit `docker compose pull`.
