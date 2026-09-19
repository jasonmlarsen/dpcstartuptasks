import { trustedProxies } from "./config";
import { formatIp, ipToBytes, parseCidr, withinCidr, type Cidr } from "./ip-address";

/**
 * Who is actually asking, as far as the proxy chain can be trusted to say.
 *
 * `X-Forwarded-For` is a list a client can prepend to, so the leftmost entry
 * is whatever the client felt like claiming. The only trustworthy reading is
 * from the right: our own proxies appended the hops nearest us, so we skip
 * hops we recognise as ours and take the first one we do not.
 *
 * It fails closed and returns `null` — no forwarded header in production, a
 * malformed hop, or a chain that is trusted all the way down. The per-IP
 * control on Continue treats that as a refusal rather than as an unlimited
 * bucket, which is why `TRUSTED_PROXIES` is a startup assertion and not a
 * warning (ADR-0004).
 */
export function clientIpAddress(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");

  if (!forwarded) {
    // In development and in tests nothing is in front of the app, so the
    // request never crossed a network and the connection is the client. In
    // production every request arrives through the proxy, so one that carries
    // no chain did not come the way requests come, and is refused.
    return process.env.NODE_ENV === "production" ? null : "127.0.0.1";
  }

  const hops = forwarded
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0);

  const proxies = trustedProxies()
    .map(parseCidr)
    .filter((proxy): proxy is Cidr => proxy !== null);

  for (let index = hops.length - 1; index >= 0; index--) {
    const bytes = ipToBytes(hops[index] ?? "");
    // A hop we cannot parse breaks the chain: everything to its left is
    // unverifiable, so there is no client IP here at all.
    if (!bytes) return null;
    if (proxies.some((proxy) => withinCidr(bytes, proxy))) continue;
    return formatIp(bytes);
  }

  return null;
}
