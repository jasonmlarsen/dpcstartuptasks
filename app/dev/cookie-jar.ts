/**
 * The cookie jar a request-dispatching tool keeps on a physician's behalf.
 *
 * Every session in this product is a cookie the app set, so anything that
 * drives the real handler — the test harness and the dev tool both — has to
 * hold one and hand it back exactly as a browser would. One implementation
 * rather than two, because the load-bearing part is **deletion**: ADR-0004's
 * revocation test only means anything if a cleared cookie actually clears,
 * and a second copy of that parsing is a second place for it to stop being
 * true.
 */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  /** The `Cookie` header, or nothing when there is nothing to send. */
  header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  /** Keep the jar in step with the response, deletions included. */
  absorb(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(";");
      const separator = pair.indexOf("=");
      if (separator === -1) continue;

      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();

      if (value === "" || expires(attributes)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  /** Drop the session without touching the database. */
  clear(): void {
    this.cookies.clear();
  }

  /**
   * Put a cookie back, which a browser's owner does by having two of them.
   *
   * Support View's tests are what need it: the Admin's session and the
   * Owner's are two browsers, and swapping between them is saving one jar
   * and restoring it rather than signing anyone in again.
   */
  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  /** What the app has set so far, for asserting a session was established. */
  get size(): number {
    return this.cookies.size;
  }

  [Symbol.iterator](): MapIterator<[string, string]> {
    return this.cookies[Symbol.iterator]();
  }
}

/** A `Set-Cookie` that is really a deletion, in the two spellings of it. */
function expires(attributes: string[]): boolean {
  return attributes.some((attribute) => {
    const [key, raw] = attribute.split("=");
    const lowered = key.trim().toLowerCase();
    if (lowered === "max-age") return Number(raw) <= 0;
    if (lowered === "expires") return new Date(raw ?? "").getTime() <= Date.now();
    return false;
  });
}
