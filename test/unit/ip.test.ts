import { describe, expect, it } from "vitest";
import { clientIp, isPublic, parseAddress } from "../../functions/lib/ip";

describe("shopper IP from x-forwarded-for", () => {
  it("is the entry before Cloudflare's, as the probe saw it on dmprd", () => {
    expect(clientIp("81.2.69.160, 172.69.10.4, 10.42.3.7")).toBe("81.2.69.160");
  });

  it("works for IPv6 shoppers", () => {
    expect(clientIp("2a02:8108:1234:5600:ad1e:1:2:3, 2400:cb00:21:1024::a29e:1c4b, 10.42.3.7")).toBe("2a02:8108:1234:5600:ad1e:1:2:3");
  });

  it("never reaches an entry the caller sent", () => {
    expect(clientIp("9.9.9.9, 81.2.69.160, 162.158.1.1, 10.42.0.1")).toBe("81.2.69.160");
    expect(clientIp("9.9.9.9, 10.0.0.5, 162.158.1.1, 10.42.0.1")).toBeUndefined();
  });

  it("skips one Cloudflare address only, so a request sent through the caller's own Cloudflare Worker cannot plant an address", () => {
    expect(clientIp("9.9.9.9, 2a06:98c0:3600::103, 162.158.1.1, 10.42.0.1")).toBeUndefined();
    expect(clientIp("9.9.9.9, 104.16.5.5, 172.69.10.4, 10.42.0.1")).toBeUndefined();
  });

  it("refuses a Cloudflare address as the shopper, and a header with no public address", () => {
    expect(clientIp("162.158.1.2, 162.158.1.1, 10.42.0.1")).toBeUndefined();
    expect(clientIp("10.1.1.1, 192.168.1.1")).toBeUndefined();
    expect(clientIp("")).toBeUndefined();
    expect(clientIp(null)).toBeUndefined();
  });

  it("stops at an entry it cannot read", () => {
    expect(clientIp("81.2.69.160, unknown, 10.42.0.1")).toBeUndefined();
  });

  it("sends no IP rather than a proxy's when the hop in front of Swell is not Cloudflare's", () => {
    expect(clientIp("81.2.69.160, 1.1.1.1, 10.42.0.1")).toBeUndefined();
    expect(clientIp("81.2.69.160, 172.69.10.4, 35.190.1.1")).toBeUndefined();
  });

  it("reads mapped IPv4, ports and brackets", () => {
    expect(clientIp("::ffff:81.2.69.160, 172.69.10.4")).toBe("81.2.69.160");
    expect(clientIp("81.2.69.160:51234, 172.69.10.4")).toBe("81.2.69.160");
    expect(clientIp("[2a02:8108::1]:443, 2606:4700::1")).toBe("2a02:8108:0:0:0:0:0:1");
  });

  it("knows which addresses are public", () => {
    for (const address of ["10.0.0.1", "172.16.5.4", "192.168.0.1", "127.0.0.1", "100.64.1.1", "169.254.1.1", "203.0.113.9", "224.0.0.1", "255.255.255.255", "::1", "fe80::1", "fd00::1", "2001:db8::1", "2002:c0a8:101::1", "2001:0:4136:e378::1", "64:ff9b::c0a8:101"]) {
      expect(isPublic(parseAddress(address)!), address).toBe(false);
    }
    for (const address of ["81.2.69.160", "8.8.8.8", "172.32.0.1", "2a02:8108::1", "2001:4860:4860::8888"]) {
      expect(isPublic(parseAddress(address)!), address).toBe(true);
    }
  });

  it("refuses malformed addresses", () => {
    for (const address of ["256.1.1.1", "1.2.3", "1::2::3", "12345::1", "gggg::1", "1:2:3:4:5:6:7:8:9"]) {
      expect(parseAddress(address), address).toBeUndefined();
    }
  });
});
