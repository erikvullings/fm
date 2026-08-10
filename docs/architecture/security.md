# Security Model for Server Mode

This document describes the security architecture for the file manager's server mode (browser-based deployment), as implemented in task 0064 and beyond.

## Overview

The server mode exposes the file manager's capabilities over HTTP/REST and Server-Sent Events (SSE). Because the server controls filesystem access and runs on a network-accessible machine, it must be hardened against:

- **Unauthorized access** — session hijacking, replay attacks
- **Path traversal** — symlink escape, `..` traversal, UNC paths
- **Resource exhaustion** — oversized requests, rate limit abuse
- **Information leakage** — CORS policy bypass, error message disclosure

## Security Architecture

### 1. Session-Based Authentication (Task 0064)

All `/api/v1` routes (except health check) require a valid session token.

#### Token Lifecycle

- **Generation**: On server startup, a random 32-byte session secret is generated using cryptographically random UUIDs.
- **Issuance**: Clients obtain a token by authenticating out-of-band (e.g., via a one-time setup UI or command-line flag).
- **Verification**: Each request validates the token's HMAC-SHA256 signature against the server's secret.
- **Lifetime**: Tokens are valid for the entire server session; no expiration or refresh tokens.

#### Token Format

```
<SHA256(secret || nonce)>-<nonce>
```

where `||` denotes concatenation and `nonce` is a unique UUID per token.

#### Development Mode

In development mode (opt-in via `--dev-mode-auth-disabled`), authentication is disabled:

- All `/api/v1` routes accept requests without a token.
- Logging warns that dev mode is active.
- **This flag is impossible to use when binding to non-loopback addresses** (enforced at startup).

#### Production Recommendations

1. Generate a token via a secure setup process (e.g., a one-time bootstrap server or hardcoded token).
2. Transmit tokens over HTTPS only (TLS terminator or reverse proxy).
3. Store tokens in secure browser storage (e.g., `sessionStorage`, never `localStorage`).
4. Rotate secrets periodically (requires client re-authentication).

### 2. Loopback-Only Binding (Task 0064)

By default, the server binds to `127.0.0.1:8787` and is unreachable from the network.

#### Network Access

- **Loopback mode** (default): Server is reachable only on `localhost`.
- **LAN/WAN mode**: Requires explicit `--bind` flag + warning at startup.
  ```bash
  # WARNING: binding to non-loopback address; ensure TLS and authentication are configured
  fm-server --bind 0.0.0.0 --port 8787 --dev-mode-auth-disabled
  ```

#### Production Recommendations

1. Place the server behind a reverse proxy (nginx, Caddy) with TLS termination.
2. Use the reverse proxy to enforce authentication (e.g., HTTP Basic Auth, OAuth).
3. Never bind the fm-server directly to `0.0.0.0` in production; use a private network or VPN.

### 3. Strict CORS Policy (Task 0064)

The server implements strict origin validation with no wildcard support.

#### Configuration

```rust
// Only these origins can make cross-origin requests
--cors-origin https://example.com --cors-origin http://localhost:3000

// Empty by default (no cross-origin requests allowed)
```

#### Rationale

Wildcard CORS (`*`) allows any website to access the server's API, defeating authentication if cookies or default credentials are in use. Named origins prevent this attack.

#### Production Recommendations

1. Use a reverse proxy to serve the frontend and API from the same origin (same-origin policy).
2. If cross-origin is necessary, list only known, trusted origins.
3. Never use wildcard CORS with authentication.

### 4. Accessible Roots Validation (Task 0064)

Every incoming file operation is validated against configured accessible roots, **after symlink resolution**.

#### Configuration

```bash
# Restrict server to only these directories
fm-server --root /home/user/documents --root /mnt/shared/public
```

#### Validation Logic

1. Resolve the requested path (follow symlinks, normalize `..` and `.`).
2. Check if the canonical path starts with one of the configured roots.
3. Reject if outside all roots.

#### Escape Prevention

This blocks:

- **Path traversal**: `/home/user/documents/../../../etc/passwd` → canonicalization resolves to `/etc/passwd`, rejected.
- **Symlink escape**: `/home/user/documents/link_to_outside` → symlink resolves outside root, rejected.
- **UNC paths** (Windows): `\\?\C:\windows\system32` → canonicalization handles it.
- **Encoded traversal**: `%2e%2e` → filesystem never has this component; it's a URL encoding that doesn't affect filesystem paths.

#### Production Recommendations

1. Always configure at least one root; an empty list allows access to the entire filesystem.
2. Roots should be user-owned directories, not system directories.
3. Use read-only roots where possible (if the server is read-only).

### 5. Request Size Limits (Task 0064)

The server enforces a maximum request body size (default: 10 MB, configurable).

```rust
pub max_body_bytes: usize = 10 * 1024 * 1024
```

#### Rationale

Prevents denial-of-service via large payloads (e.g., uploading a 1 TB file to exhaust memory).

#### Production Recommendations

1. Set limits based on your use case:
   - Read-only server: 1 MB (for query strings only).
   - File upload support: Size of largest expected upload.
2. Pair with reverse proxy limits (nginx: `client_max_body_size`).

### 6. Audit Logging (Task 0064)

Destructive operations (delete, trash, overwrite) are logged with structured metadata.

```log
audit: destructive operation
  operation=delete
  path=/home/user/documents/file.txt
  session_id=<uuid>
  timestamp=2024-08-10T12:00:00Z
```

#### What Is Logged

- Operation type (delete, trash, overwrite)
- Relative path (after root normalization)
- Session ID (if authenticated)
- Timestamp

#### What Is NOT Logged

- File contents
- Secrets (keys, tokens, passwords)
- Full filesystem paths (relative to root only)

#### Production Recommendations

1. Ship logs to a centralized logging service (e.g., Datadog, ELK).
2. Retain logs for compliance (e.g., 90 days for GDPR).
3. Use log aggregation to detect abuse patterns (e.g., many deletes by one session).

### 7. TLS/HTTPS (Task 0064)

The server does not implement TLS directly; use a reverse proxy for HTTPS.

#### Setup Example

```nginx
# /etc/nginx/conf.d/fm-server.conf
upstream fm_server {
    server 127.0.0.1:8787;
}

server {
    listen 443 ssl;
    server_name files.example.com;
    ssl_certificate /etc/letsencrypt/live/files.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/files.example.com/privkey.pem;

    location / {
        proxy_pass http://fm_server;
        proxy_set_header Authorization $http_authorization;
        proxy_pass_header Authorization;
    }
}
```

#### Production Recommendations

1. Use a certificate from a trusted CA (Let's Encrypt, Digicert, etc.).
2. Enable HSTS (`Strict-Transport-Security`).
3. Use TLS 1.2+ with strong ciphers.

## Threat Model

### Attacker Capabilities

- **Network**: Can eavesdrop, intercept, or replay HTTP requests.
- **Client**: Can influence browser behavior (XSS if frontend is compromised).
- **Server**: Cannot execute arbitrary code (Rust + safe memory model).

### In Scope (Mitigated)

- ✅ Unauthorized file access (authentication, accessible roots)
- ✅ Path traversal (symlink resolution, canonicalization)
- ✅ Session hijacking (HMAC-SHA256 signatures)
- ✅ Denial-of-service via large requests (request size limits)
- ✅ Cross-origin attacks (CORS policy)
- ✅ Audit trail (destructive operation logging)

### Out of Scope

- ❌ Network eavesdropping (mitigated by TLS, not in-server)
- ❌ Compromised reverse proxy (mitigated by deployment, not in-server)
- ❌ Malicious browser extensions (mitigated by CSP/SOP, not in-server)
- ❌ Client-side vulnerabilities in the frontend (frontend security, not this crate)

## Deployment Checklist

- [ ] **Bind address**: Confirm loopback binding (127.0.0.1) or reverse proxy is in place.
- [ ] **Authentication**: Dev mode disabled; production tokens are generated securely.
- [ ] **CORS origins**: Configured to known, trusted domains only (no wildcard).
- [ ] **Accessible roots**: Configured to user-owned directories only.
- [ ] **TLS**: Reverse proxy has a valid certificate (HTTPS only).
- [ ] **Request limits**: Set appropriately for your use case.
- [ ] **Audit logs**: Shipped to a centralized logging service.
- [ ] **Monitoring**: Alerting on auth failures, path traversal attempts.

## References

- **OWASP Top 10**: https://owasp.org/www-project-top-ten/
- **Node.js Security Best Practices**: https://nodejs.org/en/docs/guides/security/
- **Rust Security Considerations**: https://doc.rust-lang.org/book/ch19-01-unsafe-rust.html
- **NIST Cybersecurity Framework**: https://www.nist.gov/cyberframework

## Implementation References

- Session authentication: `fm-server/src/auth.rs`
- Accessible roots validation: `fm-server/src/accessible_roots.rs`
- Audit logging: `fm-server/src/audit.rs`
- Server configuration: `fm-server/src/config.rs`
- Security tests: `fm-server/tests/security.rs`
