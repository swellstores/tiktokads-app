import { deleteCheckout, findCheckout } from "./lib/checkouts";
import { recordIssue } from "./lib/issues";
import { purchaseEvent } from "./lib/purchase";
import { activeCredentials, readSettings, testEventCode } from "./lib/settings";
import { TikTokError, sendEvent } from "./lib/tiktok";

export const config: SwellConfig = {
  description: "Send each online order to TikTok as a Purchase",
  model: {
    events: ["order.submitted"],
    conditions: { $settings: { tiktok: { enabled: true } } },
  },
};

/**
 * TikTok drops a repeat of the same event id for 48 hours. Swell keeps retrying a failing
 * delivery, so a delivery stops before the 48 hours are over: a purchase sent later could be
 * counted twice, if an earlier attempt reached TikTok without an answer.
 */
export const RETRY_WINDOW_MS = 47 * 60 * 60 * 1000;

type Row = Record<string, any>;

/**
 * An order placed by a shopper through a storefront: it comes from a cart, and that cart is not
 * a draft. The dashboard's "New order" builds a draft cart; subscription renewals and orders
 * imported by other apps have no cart.
 */
async function isOnline(swell: SwellAPI, order: Row): Promise<boolean> {
  if (order.draft || !order.cart_id) {
    return false;
  }
  const cart = (await swell.get(`/carts/${order.cart_id}`, { fields: "draft" })) as Row | "";
  return Boolean(cart) && (cart as Row).draft !== true;
}

export default async function (req: SwellRequest) {
  const firstFailed = req.data.$event?.delivery?.date_first_failed;
  if (firstFailed && Date.now() - new Date(firstFailed).getTime() > RETRY_WINDOW_MS) {
    throw new SwellError(
      "TikTok did not accept this purchase within 47 hours. It is not sent again, because TikTok would count a later copy as a second sale.",
      { status: 410, retry: false },
    );
  }

  // Swell only calls the function while the app is switched on, but the merchant may have
  // switched it off since the order was placed
  const settings = await readSettings(req.swell);
  const credentials = activeCredentials(settings);
  if (!credentials) {
    return { skipped: "The app is switched off, or the Pixel code or access token is missing" };
  }

  const order = (await req.swell.get(`/orders/${req.data.id}`, {
    expand: ["account", "items.product", "items.variant"],
  })) as Row | "";
  if (!order) {
    return { skipped: "The order no longer exists" };
  }
  if (!(await isOnline(req.swell, order))) {
    return { skipped: "Not an online order: it has no cart, or its cart was made in the dashboard" };
  }

  const captured = await findCheckout(req.swell, order.cart_id);
  const testCode = testEventCode(settings);
  let event = await purchaseEvent(order, captured, req.store?.url);

  try {
    try {
      await sendEvent(credentials, event, testCode);
    } catch (err) {
      if (!(err instanceof TikTokError && err.kind === "invalid" && captured)) {
        throw err;
      }
      // The keys from the browser are the only values the app does not build itself. If TikTok
      // refuses the purchase with them, it goes out with the order's own keys
      console.warn("TikTok refused the purchase with the browser's keys, sending it without them:", err.message);
      event = await purchaseEvent(order, { origin: captured.origin }, req.store?.url);
      await sendEvent(credentials, event, testCode);
    }
  } catch (err) {
    if (!(err instanceof TikTokError)) {
      throw err;
    }
    const source = req.data.$event?.type || "order.submitted";
    switch (err.kind) {
      case "credentials":
        // Retried, so the purchases of the last 47 hours go out once the merchant fixes the token
        await recordIssue(req.swell, "credentials", err.message, source);
        throw new SwellError(err.message, { status: 401 });
      case "throttled":
        await recordIssue(req.swell, "throttled", err.message, source);
        throw new SwellError(err.message, { status: 429 });
      case "invalid":
        // Sending the same data again cannot help, so the admins hear of it
        await recordIssue(req.swell, "invalid", `Order ${order.number || order.id}: ${err.message}`, source);
        throw new SwellError(err.message, { status: 422, retry: false });
      default:
        throw new SwellError(err.message, { status: 503 });
    }
  }

  if (captured) {
    await deleteCheckout(req.swell, captured.id);
  }
  return {
    sent: "Purchase",
    event_id: event.event_id,
    match_keys: Object.keys(event.user),
    ...(testCode ? { test_event_code: testCode } : {}),
  };
}
