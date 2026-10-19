# TikTok Ads for Swell

A Swell integration app that reports a store's online purchases to TikTok Ads from the server, through the TikTok Events API. TikTok then credits each sale to the ad that brought the shopper, and its bidding learns who buys. The app only reads the store.

Ad blockers, closed tabs and browser privacy rules stop many purchases that a browser Pixel would report. A purchase sent from the server is stopped by none of them. TikTok can credit it when it recognises the shopper, so the app sends every match key it has: the customer's details from the order, hashed, and, when the storefront hands them over, TikTok's click id, the Pixel's `_ttp` cookie and the shopper's IP address and user agent.

This app is for ads that send shoppers to your own store. It is not TikTok Shop.

## Setup

### What you need from TikTok

A TikTok Ads Manager account with a Pixel for your website:

1. In TikTok Ads Manager open **Tools → Events → Connect data source → Web → Manual setup** and choose **TikTok Pixel + Events API**.
2. Copy the **Pixel code** shown at the top of the Pixel.
3. Open the Pixel's **Settings** and press **Generate Access Token**. One token works for every Pixel of the ad account.

No TikTok developer account is needed.

### Install and connect

1. Install the app and open it under **Apps** in the Swell dashboard.
2. Paste the Pixel code and the access token, save, and press **Test connection**. It checks both with TikTok without sending an event.
3. Turn on **Send purchases to TikTok**.
4. Add the [storefront integration](#storefront-integration), or paste the [checkout snippet](#no-code-fallback-the-checkout-snippet) if you have no developer.

The test and live environments of a store have separate settings.

### Check it with TikTok's Test Events

1. In TikTok Ads Manager open the Pixel's **Test events** tab and copy the code under **Test server-side events**.
2. Paste it into **Test event code** in the app's settings and save. While it is set, purchases appear only in the Test events tab and are not counted.
3. Open your store with `?ttclid=test123` added to the address, add an item and place an order.
4. The Purchase appears in the Test events tab under "Server", with the order's value, its products and the click id `test123`.
5. Clear the test event code and save.

### Settings

| Setting | What it does |
| --- | --- |
| Pixel code, Access token | Your TikTok Pixel and the token generated for it |
| Test event code | While set, purchases go to the Pixel's Test events tab only |
| Test connection | Checks the saved Pixel code and token with TikTok. Save the settings first |
| Send purchases to TikTok | Off after install. While it is off, nothing is sent or kept, and orders placed meanwhile are not sent later |

## What is sent

One event, `Purchase`, when an order is placed through a storefront (`order.submitted`). Implemented by `functions/track-order.ts`.

- **Online orders only.** An order counts when it comes from a cart that is not a draft. Orders created in the dashboard (they use a draft cart), subscription renewals and orders imported by other apps have no TikTok ad behind them and are not sent.
- **Once per order.** The event id is the Swell order id. TikTok ignores a second event with the same id for 48 hours, so a retried delivery is never counted twice. A merchant who also fires Purchase from the TikTok Pixel uses the same id (see [TikTok Pixel on the storefront](#tiktok-pixel-on-the-storefront)) and TikTok merges the two.

| Field | Value |
| --- | --- |
| `event_id` | Order id |
| `event_time` | When the order was placed, also when the delivery is retried |
| `value`, `currency` | Order grand total and currency |
| `order_id` | Order number |
| `contents`, `content_ids`, `content_type: product` | One entry per line: variant SKU, else product SKU, else product id; product name, unit price, quantity |
| `user` | SHA-256 of the customer's email, phone (E.164), customer id, first and last name and zip code. City, state and country lowercased, and the shopper's locale. The click id, `_ttp`, IP address and user agent when the storefront handed them over |
| `page.url` | The address of the page that handed over the keys (the storefront, or hosted checkout for the snippet), else the store's address, + `/checkout`. Never the real checkout address, which holds the checkout id |

The address used for name, zip, city, state and country is the billing address, or the shipping address when billing has no location. Product categories are not sent.

### When TikTok refuses

| TikTok's answer | What happens |
| --- | --- |
| Token or Pixel code refused (`40001`, `40102`, `40104`, `40105`) | The delivery is retried, and the store's administrators get an email from the app, once per incident. Once the token is fixed, the waiting purchases go out at their next retry, with their original times |
| Pixel throttled (`40132`) | Retried, and the administrators get an email: TikTok says this can mean the token is used elsewhere too |
| Invalid payload (`40002`) | Not retried. A purchase that carried keys from the browser is sent once more without them, as they are the only values the app does not build itself. Otherwise the administrators get an email with TikTok's reason, which the settings cannot fix |
| Rate limit, outage, timeout | Retried |

Swell retries a failing delivery with gaps that grow to a few hours, and to 12 hours on every tenth failure of the function. While deliveries keep failing, Swell also sends the administrators its own daily warning about the app's function. The app stops retrying a purchase 47 hours after its first failure: an attempt that timed out may have reached TikTok, and a copy sent after TikTok's 48-hour duplicate window would count as a second sale. A purchase whose next retry comes after that is lost, and the email has told the administrators.

**Test connection** clears an open token or throttling problem once TikTok accepts the Pixel code and token, and a new problem sends a new email. Any problem seen again after a quiet day sends a new email.

## Storefront integration

Without it, purchases match on the customer's hashed details only. With it, each purchase also carries TikTok's click id, the `_ttp` cookie, the IP address and the user agent, the keys TikTok matches best. The storefront's developer adds two touch points, about 15 lines. Nothing goes to TikTok from the browser: the touch points only hand the keys to the app, which keeps them with the shopper's cart until the order is placed.

### The contract

| Touch point | When | What |
| --- | --- | --- |
| 1. Keep the click id | Every page load, in the browser | If the address has `?ttclid=…`, store it in a first-party cookie `ttclid` for 30 days. TikTok adds it only to the page the shopper lands on from an ad. The TikTok Pixel sets the same cookie |
| 2. Hand over the keys | Once the cart exists, from the browser: right after a successful add to cart, or right before the browser goes to the checkout address when the cart is built on the server | `swell.functions.post("tiktokads", "capture", { checkout_id, ttclid, ttp })`, with the cart's `checkout_id` and the values of the `ttclid` and `_ttp` cookies |

- The call must come from the shopper's browser, not from server code: the app reads the IP address and user agent from it.
- The cart is named by its `checkout_id`, the secret in its checkout address. The browser reads it from its cart: `swell.cart.addItem()` resolves with the cart, and `swell.cart.get()` reads it. The storefront session is not used to name the cart.
- The app keeps the first value of each key per cart and never overwrites it, so calling again is harmless.
- When the call sits before a redirect, await it (at most about 2 seconds), because leaving the page cancels it.
- The route `POST /functions/tiktokads/capture` answers with the names of the keys it holds for the cart, for example `{"keys":["ttclid","ttp","ip","user_agent"]}`, never with their values. `{"keys":[],"enabled":false}` means the app is switched off.

### Reference implementation

[`storefront/tiktok-ads.js`](storefront/tiktok-ads.js) has both touch points as two functions on top of swell-js: `keepTikTokClickId()` and `handOverTikTokKeys(swell, cart)`. The second reads the cart when it is not given one, calls the app again for the same cart only while the app has not kept every key the browser holds (a `_ttp` cookie set after a consent banner, say), never throws, and gives up after 2 seconds, so it cannot break or hold up the checkout.

### Prompt for an AI coding agent

[`storefront/agent-prompt.md`](storefront/agent-prompt.md) is a self-contained task for an AI coding agent. Paste it into the agent in the storefront's repository. It names both touch points, says where to put them and ends with the acceptance check:

1. Open the storefront with `?ttclid=test123`.
2. Browse to another page and add an item to the cart.
3. The `capture` request answers with `ttclid` among its keys.

### No-code fallback: the checkout snippet

A store without a developer pastes [`storefront/checkout-snippet.html`](storefront/checkout-snippet.html) into **Settings → Checkout → Checkout scripts → Head scripts**. It names the cart by its checkout id and hands over the shopper's IP address and user agent. It runs once per checkout page, although checkout runs head scripts again on every change.

It hands over the click id and `_ttp` only when the hosted checkout runs on the storefront's own address and the TikTok Pixel runs on the storefront. For storefront apps, checkout runs on the store's address, where the storefront's cookies are not visible, so the storefront integration above is the way to get them.

### TikTok Pixel on the storefront

The app sends Purchase only. TikTok's Diagnostics then reports "Missing events" for the Pixel, and TikTok says a full funnel lowers the cost per purchase. The browser events (page views, ViewContent, AddToCart, InitiateCheckout) belong to the TikTok Pixel on the storefront.

A store whose Pixel also fires Purchase must use the order id as its event id, so TikTok merges the browser and server copies. In checkout head scripts, after the TikTok Pixel's base code, `order` is set on the confirmation page only, so the call checks for it:

```html
<script>
  (function () {
    var orderId = "{{ order.id }}";
    if (!orderId || !window.ttq || window.__tiktokPurchase === orderId) return;
    window.__tiktokPurchase = orderId;
    ttq.track("Purchase", { value: Number("{{ order.grand_total }}"), currency: "{{ order.currency }}" }, { event_id: orderId });
  })();
</script>
```

## Privacy

- **What leaves Swell hashed, and what in clear.** Email, phone, customer id, first and last name and zip code are sent as SHA-256 hashes. City, state, country and locale, and the IP address, user agent, click id and `_ttp` cookie, are sent in clear, as TikTok requires. The app collects the last four when the storefront or checkout hands over the keys, and deletes them once TikTok has accepted the purchase. Everything else it collected is deleted after 7 days (`functions/cleanup.ts`): carts that never became orders, orders that are not sent (such as a cart finished in the dashboard) and purchases TikTok refused. A cart older than 7 days at its order has lost its keys by then.
- **Consent.** TikTok has no consent flag for server events in the EEA and UK, and its US "limited data use" flag needs an opt-out signal Swell does not have. The app sends a purchase with the customer's hashed details for every online order. Where consent is required, gate the storefront touch points and the checkout snippet with your consent tool, and decide whether to use the app at all.
- **Prohibited data.** TikTok forbids data about health, finances and children, also in product names. Stores in those categories should not use this app.

## Limits

- **Purchase only.** TikTok's Diagnostics reports "Missing events" for the Pixel until the TikTok Pixel on the storefront sends the browser events. There is no InitiateCheckout from the server: the capture route is public, so a script could fill the Pixel with fake checkouts.
- **Online orders only**, as described under [What is sent](#what-is-sent). Subscription renewals, refunds and sign-ups are not sent; TikTok has no refund event.
- **No past orders.** Orders placed before the app was switched on, or while it was off, are never sent.
- **No product categories or brands**, and no catalog sync for Video Shopping Ads. The content id is the SKU, so a catalog added later in TikTok matches.
- **IP address on custom domains.** The shopper's IP is read from the address chain Swell's gateway receives through Cloudflare. A custom domain with another Cloudflare hop in front leaves the IP out rather than guess it; the purchase is still sent.
- **Environments.** Test and live have separate settings. In test, use a test event code so purchases do not count.

## Development

```bash
npm install
npm test            # unit tests, no network
npm run typecheck
swell app push      # deploys to the test environment of the logged-in store
```

Use `swell app push --force` after a change that touches only `functions/lib/`: push skips function files whose own content did not change. A TikTok test event code in the settings keeps test orders out of the Pixel's real data.

### Structure

| Path | Purpose |
| --- | --- |
| `swell.json` | Manifest: read-only permissions and the listing's short description and images. Orders (the order), carts (whether the order came from a storefront, and the cart `capture` names by checkout id), accounts (email and phone), products (SKU and name) |
| `settings/tiktok.json` | Pixel code, access token, test event code, the on/off switch and Test connection |
| `functions/track-order.ts` | `order.submitted` → Purchase |
| `functions/capture.ts` | Public route that keeps the browser's match keys per cart |
| `functions/test-connection.ts` | Settings action that checks the Pixel code and token |
| `functions/cleanup.ts` | Every 10 minutes: deletes match keys older than 7 days |
| `functions/lib/` | TikTok client, hashing, the order mapper, IP parsing, problem records |
| `models/checkouts.json` | Match keys per cart. No dashboard view |
| `models/issues.json`, `notifications/alert.*` | Open problems and the email they send |
| `storefront/` | Reference code, agent prompt and checkout snippet |
| `test/unit/` | Unit tests; TikTok and the store are stand-ins |

### App Store listing

| What | Where |
| --- | --- |
| Full description | `DESCRIPTION.md` |
| Short description | `description` in `swell.json` (up to 70 characters) |
| Icon | `assets/icon.png` (600 × 600, the square filled: the dashboard rounds the corners itself) |
| Screenshots | `assets/images/*.png` (3200 × 1800), listed in `images` in `swell.json` |

The listing uses the name TikTok only to say which service the app connects to, and no TikTok logo: TikTok allows its logos only with its prior written permission.

## License

[MIT](LICENSE.md). TikTok is a trademark of its owner. This app is made by Swell and is not made, sponsored or endorsed by TikTok.
