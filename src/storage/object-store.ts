// Storage abstraction. Prod swaps in an S3/GCS adapter with a PRIVATE bucket
// (blockPublicAccess) and real time-limited signed URLs. The in-memory impl
// backs tests and local dev. The contract: objects are never publicly readable;
// the only read path is signedUrl().
export interface ObjectStore {
  put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void>;
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
}

export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<string> {
    if (!this.objects.has(key)) throw new Error(`object not found: ${key}`);
    // Stand-in for a real signed URL; carries the TTL so callers can assert it.
    return `memory://${key}?exp=${ttlSeconds}`;
  }

  // Test helpers (not part of the ObjectStore contract).
  has(key: string): boolean {
    return this.objects.has(key);
  }
  get(key: string): { body: Buffer; contentType: string } | undefined {
    return this.objects.get(key);
  }
}
