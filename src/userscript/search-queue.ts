export interface SearchIdentity { query: string; sourceUrl: string }
export interface PendingSearch extends SearchIdentity { promptText: string }

export function searchSignature(search: SearchIdentity): string {
  const url = new URL(search.sourceUrl);
  // Ignore Google's changing telemetry parameters, not the actual search text.
  return `${url.origin}${url.pathname}\n${search.query}`;
}

/** One local latest-search slot. In-flight work is never replaced or resent. */
export class SearchQueue {
  pending: PendingSearch | null = null;
  constructor(public lastDispatched: string | null = null) {}

  offer(search: PendingSearch | null): void {
    if (search && this.pending && searchSignature(search) === searchSignature(this.pending)) return;
    this.pending = search && searchSignature(search) !== this.lastDispatched ? search : null;
  }

  dispatched(): PendingSearch | null {
    const search = this.pending;
    if (search) {
      this.lastDispatched = searchSignature(search);
      this.pending = null;
    }
    return search;
  }
}
