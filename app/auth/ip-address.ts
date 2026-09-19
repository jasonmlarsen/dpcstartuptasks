/**
 * Reading IP addresses and CIDR ranges, in one place.
 *
 * One parser, used by both the startup assertion and the client-IP derivation,
 * because two of them is worse than none: an entry the assertion accepts and
 * the derivation then drops is a `TRUSTED_PROXIES` that boots clean and
 * refuses every Continue press, which is exactly the failure the assertion
 * exists to prevent.
 */

export interface Cidr {
  bytes: Uint8Array;
  prefix: number;
}

/**
 * An IP address or `address/prefix` range, or `null` if it is neither. The
 * prefix must be digits only and within the address family, so `10.0.0.0/40`
 * and `10.0.0.0/1e1` are both refusals rather than quiet near-misses.
 */
export function parseCidr(entry: string): Cidr | null {
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

/** Whether an address falls inside a network. */
export function withinCidr(address: Uint8Array, network: Cidr): boolean {
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

export function ipToBytes(address: string): Uint8Array | null {
  if (!address.includes(":")) return ipv4ToBytes(address);

  // `::ffff:192.0.2.1` is an IPv4 client seen through an IPv6 socket, and
  // keying it separately would give the same client two buckets.
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return ipv4ToBytes(mapped[1]);

  return ipv6ToBytes(address);
}

/** A canonical spelling, so one client cannot occupy two rate-limit buckets. */
export function formatIp(bytes: Uint8Array): string {
  if (bytes.length === 4) return Array.from(bytes).join(".");

  const groups: string[] = [];
  for (let index = 0; index < 16; index += 2) {
    const value = ((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0);
    groups.push(value.toString(16).padStart(4, "0"));
  }
  return groups.join(":");
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
  const right = halves[1] ? halves[1].split(":") : [];
  const groups =
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
      : left;

  // Eight groups exactly. A short address that never wrote `::` — `1:2:3` —
  // is a typo, and reading it as anything would be guessing.
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
