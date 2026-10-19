import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizeName, normalizePhone, normalizePlace, normalizeZip, sha256 } from "../../functions/lib/match-keys";

// The hashes of TikTok's own Purchase example (Events API parameters page)
const TIKTOK_EXAMPLE = {
  email: "848a771458438fc2ec420560d769fb9b9b86851ee338ec56517baabd79d3bb4f",
  phone: "9f7ec22d72092cd3c0b58726ed9c2d91b92e51a3f29837508fb2948bb22dd2fd",
  first_name: "81f8f6dde88365f3928796ec7aa53f72820b06db8664f5fe76a7eb13e24546a2",
  last_name: "6627835f988e2c5e50533d491163072d3f4f41f5c8b04630150debb3722ca2dd",
  zip_code: "383f7fffd99f3b1c3066086bcf991eae7ad543589d12bd792ecb6dc8b5acebc1",
};

describe("match keys", () => {
  it("hash to the same values as TikTok's example after normalising", async () => {
    expect(await sha256(normalizeEmail("  Alice_ABC@Gmail.com "))).toBe(TIKTOK_EXAMPLE.email);
    expect(await sha256(normalizePhone("(213) 373-4253", "US"))).toBe(TIKTOK_EXAMPLE.phone);
    expect(await sha256(normalizeName(" Jane "))).toBe(TIKTOK_EXAMPLE.first_name);
    expect(await sha256(normalizeName("SMITH"))).toBe(TIKTOK_EXAMPLE.last_name);
    expect(await sha256(normalizeZip("95110-1234", "US"))).toBe(TIKTOK_EXAMPLE.zip_code);
  });

  it("drops an email that cannot be an address", () => {
    expect(normalizeEmail("not an email")).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
  });

  it("writes phone numbers in E.164, reading a local number by the address country", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("0151 23456789", "DE")).toBe("+4915123456789");
    expect(normalizePhone("1-213-373-4253", "us")).toBe("+12133734253");
    expect(normalizePhone("0044 20 7946 0958", "GB")).toBe("+442079460958");
  });

  it("sends no phone rather than a wrong one", () => {
    expect(normalizePhone("213 373 4253")).toBe("");
    expect(normalizePhone("12345", "US")).toBe("");
    expect(normalizePhone("", "US")).toBe("");
  });

  it("keeps letters of any script in names and places, without punctuation or spaces", () => {
    expect(normalizeName("Jean-Luc O'Neil")).toBe("jeanluconeil");
    expect(normalizeName("Zoë")).toBe("zoë");
    expect(normalizeName("Ёлка")).toBe("ёлка");
    expect(normalizeName("प्रिया")).toBe("प्रिया");
    expect(normalizeName("José")).toBe("josé");
    expect(normalizePlace("San José")).toBe("sanjosé");
    expect(normalizePlace("US")).toBe("us");
  });

  it("writes zip codes without spaces or dashes", () => {
    expect(normalizeZip("SW1A 1AA", "GB")).toBe("sw1a1aa");
    expect(normalizeZip("10115", "DE")).toBe("10115");
  });
});
