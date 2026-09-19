import { trustedProxies } from "./config";

/**
 * Who is actually asking, as far as the proxy chain can be trusted to say.
 *
 * `X-Forwarded-For` is a list a client can prepend to, so the leftmost entry
 * is whatever the client felt like claiming. The only trustworthy reading is
 * from the right: our own proxies appended the hops nearest us, so we skip
 * hops we recognise as ours and take the first one we do not.
 *
 * It fails closed and returns `null` — no forwarded header, a malformed hop,
 * or a chain that is trusted all the way down. The per-IP control on Continue
 * treats that as a refusal rather than as an unlimited bucket, which is why
 * `TRUSTED_PROXIES` is a startup assertion and not a warning (ADR-0004).
 */
export function clientIpAddress(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");

  if (!forwarded) {
    // Direct connections happen in development and in tests, where nothing is
    // in front of the app and the request never crossed a network.
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
    return normalise(bytes);
  }

  return null;
}

interface Cidr {
  bytes: Uint8Array;
  prefix: number;
}

function parseCidr(entry: string): Cidr | null {
  const slash = entry.lastIndexOf("/");
  const bytes = ipToBytes(slash === -1 ? entry : entry.slice(0, slash));
  if (!bytes) return null;

  const maximum = bytes.length * 8;
  if (slash === -1) return { bytes, prefix: maximum };

  const prefixText = entry.slice(slash + 1);
  if (!/^\d+$/.test(prefixText)) return null;

  const prefix = Number(prefixText);
  return prefix <= maximum ? { bytes, prefix } : null;
}

function withinCidr(address: Uint8Array, network: Cidr): boolean {
  if (address.length !== network.bytes.length) return false;

  let remaining = network.prefix;
  for (let index = 0; index < address.length && remaining > 0; index++) {
    const take = Math.min(8, remaining);
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
    if (((address[index] ?? 0) & mask) !== ((network.bytes[index] ?? 0) & mask)) {
      return false;
    }
    remaining -= 8;
  }
  return true;
}

function ipToBytes(address: string): Uint8Array | null {
  if (!address.includes(":")) return ipv4ToBytes(address);

  // `::ffff:192.0.2.1` is an IPv4 client seen through an IPv6 socket, and
  // keying it separately would give the same client two buckets.
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return ipv4ToBytes(mapped[1]);

  return ipv6ToBytes(address);
}

function ipv4ToBytes(address: string): Uint8Array | null {
  const octets = address.split(".");
  if (octets.length !== 4) return null;

  const bytes = new Uint8Array(4);
  for (let index = 0; index < 4; index++) {
    const octet = octets[index] ?? "";
    if (!/^\d{1,3}$/.test(octet)) return null;
    const value = Number(octet);
    if (value > 255) return null;
    bytes[index] = value;
  }
  return bytes;
}

function ipv6ToBytes(address: string): Uint8Array | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;

  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] !== undefined && halves[1] ? halves[1].split(":") : [];
  const groups =
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
      : left;

  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let index = 0; index < 8; index++) {
    const group = groups[index] ?? "";
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes[index * 2] = (value >> 8) & 0xff;
    bytes[index * 2 + 1] = value & 0xff;
  }
  return bytes;
}

/** A canonical spelling, so one client cannot occupy two rate-limit buckets. */
function normalise(bytes: Uint8Array): string {
  if (bytes.length === 4) return Array.from(bytes).join(".");

  const groups: string[] = [];
  for (let index = 0; index < 16; index += 2) {
    const value = ((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0);
    groups.push(value.toString(16).padStart(4, "0"));
  }
  return groups.join(":");
}
