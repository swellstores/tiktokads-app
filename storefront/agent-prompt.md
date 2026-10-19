Add the TikTok Ads for Swell integration to this storefront.

The store runs the Swell app "TikTok Ads" (app id `tiktokads`). It sends every order to TikTok from Swell's servers. To credit the sale to the TikTok ad that brought the shopper, it needs two values only the shopper's browser knows: TikTok's click id and the TikTok Pixel's `_ttp` cookie. Add two small touch points that hand them to the app. Nothing here sends anything to TikTok.

## Touch point 1: keep the click id

On every page load, in the browser: if the address has a `ttclid` query parameter, store its value in a first-party cookie named `ttclid` (path `/`, 30 days, `SameSite=Lax`, `Secure` on https). Put it where it runs on every page, for example the root layout or a client component the layout renders. Server code may do it instead, as long as it sets the same cookie on any landing page.

## Touch point 2: hand over the keys once the cart exists

From the browser, never from server code (the app reads the shopper's IP address and user agent from this request), call:

```js
swell.functions.post("tiktokads", "capture", { checkout_id, ttclid, ttp });
```

where `swell` is the storefront's swell-js client, `checkout_id` is the `checkout_id` of the shopper's cart (`swell.cart.addItem()` resolves with the cart; `swell.cart.get()` reads it), `ttclid` is the value of the `ttclid` cookie and `ttp` the value of the `_ttp` cookie (either cookie may be missing).

Find where the storefront creates the cart and call it right after that:

- If the browser calls `swell.cart.addItem(...)` (or `setItems`), call it right after a successful add to cart, with the cart that call resolves with.
- If the cart is built on the server and the browser then goes to the cart's `checkout_url`, call it right before that redirect and await it (or wait at most 2 seconds), because leaving the page cancels the request.

Calling it again for the same cart is harmless, and needed when a `ttclid` or `_ttp` cookie appears later, for example after a cookie consent. It must never break the storefront: catch every error, and don't let it hold up the checkout for more than 2 seconds.

## Reference implementation

Use or adapt these two functions (plain JavaScript on swell-js):

```js
export function keepTikTokClickId() {
  const ttclid = new URLSearchParams(window.location.search).get("ttclid");
  if (!ttclid) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `ttclid=${encodeURIComponent(ttclid)}; Max-Age=${30 * 86400}; Path=/; SameSite=Lax${secure}`;
}

function readCookie(name) {
  const found = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  if (!found) return undefined;
  try {
    return decodeURIComponent(found.slice(name.length + 1));
  } catch {
    return found.slice(name.length + 1);
  }
}

// `cart` is optional: without it, the cart is read with swell.cart.get()
export async function handOverTikTokKeys(swell, cart, timeoutMs = 2000) {
  const giveUp = (err) => {
    console.warn("TikTok Ads: the match keys were not handed over", err);
    return undefined;
  };
  const handOver = async () => {
    const checkoutId = (cart || (await swell.cart.get()))?.checkout_id;
    if (!checkoutId) return undefined;
    const keys = { ttclid: readCookie("ttclid"), ttp: readCookie("_ttp") };
    const held = Object.keys(keys).filter((key) => keys[key]);
    try {
      // Skipped while the app has kept every key the browser holds for this cart
      const [doneId, doneKeys = ""] = (sessionStorage.getItem("tiktokads:cart") || "").split(":");
      if (doneId === checkoutId && held.every((key) => doneKeys.split(",").includes(key))) return undefined;
    } catch {}
    const body = { checkout_id: checkoutId, ...keys };
    // Tried twice: a cart created a moment ago is now and then not found at once
    const answer = await swell.functions.post("tiktokads", "capture", body).catch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return swell.functions.post("tiktokads", "capture", body);
    });
    // Done for this cart once the app is on and kept what the browser holds
    const kept = answer?.keys || [];
    if (answer && answer.enabled !== false && held.every((key) => kept.includes(key))) {
      try {
        sessionStorage.setItem("tiktokads:cart", `${checkoutId}:${held.join(",")}`);
      } catch {}
    }
    return answer;
  };
  const call = handOver().catch(giveUp);
  return Promise.race([call, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}
```

Match the storefront's language and style (TypeScript, React hooks, and so on). Change nothing else.

## Acceptance check

1. Open the storefront with `?ttclid=test123` added to the address of any page.
2. Browse to another page, then add an item to the cart (or go to checkout, if that is where the call sits).
3. In the browser's network tab, the `POST …/functions/tiktokads/capture` request answers 200 with `ttclid` among its keys, for example `{"keys":["ttclid","ip","user_agent"]}`. `ttp` appears too when the TikTok Pixel runs on the site.

If the answer is `{"keys":[],"enabled":false}`, the app is installed but switched off in the store's Swell dashboard. If the request answers 404 "Function … not found", the app is not installed in the store environment the storefront uses. If it answers 400 "No cart found", the call ran before the cart existed or without the cart's `checkout_id`.
