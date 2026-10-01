# Security Policy

NEXA handles transaction preparation and optional server-side signing. Treat every deployment as security-sensitive financial software.

## Reporting a vulnerability

Open a GitHub security advisory for this repository when possible. Do not publish private keys, seed phrases, access tokens, vulnerable production endpoints, or exploit details in a public issue.

## Operator requirements

- Use a dedicated, low-balance agent wallet.
- Store signing and service credentials only in the deployment platform's encrypted server secret store.
- Never use `VITE_*`, browser storage, client code, logs, event payloads, documentation, or committed environment files for secrets.
- Keep `NEXA_EMERGENCY_STOP=true` until signer identity, RPC health, verified contracts, fresh pricing, hard limits, and a real dry run have all been reviewed.
- Rotate any credential that has ever appeared in chat, logs, a browser, or source control before funding or production use.
- Audit dependency and source changes before enabling `LIVE_LIMITED` or `LIVE_AUTONOMOUS`.

## Enforced boundaries

BRAIN creates structured intents only. Policy evaluates hard limits and readiness. Executor simulates and manages transaction state. Signer is server-only and receives only policy-approved transaction data. Positions require confirmed receipts and verified transfer evidence.

See [docs/SECURITY.md](docs/SECURITY.md) for the full execution and activation model.
