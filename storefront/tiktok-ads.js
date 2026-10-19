/**
 * TikTok Ads for Swell: the two storefront touch points.
 *
 * Framework-free, on top of swell-js. Copy this file into the storefront, or the two
 * functions into its own code. Both run in the browser only.
 *
 * 1. keepTikTokClickId() on every page load.
 * 2. handOverTikTokKeys(swell, cart) once the shopper's cart exists: right after a
 *    successful swell.cart.addItem(), or, when the storefront builds the cart on its server,
 *    right before the browser goes to the checkout address (await it before redirecting).
 */

const APP_ID = "tiktokads";
const CLICK_COOKIE = "ttclid";
const CLICK_DAYS = 30;
const HANDED_OVER = "tiktokads:cart";
const RETRY_MS = 500;

function readCookie(name) {
  const prefix = `${name}=`;
  const found = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  if (!found) {
    return undefined;
  }
  try {
    return decodeURIComponent(found.slice(prefix.length));
  } catch {
    return found.slice(prefix.length);
  }
}

/**
 * Touch point 1. TikTok adds ?ttclid=… to the address of the page a shopper lands on from an
 * ad. Keep it in a first-party cookie, because the shopper buys several pages later. The
 * TikTok Pixel sets the same cookie, so this changes nothing where the Pixel runs.
 */
export function keepTikTokClickId() {
  const ttclid = new URLSearchParams(window.location.search).get("ttclid");
  if (!ttclid) {
    return;
  }
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CLICK_COOKIE}=${encodeURIComponent(ttclid)}; Max-Age=${CLICK_DAYS * 86400}; Path=/; SameSite=Lax${secure}`;
}

/**
 * Touch point 2. Hands the click id and the TikTok Pixel's _ttp cookie to the TikTok Ads app.
 * The app adds the shopper's IP address and user agent from the request, and keeps all four
 * with the cart, which it finds by the cart's checkout id. Nothing goes to TikTok until the
 * order is placed.
 *
 * Call it from the browser, never from server code: the app reads the shopper's IP and user
 * agent from this request. Pass the cart when you have it (swell.cart.addItem() resolves with
 * it); without it, the cart is read with swell.cart.get(). Once the app has kept every key the
 * browser holds, later calls for the same cart are skipped until a new one appears. It never throws and gives up after
 * `timeoutMs`, so it can never hold up the checkout.
 *
 * Resolves with the app's answer, such as { keys: ["ttclid", "ttp", "ip", "user_agent"] },
 * or undefined when the call failed, timed out or was skipped.
 */
export async function handOverTikTokKeys(swell, cart, timeoutMs = 2000) {
  // The app may not be installed or switched on: the shopper must not notice
  const giveUp = (err) => {
    console.warn("TikTok Ads: the match keys were not handed over", err);
    return undefined;
  };
  const handOver = async () => {
    const checkoutId = (cart || (await swell.cart.get()))?.checkout_id;
    if (!checkoutId) {
      return undefined;
    }
    const keys = { ttclid: readCookie(CLICK_COOKIE), ttp: readCookie("_ttp") };
    const held = Object.keys(keys).filter((key) => keys[key]);
    try {
      // Skipped while the app has kept every key the browser holds for this cart, so a click
      // id or _ttp cookie that appears later (after a cookie consent, say) still goes over
      const [doneId, doneKeys = ""] = (sessionStorage.getItem(HANDED_OVER) || "").split(":");
      if (doneId === checkoutId && held.every((key) => doneKeys.split(",").includes(key))) {
        return undefined;
      }
    } catch {
      // Storage blocked: hand the keys over again, which is harmless
    }

    const body = { checkout_id: checkoutId, ...keys };
    // Tried twice: a cart created a moment ago is now and then not found at once
    const answer = await swell.functions.post(APP_ID, "capture", body).catch(async () => {
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      return swell.functions.post(APP_ID, "capture", body);
    });
    // Done for this cart once the app is on and kept what the browser holds. Otherwise try
    // again next time
    const kept = answer?.keys || [];
    if (answer && answer.enabled !== false && held.every((key) => kept.includes(key))) {
      try {
        sessionStorage.setItem(HANDED_OVER, `${checkoutId}:${held.join(",")}`);
      } catch {
        // See above
      }
    }
    return answer;
  };

  const call = handOver().catch(giveUp);
  return Promise.race([call, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}
