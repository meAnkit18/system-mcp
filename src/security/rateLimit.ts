export class RateLimiter {
  private buckets = new Map<string, number[]>();

  constructor(private readonly maxPerMinute: number) {}

  check(key: string): { allowed: boolean; remaining: number } {
    const now = Date.now();
    const windowMs = 60_000;
    const arr = this.buckets.get(key) ?? [];
    const recent = arr.filter((t) => now - t < windowMs);
    if (recent.length >= this.maxPerMinute) {
      this.buckets.set(key, recent);
      return { allowed: false, remaining: 0 };
    }
    recent.push(now);
    this.buckets.set(key, recent);
    return { allowed: true, remaining: this.maxPerMinute - recent.length };
  }

  reset(): void {
    this.buckets.clear();
  }
}