import { describe, expect, it } from 'vitest';
import { CacheInvalidConfigError, createCache, defineCacheProvider, registerCacheProvider } from '../src/index.js';

describe('factory', () => {
  it('creates the built-in memory provider', async () => {
    const cache = await createCache({ type: 'memory', namespace: 'app' });
    expect(cache.type).toBe('memory');
  });

  it('registers a custom provider', async () => {
    const provider = defineCacheProvider({ type: 'test-custom', create: () => createCache({ type: 'memory' }) });
    registerCacheProvider(provider);
    expect((await createCache({ type: 'test-custom' })).type).toBe('memory');
  });

  it('gives a useful error for unknown providers', async () => {
    await expect(createCache({ type: 'not-installed' })).rejects.toBeInstanceOf(CacheInvalidConfigError);
  });
});
