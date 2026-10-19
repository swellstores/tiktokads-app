/**
 * Normalising and hashing the shopper's details the way TikTok matches them.
 * TikTok wants email, phone, external id, names and zip code as SHA-256 hex of the normalised
 * value, and city, state and country raw but normalised.
 */

import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import type { CountryCode } from "libphonenumber-js/min";

const encoder = new TextEncoder();

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Trimmed and lowercased; empty when it cannot be an address */
export function normalizeEmail(value: unknown): string {
  const email = text(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(email) ? email : "";
}

/**
 * E.164 (`+` and digits). A number written without its country code is read as a number of
 * `country`, the order's address country. Empty when the number is not valid, so a wrong
 * hash is never sent.
 */
export function normalizePhone(value: unknown, country?: unknown): string {
  const phone = text(value);
  if (!phone) {
    return "";
  }
  const region = text(country).toUpperCase();
  const parsed = parsePhoneNumberFromString(phone, /^[A-Z]{2}$/.test(region) ? (region as CountryCode) : undefined);
  return parsed?.isValid() ? parsed.number : "";
}

/** Lowercased, without punctuation or spaces. Letters of any script and their marks are kept */
export function normalizeName(value: unknown): string {
  return text(value)
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}

/** Lowercased, without spaces or dashes. US codes keep their first five digits */
export function normalizeZip(value: unknown, country?: unknown): string {
  const zip = text(value)
    .toLowerCase()
    .replace(/[\s-]/g, "");
  if (text(country).toUpperCase() === "US" && /^\d{5}/.test(zip)) {
    return zip.slice(0, 5);
  }
  return zip;
}

/** City, state or country as TikTok takes them raw: lowercased, letters and digits only */
export function normalizePlace(value: unknown): string {
  return normalizeName(value);
}

/** The hash of a normalised value, or undefined when there is nothing to hash */
export async function hashed(value: string): Promise<string | undefined> {
  return value ? sha256(value) : undefined;
}
