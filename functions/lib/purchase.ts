/**
 * The Purchase event TikTok gets for an order: what was bought, for how much, and every match
 * key Swell and the shopper's browser provided.
 */

import { hashed, normalizeEmail, normalizeName, normalizePhone, normalizePlace, normalizeZip } from "./match-keys";

type Row = Record<string, any>;

/** The match keys the storefront or the checkout snippet handed over for the order's cart */
export interface Captured {
  ttclid?: string;
  ttp?: string;
  ip?: string;
  user_agent?: string;
  /** Origin of the page that handed them over, such as https://shop.example.com */
  origin?: string;
}

export interface PurchaseEvent {
  event: "Purchase";
  event_time: number;
  event_id: string;
  user: Record<string, string>;
  page: { url: string };
  properties: {
    currency: string;
    value: number;
    order_id: string;
    content_type: "product";
    contents: { content_id: string; content_name?: string; price: number; quantity: number }[];
    content_ids: string[];
    num_items: number;
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function amount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

/** The catalog id TikTok matches products by: variant SKU, then product SKU, then product id */
export function contentId(item: Row): string {
  return text(item.variant?.sku) || text(item.product?.sku) || text(item.product_id);
}

/** The address with the shopper's location: billing, or shipping when billing has none */
function address(order: Row): Row {
  const located = (candidate: Row | undefined) => Boolean(candidate?.country || candidate?.zip || candidate?.city);
  if (located(order.billing)) {
    return order.billing;
  }
  if (located(order.shipping)) {
    return order.shipping;
  }
  return order.billing || order.shipping || {};
}

/** The scheme and host of an address, or undefined when it is not an http(s) address */
export function originOf(value: unknown): string | undefined {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

async function userKeys(order: Row, captured: Captured | undefined): Promise<Record<string, string>> {
  const account: Row = order.account || {};
  const place = address(order);
  const country = text(place.country) || text(order.shipping?.country) || text(order.billing?.country);
  const phone =
    normalizePhone(account.phone, country) ||
    normalizePhone(order.billing?.phone, order.billing?.country || country) ||
    normalizePhone(order.shipping?.phone, order.shipping?.country || country);
  const locale = text(order.display_locale) || text(account.locale);

  const keys: Record<string, string | undefined> = {
    email: await hashed(normalizeEmail(account.email)),
    phone: await hashed(phone),
    external_id: await hashed(text(order.account_id)),
    first_name: await hashed(normalizeName(place.first_name || account.first_name)),
    last_name: await hashed(normalizeName(place.last_name || account.last_name)),
    zip_code: await hashed(normalizeZip(place.zip, country)),
    city: normalizePlace(place.city) || undefined,
    state: normalizePlace(place.state) || undefined,
    country: normalizePlace(country) || undefined,
    locale: /^[a-z]{2,3}([-_][a-z0-9]{2,8})*$/i.test(locale) ? locale.replaceAll("_", "-") : undefined,
    ttclid: captured?.ttclid,
    ttp: captured?.ttp,
    ip: captured?.ip,
    user_agent: captured?.user_agent,
  };

  return Object.fromEntries(Object.entries(keys).filter((entry): entry is [string, string] => Boolean(entry[1])));
}

/**
 * The Purchase event for an order read with `account`, `items.product` and `items.variant`
 * expanded. `storeUrl` is the store's address, used for the page when no browser origin was captured.
 */
export async function purchaseEvent(order: Row, captured: Captured | undefined, storeUrl: string): Promise<PurchaseEvent> {
  const contents = ((order.items || []) as Row[])
    .filter((item) => contentId(item) && Number(item.quantity) > 0)
    .map((item) => {
      const name = text(item.product?.name) || text(item.product_name);
      return {
        content_id: contentId(item),
        ...(name ? { content_name: name } : {}),
        price: amount(item.price),
        quantity: Number(item.quantity),
      };
    });

  // Never the real checkout address: its path holds the checkout id, which opens the
  // shopper's checkout with their email and addresses
  const origin = originOf(captured?.origin) || originOf(storeUrl) || "";

  return {
    event: "Purchase",
    event_time: Math.floor(new Date(order.date_created).getTime() / 1000),
    event_id: text(order.id),
    user: await userKeys(order, captured),
    page: { url: `${origin}/checkout` },
    properties: {
      currency: text(order.currency).toUpperCase(),
      value: amount(order.grand_total),
      order_id: text(order.number) || text(order.id),
      content_type: "product",
      contents,
      content_ids: [...new Set(contents.map((content) => content.content_id))],
      num_items: contents.reduce((total, content) => total + content.quantity, 0),
    },
  };
}
