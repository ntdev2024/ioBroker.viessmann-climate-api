# Changelog

## 0.1.0 (2026-10-01)

- Renamed the public adapter identity to `viessmann-climate-api`.
- Added Node.js 22/24 package, integration, lifecycle and compact-mode tests.
- Serialized polling and added request timeouts, retry backoff and complete unload cleanup.
- Added encrypted OAuth credential persistence and centralized secret redaction.
- Expanded English and German user, support, security and AI-assistance documentation.
- Added public issue templates and strengthened package/repository hygiene checks.

## 0.0.23 (2026-08-05)

- Prepared ioBroker repository metadata for public review.
- Added clearer OAuth Client ID help in the adapter configuration.

## 0.0.22 (2026-07-30)

- Added public adapter documentation under `docs/adapter-guide.md`.

## 0.0.21 (2026-07-30)

- Reduced the public repository and npm package to the minimal adapter surface.
- Removed private development, system-test, and discovery files from the public
  package scope.

## 0.0.20 (2026-07-30)

- Initialized `write.queueLength` to `0` during adapter startup.

## 0.0.19 (2026-07-30)

- Prepared the first ioBroker-ready build with the adapter config
  focused on OAuth, polling, diagnostics, and allowlisted ioBroker writes.

## 0.0.18 (2026-07-28)

- Prepared the adapter for private GitHub publication.
- Added OAuth PKCE login with temporary local callback handling.
- Added protected and encrypted native config handling for OAuth tokens.
- Added automatic OAuth token refresh.
- Added generic Viessmann feature polling and raw state mapping.
- Added summary, diagnostics, API limit, and support-report states.
- Added dynamic write discovery.
- Added write allowlist states and generated control states for enabled writes.
- Added serialized write queue with global `writeEnabled` protection.
- Added generic JSON write input via `write.command`.
- Added PayPal donation URL configuration support.
- Added ioBroker publication and release planning docs.

## 0.0.1 - 0.0.17

- Internal development builds.
