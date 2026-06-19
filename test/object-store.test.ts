import { describe, it, expect } from 'vitest';
import { InMemoryObjectStore } from '../src/storage/object-store.js';

describe('InMemoryObjectStore', () => {
  it('stores bytes and returns a signed URL carrying the TTL', async () => {
    const store = new InMemoryObjectStore();
    await store.put('prescriptions/1/m1', Buffer.from('img-bytes'), 'image/jpeg');

    expect(store.has('prescriptions/1/m1')).toBe(true);
    const url = await store.signedUrl('prescriptions/1/m1', 900);
    expect(url).toContain('prescriptions/1/m1');
    expect(url).toContain('exp=900');
  });

  it('refuses to sign a URL for a missing object (no public path)', async () => {
    const store = new InMemoryObjectStore();
    await expect(store.signedUrl('nope', 900)).rejects.toThrow();
  });
});
