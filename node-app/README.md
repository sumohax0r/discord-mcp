# Wholesome Discord MCP — Node.js

A local web control panel, Discord AI replies through OpenAI and Anthropic APIs,
and a restricted OAuth-protected MCP server. Requires Node 22.12+ (Windows host
has Node 24.13.1). The original Java application is retained separately.

## Run locally

```powershell
cd 'C:\Discord MCP'
npm.cmd ci --ignore-scripts
npm.cmd test
node src/server.js
```

Open **http://localhost:8090** on the Windows server. Use the one-time code in
`data\setup-code.txt` to create an administrator password (at least 14 characters).
Setup is restricted to local loopback requests; the code is deleted after use.

1. Enter a dedicated Discord bot token and click **Save & connect Discord**.
2. Select a server and channels from the discovered lists. Enable Message Content
   intent in Discord's developer portal. The bot needs View Channel, Send Messages
   and Read Message History in those channels; do not grant Administrator.
3. Enter OpenAI and Anthropic API keys. Choose model IDs available to those accounts
   and use the provider test buttons. Tests incur API usage.
4. Select allowed users or explicitly allow everyone in the selected channels.
5. Enable AI replies and save. Use `!chatgpt question`, `!claude question`, or start
   a message with a bot mention. `!reset` clears the caller's conversation history.

Bot-authored messages, webhooks, DMs, unselected channels and threads are ignored.
AI conversation context is limited to eight messages, isolated by user/channel/
provider, retained in memory for 30 minutes and cleared at restart/settings save.
Input and output sizes, concurrent requests, user rate and daily request counts
are bounded. The daily cap is UTC and survives restarts; it is not a dollar budget.
Provider errors never echo response bodies. Use provider-side spend controls too.

## MCP connectors

The `/mcp` endpoint uses streamable HTTP and OAuth authorization code flow with
PKCE, exact registered HTTPS redirect URIs, explicit admin consent, rotating
refresh tokens and audience/scope checks. Enable MCP read/write in settings.
Only `list_channels`, `read_messages` and `send_message` exist. Both OAuth scope
and current channel/settings policy are enforced. Revoke all connections from UI.

Remote ChatGPT/Claude connections require a working public HTTPS domain and a
reverse proxy on the Windows host. Create `runtime.json` (not in Git):

```json
{ "port": 8090, "publicOrigin": "https://YOUR-DISCORD-SUBDOMAIN" }
```

Restart after changing it. Forward to `127.0.0.1:8090`, preserve the original Host
header, support POST bodies and OAuth endpoints, disable proxy access logging of
query strings/Authorization headers, and restrict direct access to the backend.
Do not publish port 8090 directly. The service always binds to loopback. The UI
uses Secure cookies on the configured public HTTPS host. Host/Origin validation,
CSRF tokens, login throttling, a restrictive CSP and HTTP-only sessions are enabled.
Changing the public origin invalidates old token audiences; reconnect clients.

Dynamic client registration is capped at 100 clients; supported token auth methods
are `none` and `client_secret_post`. Client registry and tokens are encrypted on
 disk. Consent requests/codes expire quickly in memory. Reset/revoke clears all
registrations and grants. OAuth tests run locally; actual vendor connector setup
must be verified when a domain is available.

## Windows operation

Run `scripts\install-task.ps1` from PowerShell to register **Wholesome Discord MCP**
as a limited-privilege scheduled task for the current user. It starts at login and
restarts the Node process after crashes. Disconnecting RDP leaves it running;
**logging out does not**. For unattended operation before login, provision a
separate non-administrator service account and a task configured to run whether
logged on or not (Windows credentials must be entered by the administrator).
Do not run the bot as SYSTEM or Administrator.

Stop/start via Task Scheduler or `Stop-ScheduledTask` / `Start-ScheduledTask`.
The supervisor limits logs to approximately 5 MB. No message contents, tokens or
provider response bodies are intentionally logged.

## Storage and security

`data/state.enc` is authenticated AES-256-GCM ciphertext. `data/vault.key` is the
local encryption key; protect **both** with Windows ACLs. Encryption protects
accidental disclosure of the config file, not an attacker who can read both files
or control the service account. The task installer restricts the application
folder to the current user, Administrators and SYSTEM. Back up the data directory
securely; losing its key loses credentials/settings. Never commit it. Sessions
expire after eight hours and are invalidated on restart; admin passwords use scrypt.

Runtime outbound traffic is limited in application code to Discord (via
`discord.js`), `api.openai.com` and `api.anthropic.com`. No telemetry, remote images,
arbitrary URL fetches or shell tools are implemented. npm installation uses the
npm registry. Transitive dependencies are pinned in the lockfile; re-audit before
updates. No automatic updates. Windows 10 support/ESU coverage still needs checking
before public hosting.

## Verification

`npm test` covers secret redaction/encryption, setup/login boundaries, CSRF,
allowlists, Discord routing and history isolation, fixed provider destinations,
PKCE, redirect matching, code replay, refresh scope escalation, token revocation,
and MCP permission enforcement. Provider and Discord calls are mocked in tests;
live end-to-end checks require your credentials.
