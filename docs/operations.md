# Operations

Treat cache errors differently from source-of-truth errors. A cache may be bypassed for retryable connection failures, but authentication and configuration errors should fail fast rather than masquerading as misses.

Call `health()` from a readiness probe with a short caller-controlled timeout. Its result contains provider and latency only; do not add keys or credentials to probe output.

Set explicit TTLs for data whose freshness matters. Memory caches should also set `maxEntries`; eviction is FIFO and local to a process. Redis expiry includes the stale window, so stale values are automatically removed after the bounded window.

The initial release exposes no built-in metrics/tracing middleware. Instrument calls at your application boundary until the observability middleware planned in the architecture is released.
