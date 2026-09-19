/**
 * The environment the only door into the product depends on.
 *
 * Three values, and all three are load-bearing: a wrong `APP_URL` mails links
 * nobody can open, a missing `AUTH_SECRET` invalidates every session on
 * restart, and an unset `TRUSTED_PROXIES` yields no client IP at all behind a
 * multi-hop proxy, which the per-IP control on Continue then has to fail
 * closed on — refusing every Continue press in production (ADR-0004).
 *
 * So in production this file asserts rather than warns, at import, which is
 * before the server can answer anything. A container that comes up
 * misconfigured is a container that never comes up.
 */

/** Where the app answers, and what a Sign-in Link is addressed to. */
export function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

/** What Better Auth signs cookies with. */
export function authSecret(): string {
  return process.env.AUTH_SECRET ?? DEVELOPMENT_SECRET;
}

/**
 * A fixed value so that a restart in development does not sign everyone out.
 * Never reachable in production: the assertion below refuses to boot without
 * a real secret.
 */
const DEVELOPMENT_SECRET = "launch-tasks-development-secret-not-for-production";

/**
 * The reverse proxies in front of this app, as IPs or CIDR ranges.
 *
 * Coolify terminates TLS at its own Traefik container and forwards over the
 * Docker network, so the value is that proxy's address on the app's network —
 * not a broad private range, which would also cover a client that could then
 * forge its own hop. Find it with
 * `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' coolify-proxy`
 * and set `TRUSTED_PROXIES` to it, comma-separated if there is more than one.
 */
export function trustedProxies(): string[] {
  const configured = process.env.TRUSTED_PROXIES;
  if (configured === undefined) return DEVELOPMENT_TRUSTED_PROXIES;

  return configured
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Loopback only. In development and in tests nothing forwards, so the chain is
 * one hop long and this list is never consulted.
 */
const DEVELOPMENT_TRUSTED_PROXIES = ["127.0.0.1", "::1"];

/** Entries that are neither an IP address nor a CIDR range. */
export function invalidProxyEntries(entries: string[]): string[] {
  return entries.filter((entry) => !isIpOrCidr(entry));
}

function isIpOrCidr(entry: string): boolean {
  const slash = entry.lastIndexOf("/");
  const address = slash === -1 ? entry : entry.slice(0, slash);

  if (slash !== -1) {
    const prefix = entry.slice(slash + 1);
    if (!/^\d+$/.test(prefix)) return false;
    const maximum = address.includes(":") ? 128 : 32;
    if (Number(prefix) > maximum) return false;
  }

  return isIpv4(address) || isIpv6(address);
}

function isIpv4(address: string): boolean {
  const octets = address.split(".");
  if (octets.length !== 4) return false;
  return octets.every(
    (octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255,
  );
}

function isIpv6(address: string): boolean {
  if (!address.includes(":")) return false;
  if ((address.match(/::/g) ?? []).length > 1) return false;
  const groups = address.split(":").filter((group) => group.length > 0);
  return groups.every((group) => /^[0-9a-fA-F]{1,4}$/.test(group));
}

/**
 * Refuse to start misconfigured. Throws, listing everything that is wrong at
 * once rather than one restart per mistake.
 */
export function assertAuthEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const problems: string[] = [];

  if (!environment.APP_URL) {
    problems.push("APP_URL is not set: Sign-in Links would point at localhost");
  }

  if (!environment.AUTH_SECRET) {
    problems.push("AUTH_SECRET is not set: every restart would sign everyone out");
  }

  const proxies = environment.TRUSTED_PROXIES;
  if (!proxies) {
    problems.push(
      "TRUSTED_PROXIES is not set: behind the proxy no client IP can be derived, " +
        "so Continue would refuse every press",
    );
  } else {
    const entries = proxies
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (entries.length === 0) {
      problems.push("TRUSTED_PROXIES is empty");
    }

    const invalid = invalidProxyEntries(entries);
    if (invalid.length > 0) {
      problems.push(
        `TRUSTED_PROXIES has entries that are not an IP or CIDR range: ${invalid.join(", ")}`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Launch Tasks cannot start:\n- ${problems.join("\n- ")}\n` +
        "Sign-in is the only way into this product, so these are refused rather than warned about.",
    );
  }
}

if (process.env.NODE_ENV === "production") {
  assertAuthEnvironment();
}
