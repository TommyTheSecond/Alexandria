/** In-memory daily budget for confirmed submissions. */
export class DailyCap {
  private day = '';
  private used = 0;

  constructor(private readonly limit = 200, private readonly now: () => number = Date.now) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Daily limit must be between 1 and 200');
  }

  get sentToday(): number {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (day !== this.day) { this.day = day; this.used = 0; }
    return this.used;
  }

  get isFull(): boolean {
    return this.sentToday >= this.limit;
  }

  recordSuccess(): void {
    void this.sentToday;
    ++this.used;
  }
}
