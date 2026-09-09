# Custom providers

Register a provider when CacheKit does not ship the backend you need.

```ts
import { defineCacheProvider, registerCacheProvider } from '@mohamedhabibwork/cachekit';

registerCacheProvider(defineCacheProvider({
  type: 'acme-cache',
  async create(config) {
    return myAcmeCacheAdapter(config);
  },
}));
```

Your adapter must implement the `Cache` contract, truthfully declare `capabilities`, preserve `undefined` as a miss and `null` as a value, honor abort signals where its backend allows, and make `close()` idempotent. Return `CacheUnsupportedOperationError` for operations your backend cannot safely provide; do not silently emulate distributed guarantees.

Use `runCacheContract` from `@mohamedhabibwork/cachekit/testing` as a minimum smoke check, then add provider-specific concurrency, timeout, and failure tests.
