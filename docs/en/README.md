# Viessmann Climate API user guide

This adapter connects ioBroker to systems exposed through the Viessmann Climate Solutions cloud API. The installation normally reaches the cloud through a Vitoconnect gateway.

The first verified reference system is a Vitocal 300-G BWC 301.C16 heat pump with Vitoconnect. Other systems may expose different features and commands and must be tested individually.

## Before installation

You need Node.js 22 or 24, js-controller 6.0.11 or newer, Admin 7.6.20 or newer, a Viessmann developer account and a compatible cloud-connected installation. Create the OAuth client in the [Viessmann Developer Portal](https://app.developer.viessmann-climatesolutions.com/) and review the manufacturer's [API products](https://developer.viessmann-climatesolutions.com/start/api-products.html). Available features still depend on the individual installation and account.

The project is currently a pre-release. Install review builds only through ioBroker Admin's **Install from custom URL** function and use a separate test instance.

## OAuth login

1. Register the exact callback URI from the adapter configuration in the Viessmann OAuth client. A typical URI is `http://<iobroker-host>:8097/callback`.
2. Enter the Client ID. A Client Secret is optional and should only be entered when required by the OAuth client.
3. Leave the callback enabled, create the login URL and complete the Viessmann login in the same reachable network.
4. Check `info.connection`, `raw` and `summary` after the callback succeeds.

Never share the native instance object or callback URL. It may contain tokens, an authorization code, OAuth state, installation IDs or gateway identifiers.

## Polling and limits

The default interval is five minutes. The adapter keeps a local rolling-24-hour request counter and uses a default safety budget of 1,450 calls. This is only a local estimate. The actual entitlement is controlled by the selected Viessmann API product; consult the current [Viessmann API FAQ](https://developer.viessmann-climatesolutions.com/start/faq.html).

Polling is serialized. Failed requests time out and are retried with increasing delay. Multiple instances and unrelated applications can still consume the same external quota.

## Enabling a write

Writes remain blocked until both the global switch and the command-specific approval are active.

1. Poll successfully and inspect `writes.discovered`.
2. Confirm that the API reports the intended command as executable and review its parameters.
3. Enable `writeEnabled` in the instance configuration.
4. Enable only the matching `writes.allowlist.<feature>.<command>.enabled` state.
5. Write the required JSON parameters to the generated `control` state or to `write.command`.
6. Verify `write.lastResult` and the physical system response.

Commands are serialized and rate-limited. Disable `writeEnabled` after testing if writes are not required for normal operation.

## Important object groups

- `raw`: full generic feature tree
- `summary`: selected readable states
- `writes.discovered`: command metadata and parameters
- `writes.allowlist`: command-specific approvals
- `control`: writable states for approved commands
- `write.lastResult`: result of the last command
- `diagnostics.api.limit.*`: local request-budget diagnostics

The detailed [adapter guide](../adapter-guide.md) contains state examples and command payloads.

## Support

Open public bugs and feature requests through the repository issue templates. Include versions and a minimal reproduction, but redact OAuth data, installation IDs, gateway serial numbers and personal information. Security vulnerabilities must follow [SECURITY.md](../../SECURITY.md).

This project is independent from Viessmann and from other ioBroker Viessmann adapters. It provides no compatibility or automatic migration between their object models.

The software was developed with AI assistance. The adapter has no AI runtime feature and does not send operational or user data to an AI service.
