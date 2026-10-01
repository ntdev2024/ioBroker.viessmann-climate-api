# ioBroker Viessmann Climate API

Connects ioBroker to the [Viessmann Climate Solutions API](https://api.viessmann-climatesolutions.com/documentation) for installations connected to the Viessmann cloud, typically through a Vitoconnect gateway. The adapter reads installations, devices and features and provides deliberately protected write access.

## Status

This project is in public pre-release review. Version 0.1.0 is published on npm, but the adapter is not yet listed in the official ioBroker repositories. Treat it as test software and keep writes disabled until the exposed commands and parameters have been reviewed for your installation.

Implemented and automatically tested:

- OAuth 2.0 Authorization Code flow with PKCE and automatic token refresh
- serialized polling with request timeout and exponential retry backoff
- raw feature data, curated summaries and API-usage diagnostics
- dynamically discovered commands with a per-command allowlist
- serialized writes with a configurable minimum interval
- clean start, stop and restart in ioBroker compact mode

## Requirements

- Node.js 22, 24 or 26
- js-controller 6.0.11 or newer
- Admin 7.6.20 or newer
- a compatible Viessmann installation connected to the Viessmann cloud
- a Viessmann developer account and OAuth client from the [Viessmann Developer Portal](https://app.developer.viessmann-climatesolutions.com/)
- a callback URI that the browser running the OAuth login can reach

Viessmann describes the available plans on its [API products page](https://developer.viessmann-climatesolutions.com/start/api-products.html). Device and feature availability still depends on the installation, gateway, account, subscription and data returned for the individual system.

## Installation

The adapter is awaiting inclusion in an official ioBroker repository. After it has been listed, install it from the normal adapter list in ioBroker Admin. Create a separate test instance first and leave `writeEnabled` off.

Updates must preserve the instance configuration, but OAuth credentials and writes should still be checked after every pre-release update.

## OAuth setup

1. Create an OAuth client in the [Viessmann Developer Portal](https://app.developer.viessmann-climatesolutions.com/).
2. Register the exact callback URI configured in the adapter, for example `http://<iobroker-host>:8097/callback`.
3. Enter the Client ID in the adapter configuration. Only enter a Client Secret if the Viessmann client requires one.
4. Create the Viessmann login URL in the OAuth tab and complete the login in the browser.
5. Confirm that `info.connection` becomes `true` and that data appears below `raw` and `summary`.

The callback listener is temporary and is stopped after the login or timeout. Tokens and OAuth state are declared as protected native configuration values. Nevertheless, never publish instance objects, support reports or screenshots containing credentials, installation IDs, gateway serial numbers or callback parameters.

## API limits and polling

The default local rolling-24-hour budget is 1,450 requests and the default polling interval is five minutes. The configured budget is a local safety calculation, not a promise of API entitlement. Check the current limits for your Viessmann API product in the [Viessmann API FAQ](https://developer.viessmann-climatesolutions.com/start/faq.html).

The adapter serializes polls, aborts requests after a timeout and applies exponential backoff after failures. Additional adapter instances and other applications using the same Viessmann account may share or consume the same external quota.

## Write safety

Writes are denied by default. A command is executed only when all of the following are true:

1. `writeEnabled` is enabled in the instance configuration.
2. The API reports the command as executable.
3. `writes.allowlist.<feature>.<command>.enabled` is set to `true`.
4. The command parameters pass validation.

Commands are sent through one serialized queue with a configurable minimum interval. Inspect `write.lastResult` after every test. Disable `writeEnabled` immediately if the installation behaves unexpectedly. This software does not replace manufacturer controls, safety devices or professional heating-system configuration.

## Main object groups

- `info`: adapter connection state
- `raw`: generic API feature and property tree
- `summary`: selected readable values for scripts and visualizations
- `writes.discovered`: commands and parameters reported by the API
- `writes.allowlist`: explicit per-command approvals
- `control`: writable states created only for approved commands
- `write`: generic command input, queue length and last result
- `diagnostics`: API budget and runtime information

See the [English user guide](docs/en/README.md), [German user guide](docs/de/README.md) and [state/command guide](docs/adapter-guide.md) for details.

## Tested systems

The current hardware reference is a **Vitocal 300-G BWC 301.C16 heat pump connected through Vitoconnect**. Portable lifecycle and compact-mode tests run on Node.js 22 and 24. Other Viessmann products and feature combinations are not yet verified by this project.

Please report successful devices without publishing serial numbers, installation IDs or account data.

## Relationship to other ioBroker adapters

This is an independent adapter for the current Viessmann Climate Solutions cloud API. It is not a fork, drop-in replacement or migration path for other community projects such as [ioBroker.viessmannapi](https://github.com/TA2k/ioBroker.viessmannapi), [ioBroker.viessmann](https://github.com/misanorot/ioBroker.viessmann) or [iobroker.vitoconnect](https://github.com/st400/iobroker.vitoconnect). Those projects may use different cloud endpoints, local gateways, vcontrold/Optolink connections, object models and configuration formats.

Choose the adapter that matches your connection method and existing automation. Never run competing writers against the same heating controls without understanding their interaction.

## Support and security

- Use [GitHub Issues](https://github.com/ntdev2024/ioBroker.viessmann-climate-api/issues) for reproducible bugs and feature requests.
- Read the [security policy](SECURITY.md) before reporting a vulnerability.
- Remove tokens, secrets, callback codes, serial numbers, installation IDs and personal data from every log and screenshot.
- Include the adapter version, Node.js version, js-controller version and a minimal reproduction.

## Changelog

### 0.1.0 (2026-10-01)

- Renamed the public adapter identity to `viessmann-climate-api`.
- Added portable package, integration, lifecycle and compact-mode tests.
- Serialized polling and added request timeouts, retry backoff and complete unload cleanup.
- Added encrypted OAuth credential persistence and centralized secret redaction.
- Expanded English and German user, support, security and AI-assistance documentation.
- Added public issue templates and strengthened package and repository hygiene checks.

Older `0.0.x` versions were private development builds and are not public releases.

## AI-assisted development

AI tools assisted with parts of analysis, implementation, documentation and testing. Every contribution remains subject to human review and the same automated checks as other code. The adapter contains no AI runtime feature and does not send ioBroker, Viessmann, heating-system or user data to an AI service.

## Legal notice

This independent open-source project is not affiliated with, sponsored by or endorsed by Viessmann Climate Solutions. Viessmann, Vitocal and Vitoconnect are trademarks of their respective owners. Use of the Viessmann API is subject to the terms and limits of the user's Viessmann developer account.

The software is provided without warranty. Heating-system changes can affect comfort, energy use and equipment operation. The user is responsible for validating commands and retaining safe manufacturer settings.

## License

Copyright (c) 2026 ntdev2024 <iobroker.ntdev2024@web.de>

[MIT License](LICENSE)
