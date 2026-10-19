/**
 * The shopper's IP address from the `x-forwarded-for` header of a storefront call.
 *
 * Swell's gateway receives the call through Cloudflare, so the header ends with the address
 * Cloudflare saw (the shopper), one Cloudflare address and internal ones:
 * `<whatever the caller sent>, <shopper>, <Cloudflare>, <internal>`. Entries a caller sends
 * stay in front, so the header is read from the right: internal addresses are skipped, then
 * the one Cloudflare address, which must be there, and the next entry is the shopper. It is accepted only when it
 * is a public address and not Cloudflare's own, so a forged entry is never reached, also when
 * the caller sends the request through a Cloudflare Worker of their own.
 */

type Address = { version: 4; value: number } | { version: 6; groups: number[] };

// https://www.cloudflare.com/ips/ (checked 2026-10-16)
const CLOUDFLARE = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

// Ranges that never belong to a shopper: private, shared, loopback, link-local, documentation,
// benchmarking, multicast and reserved
const NOT_PUBLIC_V4 = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/3",
];

function parseV4(text: string): number | undefined {
  const parts = text.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
    return undefined;
  }
  return parts.reduce((value, part) => value * 256 + Number(part), 0);
}

function parseV6(text: string): number[] | undefined {
  let rest = text;
  let tail: number[] = [];
  // An IPv4 address in the last 32 bits, as in ::ffff:192.0.2.1
  const v4 = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(rest);
  if (v4) {
    const value = parseV4(v4[2]);
    if (value === undefined) {
      return undefined;
    }
    rest = `${v4[1]}0:0`;
    tail = [Math.floor(value / 65536), value % 65536];
  }
  const halves = rest.split("::");
  if (halves.length > 2) {
    return undefined;
  }
  const read = (half: string) => (half ? half.split(":") : []);
  const head = read(halves[0]);
  const end = halves.length === 2 ? read(halves[1]) : [];
  if ([...head, ...end].some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) {
    return undefined;
  }
  const missing = 8 - head.length - end.length;
  if ((halves.length === 2 && missing < 1) || (halves.length === 1 && missing !== 0)) {
    return undefined;
  }
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...end].map((group) => parseInt(group, 16));
  if (tail.length) {
    groups.splice(6, 2, ...tail);
  }
  return groups;
}

export function parseAddress(entry: string): Address | undefined {
  let text = entry.trim().toLowerCase();
  // [2001:db8::1]:443 and 192.0.2.1:443
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(text);
  if (bracketed) {
    text = bracketed[1];
  } else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(text)) {
    text = text.slice(0, text.lastIndexOf(":"));
  }
  text = text.replace(/%.*$/, "");

  const v4 = parseV4(text);
  if (v4 !== undefined) {
    return { version: 4, value: v4 };
  }
  const v6 = text.includes(":") ? parseV6(text) : undefined;
  if (!v6) {
    return undefined;
  }
  // IPv4-mapped IPv6 is the IPv4 address
  if (v6.slice(0, 5).every((group) => group === 0) && v6[5] === 0xffff) {
    return { version: 4, value: v6[6] * 65536 + v6[7] };
  }
  return { version: 6, groups: v6 };
}

function inRange(address: Address, cidr: string): boolean {
  const [base, bitsText] = cidr.split("/");
  const bits = Number(bitsText);
  const network = parseAddress(base);
  if (!network || network.version !== address.version) {
    return false;
  }
  if (address.version === 4 && network.version === 4) {
    const size = 2 ** (32 - bits);
    return Math.floor(address.value / size) === Math.floor(network.value / size);
  }
  const a = (address as { groups: number[] }).groups;
  const b = (network as { groups: number[] }).groups;
  for (let index = 0; index < 8; index++) {
    const remaining = bits - index * 16;
    if (remaining <= 0) {
      return true;
    }
    const mask = remaining >= 16 ? 0xffff : (0xffff << (16 - remaining)) & 0xffff;
    if ((a[index] & mask) !== (b[index] & mask)) {
      return false;
    }
  }
  return true;
}

function isCloudflare(address: Address): boolean {
  return CLOUDFLARE.some((cidr) => inRange(address, cidr));
}

export function isPublic(address: Address): boolean {
  if (address.version === 4) {
    return !NOT_PUBLIC_V4.some((cidr) => inRange(address, cidr));
  }
  // Global unicast, without the documentation range and the tunnels that wrap an IPv4
  // address (Teredo, 6to4, NAT64), whose inner address may be private
  return (
    inRange(address, "2000::/3") &&
    !["2001:db8::/32", "2001::/32", "2002::/16"].some((cidr) => inRange(address, cidr))
  );
}

function format(address: Address): string {
  if (address.version === 4) {
    return [24, 16, 8, 0].map((shift) => Math.floor(address.value / 2 ** shift) % 256).join(".");
  }
  return address.groups.map((group) => group.toString(16)).join(":");
}

/** The shopper's public IP address, or undefined when the header does not show one */
export function clientIp(forwardedFor: string | null | undefined): string | undefined {
  const entries = (forwardedFor || "").split(",").map(parseAddress);
  let index = entries.length - 1;
  while (index >= 0 && entries[index] && !isPublic(entries[index]!)) {
    index--;
  }
  // A hop that is not Cloudflare's (a new Cloudflare range, or another proxy in front) would be
  // sent as every shopper's address: the IP is left out instead
  if (index < 0 || !entries[index] || !isCloudflare(entries[index]!)) {
    return undefined;
  }
  const candidate = entries[index - 1];
  return candidate && isPublic(candidate) && !isCloudflare(candidate) ? format(candidate) : undefined;
}
