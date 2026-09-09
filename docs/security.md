# Security

Never commit provider URLs or tokens. Use runtime environment configuration and TLS (`rediss://` for Redis where required). Avoid cache keys that contain raw emails, tokens, or other sensitive values; hash or map them before use.

Only use trusted codecs. JSON is the default; do not deserialize untrusted executable formats. Namespace tenant data and validate all user-derived key/tag segments to prevent cross-tenant cache poisoning.

CacheKit errors retain a causal error for diagnostics. Log them through a redacting logger and do not expose provider error payloads directly to clients.
