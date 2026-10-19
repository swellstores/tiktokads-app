/**
 * The app's `checkouts` collection: one record per cart with the match keys only a browser
 * knows. The storefront (or the checkout snippet) adds them through the `capture` route, and
 * `track-order` reads them when the cart becomes an order, then deletes the record.
 */

import type { Captured } from "./purchase";
import type { StoreClient } from "./issues";

export type Checkout = Captured & { id: string; cart_id: string; date_created?: string };

/** The keys a record can hold, in the order the route lists them */
export const KEYS = ["ttclid", "ttp", "ip", "user_agent"] as const;

export async function findCheckout(swell: StoreClient, cartId: string): Promise<Checkout | undefined> {
  const found = (await swell.get("/checkouts", { where: { cart_id: cartId }, limit: 1 })) as { results?: Checkout[] };
  return found?.results?.[0];
}

/** Never throws: a record left behind is deleted by `cleanup` after a week. True when deleted */
export async function deleteCheckout(swell: StoreClient, id: string): Promise<boolean> {
  try {
    await swell.delete(`/checkouts/${id}`);
    return true;
  } catch (err) {
    console.error("Unable to delete the captured match keys", (err as Error).message);
    return false;
  }
}

/** Status of an error thrown by the store client, when it has one */
function status(err: unknown): number | undefined {
  return (err as { status?: number })?.status;
}

/**
 * Keeps the given keys for a cart. The first value of each key is kept and never overwritten,
 * so a later caller cannot replace what the shopper's browser handed over. Returns the record.
 */
export async function keepKeys(swell: StoreClient, cartId: string, keys: Captured): Promise<Checkout | undefined> {
  const existing = await findCheckout(swell, cartId);
  if (!existing) {
    try {
      return (await swell.post("/checkouts", { cart_id: cartId, ...keys })) as Checkout;
    } catch (err) {
      // Two calls for the same cart at once: the other one created the record first
      if (status(err) !== 400) {
        throw err;
      }
      const created = await findCheckout(swell, cartId);
      if (!created) {
        throw err;
      }
      return fillGaps(swell, created, keys);
    }
  }
  return fillGaps(swell, existing, keys);
}

async function fillGaps(swell: StoreClient, record: Checkout, keys: Captured): Promise<Checkout> {
  const missing = Object.fromEntries(
    Object.entries(keys).filter(([key, value]) => value && !record[key as keyof Captured]),
  );
  if (Object.keys(missing).length === 0) {
    return record;
  }
  return { ...record, ...((await swell.put(`/checkouts/${record.id}`, missing)) as Checkout) };
}
