import { KEYS, keepKeys } from "./lib/checkouts";
import { clientIp } from "./lib/ip";
import { originOf } from "./lib/purchase";
import type { Captured } from "./lib/purchase";
import { activeCredentials, readSettings } from "./lib/settings";

export const config: SwellConfig = {
  description: "Keep the TikTok match keys of a shopper's cart: click id, _ttp cookie, IP address and user agent",
  route: {
    methods: ["post"],
    public: true,
    // Only what the app reads. The shopper's cookies, the storefront session among them,
    // never reach the app
    headers: ["user-agent", "x-forwarded-for", "origin"],
  },
};

type Row = Record<string, any>;

/** An opaque value from the browser: printable characters without spaces, within a length */
function token(value: unknown, maxLength: number): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length <= maxLength && /^[\x21-\x7e]+$/.test(text) ? text : undefined;
}

/**
 * The shopper's cart, named by its checkout id: the secret already in the cart's checkout
 * address, which the shopper's browser reads from its cart. The storefront session is not used:
 * its content is not signed, so it cannot prove which cart a caller holds.
 */
async function findCart(req: SwellRequest, body: Row): Promise<Row | undefined> {
  if (typeof body.checkout_id !== "string" || !/^[0-9a-f]{32}$/i.test(body.checkout_id)) {
    return undefined;
  }
  const found = (await req.swell.get("/carts", {
    where: { checkout_id: body.checkout_id },
    fields: "order_id",
    limit: 1,
  })) as { results?: Row[] };
  return found?.results?.[0];
}

/**
 * Answers with the names of the keys held for the cart, never with their values or other cart data,
 * so a developer can check the integration without TikTok.
 */
export async function post(req: SwellRequest) {
  // Off means silent: nothing is kept until the app is switched on
  if (!activeCredentials(await readSettings(req.swell))) {
    return { keys: [], enabled: false };
  }

  const body: Row = req.body && typeof req.body === "object" ? req.body : {};
  const cart = await findCart(req, body);
  if (!cart) {
    throw new SwellError(
      "No cart found. Call capture from the shopper's browser once their cart exists, with the cart's checkout_id.",
      { status: 400 },
    );
  }
  // The order is placed and on its way to TikTok: nothing is added any more
  if (cart.order_id) {
    return { keys: [] };
  }

  const keys: Captured = {
    ttclid: token(body.ttclid, 1000),
    ttp: token(body.ttp, 200),
    ip: clientIp(req.headers.get("x-forwarded-for")),
    user_agent: (req.headers.get("user-agent") || "").trim().slice(0, 1000) || undefined,
    origin: originOf(req.headers.get("origin")),
  };
  const record = await keepKeys(req.swell, cart.id, keys);
  return { keys: KEYS.filter((key) => record?.[key]) };
}
