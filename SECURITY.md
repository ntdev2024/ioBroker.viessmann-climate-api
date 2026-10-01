# Security Policy

## Supported versions

Until the first stable release, security fixes are applied only to the latest code on the default branch. Pre-release archives are not maintained as separate supported versions.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub's **Report a vulnerability** function under the repository Security tab. If private vulnerability reporting is not yet available, open a GitHub issue without vulnerability details and ask the maintainer to enable a private reporting path. Never disclose security-sensitive information in a public issue.

Include:

- affected adapter and js-controller versions
- impact and required preconditions
- minimal reproduction steps
- a proposed remediation, if available

Never include live access or refresh tokens, Client Secrets, OAuth authorization codes, PKCE data, instance-object exports, installation IDs, gateway serial numbers, private URLs or personal information. Replace identifiers consistently with obvious placeholders.

The maintainer will acknowledge a usable report when possible, investigate it privately and coordinate disclosure after a fix is available. This community project cannot guarantee a response or resolution time.

## Security boundaries

- OAuth credentials are declared as protected and encrypted native values, but operators must still protect ioBroker backups and administrative access.
- The temporary OAuth callback listener is intended only for completing login and is stopped after success, timeout or adapter unload.
- Writes require the global switch, an executable command reported by the API and an explicit per-command allowlist entry.
- This adapter cannot enforce physical equipment safety and does not replace manufacturer controls or qualified service personnel.

## Public bug reports

For non-security defects, use the repository bug template after removing all secrets and installation-specific identifiers. Sanitized support information should contain versions and state names, not complete object or state databases.
