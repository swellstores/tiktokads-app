import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { post as capture } from "../../functions/capture";
import cleanup, { KEEP_MS } from "../../functions/cleanup";
import testConnection from "../../functions/test-connection";
import trackOrder, { RETRY_WINDOW_MS } from "../../functions/track-order";
import { sha256 } from "../../functions/lib/match-keys";
import { storefrontOrder } from "../fixtures/orders";
import { createRequest } from "../helpers/request";
import { createStore } from "../helpers/store";
import type { TestStore } from "../helpers/store";
import { createTikTok } from "../helpers/tiktok";
import type { TestTikTok } from "../helpers/tiktok";

type Row = Record<string, any>;

let store: TestStore;
let tiktok: TestTikTok;

const SETTINGS = {
  id: "app-record",
  tiktok: { pixel_code: "DB8S3TBC77U3SVPIKJMG", access_token: "token-1", test_event_code: "TEST48123", enabled: true },
};
const CART_ID = "6ad1c390ea3885001207ce94";
const CHECKOUT_ID = "8ca186f7ed6f99640a00de24d3898c46";
// As the probe saw a browser's call: the shopper, then Cloudflare, then an internal hop
const BROWSER = {
  "x-forwarded-for": "81.2.69.160, 172.69.10.4, 10.42.3.7",
  "user-agent": "Mozilla/5.0 (iPhone)",
  origin: "https://shop.example.com",
};

function addOrder(overrides: Row = {}, cart: Row | null = {}): Row {
  const order = storefrontOrder(overrides);
  store.orders.push(order);
  if (cart) {
    store.carts.push({ id: order.cart_id, checkout_id: CHECKOUT_ID, order_id: order.id, ...cart });
  }
  return order;
}

function orderEvent(order: Row, delivery: Row = { attempts: 0 }): SwellRequest {
  return createRequest(store, { data: { id: order.id, $event: { type: "order.submitted", delivery } } });
}

function captureCall(body: Row = { checkout_id: CHECKOUT_ID }, options: { session?: Row | null; headers?: Record<string, string> } = {}) {
  return capture(createRequest(store, { body, session: options.session ?? null, headers: options.headers || BROWSER }));
}

async function failure(promise: Promise<unknown>): Promise<any> {
  return promise.then(
    () => {
      throw new Error("Expected a failure");
    },
    (err) => err,
  );
}

beforeEach(() => {
  store = createStore({ settings: structuredClone(SETTINGS) });
  tiktok = createTikTok();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("track-order", () => {
  it("is switched on by the merchant's toggle", async () => {
    const { config } = await import("../../functions/track-order");
    expect(config.model).toEqual({ events: ["order.submitted"], conditions: { $settings: { tiktok: { enabled: true } } } });
  });

  it("sends a storefront order to TikTok as a Purchase with the test event code", async () => {
    const order = addOrder();

    const result = (await trackOrder(orderEvent(order))) as Row;

    expect(tiktok.requests).toHaveLength(1);
    expect(tiktok.requests[0].body).toMatchObject({ event_source: "web", event_source_id: "DB8S3TBC77U3SVPIKJMG", test_event_code: "TEST48123" });
    expect(tiktok.events).toEqual([expect.objectContaining({ event: "Purchase", event_id: order.id })]);
    expect(tiktok.events[0].properties).toMatchObject({ value: 157.3, currency: "USD", content_ids: ["PACK-01"] });
    expect(result).toEqual({
      sent: "Purchase",
      event_id: order.id,
      match_keys: ["email", "phone", "external_id", "first_name", "last_name", "zip_code", "city", "state", "country"],
      test_event_code: "TEST48123",
    });
  });

  it("sends the browser's keys with the purchase, then deletes them", async () => {
    const order = addOrder({}, { order_id: null });
    await captureCall({ checkout_id: CHECKOUT_ID, ttclid: "E.C.P.test123", ttp: "UqBuLHl7TuWsDXUu-ViOGOLA5YP" });
    store.carts[0].order_id = order.id;

    await trackOrder(orderEvent(order));

    expect(tiktok.events[0].user).toMatchObject({
      ttclid: "E.C.P.test123",
      ttp: "UqBuLHl7TuWsDXUu-ViOGOLA5YP",
      ip: "81.2.69.160",
      user_agent: "Mozilla/5.0 (iPhone)",
    });
    expect(tiktok.events[0].page.url).toBe("https://shop.example.com/checkout");
    expect(store.checkouts).toHaveLength(0);
  });

  it("keeps the browser's keys while TikTok has not accepted the purchase", async () => {
    const order = addOrder({}, { order_id: null });
    await captureCall({ checkout_id: CHECKOUT_ID, ttclid: "E.C.P.test123" });
    tiktok.answer(50002, "Internal error");

    await failure(trackOrder(orderEvent(order)));

    expect(store.checkouts).toHaveLength(1);
  });

  it("sends the same event id when the order is delivered twice, so TikTok counts it once", async () => {
    const order = addOrder();

    await trackOrder(orderEvent(order));
    await trackOrder(orderEvent(order, { attempts: 1 }));

    expect(tiktok.events.map((event) => event.event_id)).toEqual([order.id, order.id]);
  });

  it("sends nothing for a dashboard order, whose cart is a draft", async () => {
    const order = addOrder({}, { draft: true });

    expect(await trackOrder(orderEvent(order))).toEqual({ skipped: expect.stringContaining("Not an online order") });
    expect(tiktok.requests).toHaveLength(0);
  });

  it("sends nothing for orders without a cart: renewals and imports", async () => {
    const order = addOrder({ cart_id: undefined }, null);

    expect(await trackOrder(orderEvent(order))).toEqual({ skipped: expect.stringContaining("Not an online order") });
    expect(tiktok.requests).toHaveLength(0);
  });

  it("sends nothing for a draft order or an order whose cart is gone", async () => {
    const draft = addOrder({ draft: true });
    const orphan = addOrder({ id: "6ad1c3e82607510012311d5c", cart_id: "6ad1c390ea3885001207ce95" }, null);

    await trackOrder(orderEvent(draft));
    await trackOrder(orderEvent(orphan));

    expect(tiktok.requests).toHaveLength(0);
  });

  it("sends nothing once switched off, or without a Pixel code or token", async () => {
    const order = addOrder();
    store.settings = { tiktok: { ...SETTINGS.tiktok, enabled: false } };
    expect(await trackOrder(orderEvent(order))).toEqual({ skipped: expect.stringContaining("switched off") });

    store.settings = { tiktok: { ...SETTINGS.tiktok, access_token: " " } };
    expect(await trackOrder(orderEvent(order))).toEqual({ skipped: expect.stringContaining("switched off") });

    expect(tiktok.requests).toHaveLength(0);
  });

  it("sends nothing for an order that no longer exists", async () => {
    expect(await trackOrder(createRequest(store, { data: { id: "6ad1c3e82607510012311d00", $event: {} } }))).toEqual({ skipped: "The order no longer exists" });
  });

  it("sends without the test event code once it is cleared", async () => {
    const order = addOrder();
    store.settings = { tiktok: { ...SETTINGS.tiktok, test_event_code: "" } };

    const result = (await trackOrder(orderEvent(order))) as Row;

    expect(tiktok.requests[0].body).not.toHaveProperty("test_event_code");
    expect(result).not.toHaveProperty("test_event_code");
  });

  describe("when TikTok refuses", () => {
    it("retries a refused token and emails the admins once per incident", async () => {
      const order = addOrder();
      tiktok.answer(40105, "Access token is incorrect or has been revoked.");
      tiktok.answer(40105, "Access token is incorrect or has been revoked.");

      const first = await failure(trackOrder(orderEvent(order)));
      const second = await failure(trackOrder(orderEvent(order, { attempts: 1, date_first_failed: new Date().toISOString() })));

      expect(first.status).toBe(401);
      expect(first.retry).not.toBe(false);
      expect(second.status).toBe(401);
      expect(store.issues).toEqual([
        expect.objectContaining({ key: "credentials", count: 2, source: "order.submitted", app_id: "app-record", message: expect.stringContaining("40105") }),
      ]);
    });

    it("sends the queued purchase once the token is fixed", async () => {
      const order = addOrder();
      tiktok.answer(40001, "No permission to operate event source id");
      await failure(trackOrder(orderEvent(order)));

      await trackOrder(orderEvent(order, { attempts: 1, date_first_failed: new Date(Date.now() - 3600_000).toISOString() }));

      expect(tiktok.events.map((event) => event.event_id)).toEqual([order.id, order.id]);
      // The purchase keeps the moment it was placed
      expect(tiktok.events[1].event_time).toBe(Math.floor(Date.parse(order.date_created) / 1000));
    });

    it("opens a new incident after a quiet day", async () => {
      const order = addOrder();
      tiktok.answer(40105);
      await failure(trackOrder(orderEvent(order)));
      const firstIssue = store.issues[0].id;
      store.issues[0].date_last_seen = new Date(Date.now() - 25 * 3600_000).toISOString();

      tiktok.answer(40105);
      await failure(trackOrder(orderEvent(order)));

      expect(store.issues).toHaveLength(1);
      expect(store.issues[0].id).not.toBe(firstIssue);
      expect(store.issues[0].count).toBe(1);
    });

    it("retries a throttled Pixel and alerts", async () => {
      const order = addOrder();
      tiktok.answer(40132, "Too many requests for this pixel");

      const err = await failure(trackOrder(orderEvent(order)));

      expect(err.status).toBe(429);
      expect(err.retry).not.toBe(false);
      expect(store.issues).toEqual([expect.objectContaining({ key: "throttled" })]);
    });

    it("ends the delivery at once when TikTok calls the payload invalid, and alerts", async () => {
      const order = addOrder({ number: "100412" });
      tiktok.answer(40002, "Invalid value for data.0.properties.currency");

      const err = await failure(trackOrder(orderEvent(order)));

      expect(err).toMatchObject({ status: 422, retry: false });
      expect(err.message).toContain("data.0.properties.currency");
      expect(tiktok.requests).toHaveLength(1);
      expect(store.issues).toEqual([
        expect.objectContaining({ key: "invalid", message: expect.stringMatching(/^Order 100412: .*currency/) }),
      ]);
    });

    it("sends the purchase without the browser's keys when TikTok refuses it with them", async () => {
      const order = addOrder({}, { order_id: null });
      await captureCall({ checkout_id: CHECKOUT_ID, ttclid: "E.C.P.test123", ttp: "not-what-tiktok-expects" });
      store.carts[0].order_id = order.id;
      tiktok.answer(40002, "Invalid value for data.0.user.ttp");

      await trackOrder(orderEvent(order));

      expect(tiktok.events).toHaveLength(2);
      expect(tiktok.events[1].event_id).toBe(order.id);
      expect(tiktok.events[1].user).not.toHaveProperty("ttclid");
      expect(tiktok.events[1].user).not.toHaveProperty("ttp");
      expect(tiktok.events[1].user).not.toHaveProperty("ip");
      expect(tiktok.events[1].user.email).toBe(tiktok.events[0].user.email);
      expect(tiktok.events[1].page.url).toBe("https://shop.example.com/checkout");
      expect(store.issues).toHaveLength(0);
      expect(store.checkouts).toHaveLength(0);
    });

    it("alerts and ends the delivery when TikTok refuses the purchase without the browser's keys too", async () => {
      const order = addOrder({}, { order_id: null });
      await captureCall({ checkout_id: CHECKOUT_ID, ttclid: "E.C.P.test123" });
      store.carts[0].order_id = order.id;
      tiktok.answer(40002, "Invalid value for data.0.user.ttclid");
      tiktok.answer(40002, "Invalid value for data.0.properties.currency");

      const err = await failure(trackOrder(orderEvent(order)));

      expect(err).toMatchObject({ status: 422, retry: false });
      expect(tiktok.events).toHaveLength(2);
      expect(store.issues).toEqual([expect.objectContaining({ key: "invalid" })]);
    });

    it("retries outages and rate limits without alerting", async () => {
      const order = addOrder();
      tiktok.answer(40100, "Too many requests");
      tiktok.answer(new TypeError("fetch failed"));

      expect((await failure(trackOrder(orderEvent(order)))).status).toBe(503);
      expect((await failure(trackOrder(orderEvent(order)))).status).toBe(503);
      expect(store.issues).toHaveLength(0);
    });

    it("gives up 47 hours after the first failure, before TikTok would count a copy twice", async () => {
      const order = addOrder();
      const late = new Date(Date.now() - RETRY_WINDOW_MS - 60_000).toISOString();

      const err = await failure(trackOrder(orderEvent(order, { attempts: 30, date_first_failed: late })));

      expect(err).toMatchObject({ status: 410, retry: false });
      expect(tiktok.requests).toHaveLength(0);
    });

    it("still tries 46 hours after the first failure", async () => {
      const order = addOrder();
      const recent = new Date(Date.now() - 46 * 3600_000).toISOString();

      await trackOrder(orderEvent(order, { attempts: 30, date_first_failed: recent }));

      expect(tiktok.events).toHaveLength(1);
    });
  });
});

describe("capture", () => {
  beforeEach(() => {
    store.carts.push({ id: CART_ID, checkout_id: CHECKOUT_ID });
  });

  it("keeps the browser's keys for the cart named by its checkout id, and answers with their names only", async () => {
    const answer = await captureCall({ checkout_id: CHECKOUT_ID, ttclid: "E.C.P.test123", ttp: "UqBuLHl7TuWsDXUu-ViOGOLA5YP" });

    expect(answer).toEqual({ keys: ["ttclid", "ttp", "ip", "user_agent"] });
    expect(store.checkouts).toEqual([
      expect.objectContaining({
        cart_id: CART_ID,
        ttclid: "E.C.P.test123",
        ttp: "UqBuLHl7TuWsDXUu-ViOGOLA5YP",
        ip: "81.2.69.160",
        user_agent: "Mozilla/5.0 (iPhone)",
        origin: "https://shop.example.com",
      }),
    ]);
  });

  it("gives IP address and user agent for the checkout snippet on another host", async () => {
    expect(await captureCall()).toEqual({ keys: ["ip", "user_agent"] });
    expect(store.checkouts[0].cart_id).toBe(CART_ID);
  });

  it("never trusts the storefront session to name a cart, as its content is not signed", async () => {
    const err = await failure(captureCall({ ttclid: "E.C.P.test123" }, { session: { cart_id: CART_ID } }));

    expect(err.status).toBe(400);
    expect(store.checkouts).toHaveLength(0);
  });

  it("keeps the first value of each key and fills only the gaps", async () => {
    await captureCall(undefined, { headers: { ...BROWSER, "user-agent": "First" } });
    const answer = await captureCall(
      { checkout_id: CHECKOUT_ID, ttclid: "E.C.P.later" },
      { headers: { "x-forwarded-for": "8.8.8.8, 162.158.1.1", "user-agent": "Second" } },
    );

    expect(answer).toEqual({ keys: ["ttclid", "ip", "user_agent"] });
    expect(store.checkouts).toHaveLength(1);
    expect(store.checkouts[0]).toMatchObject({ ttclid: "E.C.P.later", ip: "81.2.69.160", user_agent: "First" });
  });

  it("joins the record another call created at the same moment", async () => {
    store.failures.push({
      when: (method, path) => method === "post" && path === "/checkouts",
      error: Object.assign(new Error("Validation failed"), { status: 400 }),
    });
    store.checkouts.push({ id: "c1", cart_id: CART_ID, ip: "8.8.8.8" });

    // The record appears between the lookup and the write
    const lookups = store.swell.get.getMockImplementation()!;
    store.swell.get.mockImplementation(async (path: string, query?: Row) => {
      if (path === "/checkouts" && store.swell.post.mock.calls.length === 0) {
        return { count: 0, results: [] };
      }
      return lookups(path, query);
    });

    const answer = await captureCall({ checkout_id: CHECKOUT_ID, ttclid: "E.C.P.test123" });

    expect(answer).toEqual({ keys: ["ttclid", "ip", "user_agent"] });
    expect(store.checkouts).toEqual([expect.objectContaining({ id: "c1", ip: "8.8.8.8", ttclid: "E.C.P.test123" })]);
  });

  it("ignores values that cannot be a click id or a cookie", async () => {
    const answer = await captureCall({ checkout_id: CHECKOUT_ID, ttclid: "has space", ttp: "x".repeat(201) }, { headers: {} });

    expect(answer).toEqual({ keys: [] });
    expect(store.checkouts[0]).not.toHaveProperty("ttclid", expect.anything());
  });

  it("keeps a click id up to TikTok's 1,000 characters without cutting it", async () => {
    await captureCall({ checkout_id: CHECKOUT_ID, ttclid: "E".repeat(1000) });
    expect(store.checkouts[0].ttclid).toHaveLength(1000);
  });

  it("refuses a call without a known checkout id, naming what is missing", async () => {
    for (const body of [{}, { checkout_id: "../carts" }, { checkout_id: { $ne: "" } }, { checkout_id: "0".repeat(32) }]) {
      const err = await failure(captureCall(body));
      expect(err.status).toBe(400);
      expect(err.message).toContain("No cart found");
    }
    expect(store.checkouts).toHaveLength(0);
  });

  it("keeps nothing for a cart that is already an order", async () => {
    store.carts[0].order_id = "6ad1c3e82607510012311d5b";

    expect(await captureCall({ checkout_id: CHECKOUT_ID, ttclid: "E.C.P.test123" })).toEqual({ keys: [] });
    expect(store.checkouts).toHaveLength(0);
  });

  it("keeps nothing while the app is switched off", async () => {
    store.settings = { tiktok: { ...SETTINGS.tiktok, enabled: false } };

    expect(await captureCall({ checkout_id: CHECKOUT_ID, ttclid: "E.C.P.test123" })).toEqual({ keys: [], enabled: false });
    expect(store.checkouts).toHaveLength(0);
  });

  it("lets only the headers it reads reach the app", async () => {
    const { config } = await import("../../functions/capture");
    expect(config.route).toMatchObject({ public: true, methods: ["post"], headers: ["user-agent", "x-forwarded-for", "origin"] });
  });
});

describe("cleanup", () => {
  it("deletes records older than 7 days and keeps the rest", async () => {
    const old = new Date(Date.now() - KEEP_MS - 60_000).toISOString();
    const recent = new Date(Date.now() - KEEP_MS + 60_000).toISOString();
    for (let index = 0; index < 220; index++) {
      store.checkouts.push({ id: `old-${index}`, cart_id: `cart-${index}`, date_created: old });
    }
    store.checkouts.push({ id: "recent", cart_id: "cart-recent", date_created: recent });

    expect(await cleanup(createRequest(store))).toEqual({ deleted: 220 });
    expect(store.checkouts.map((record) => record.id)).toEqual(["recent"]);
  });

  it("stops before the function's time is up and leaves the rest for the next run", async () => {
    const old = new Date(Date.now() - KEEP_MS - 60_000).toISOString();
    for (let index = 0; index < 160; index++) {
      store.checkouts.push({ id: `old-${index}`, cart_id: `cart-${index}`, date_created: old });
    }
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => (now += 1500));

    const result = (await cleanup(createRequest(store))) as Row;

    expect(result.deleted).toBeLessThan(160);
    expect(store.checkouts.length).toBe(160 - result.deleted);
    vi.restoreAllMocks();
  });

  it("stops when records cannot be deleted, instead of reading the same page again", async () => {
    const old = new Date(Date.now() - KEEP_MS - 60_000).toISOString();
    for (let index = 0; index < 150; index++) {
      store.checkouts.push({ id: `old-${index}`, cart_id: `cart-${index}`, date_created: old });
    }
    vi.spyOn(console, "error").mockImplementation(() => {});
    const req = createRequest(store);
    req.swell.delete = vi.fn(async () => {
      throw new Error("Service unavailable");
    });

    expect(await cleanup(req)).toEqual({ deleted: 0 });
    expect(req.swell.get).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});

describe("test-connection", () => {
  const action = () => testConnection(createRequest(store, { data: { $action: { id: "test-connection", source: "field" } } }));

  it("checks the credentials without sending an event, and clears open issues", async () => {
    store.issues.push({ id: "i1", key: "credentials", message: "refused" }, { id: "i2", key: "throttled", message: "throttled" });

    const result = (await action()) as Row;

    expect(tiktok.requests[0].body).toEqual({ event_source: "web", event_source_id: "DB8S3TBC77U3SVPIKJMG", data: [] });
    expect(result.message).toBe(
      "Connected to TikTok Pixel DB8S3TBC77U3SVPIKJMG. Test event code TEST48123 is set: purchases appear only in the Pixel's Test Events tab.",
    );
    expect(store.issues).toHaveLength(0);
  });

  it("reminds the merchant to switch the app on", async () => {
    store.settings = { tiktok: { ...SETTINGS.tiktok, enabled: false, test_event_code: "" } };
    expect(((await action()) as Row).message).toBe('Connected to TikTok Pixel DB8S3TBC77U3SVPIKJMG. Turn on "Send purchases to TikTok" to start.');
  });

  it("says in the merchant's words which value TikTok refused", async () => {
    store.issues.push({ id: "i1", key: "credentials", message: "refused" });
    tiktok.answer(40105, "Access token is incorrect or has been revoked.");
    const token = await failure(action());
    expect(token.status).toBe(400);
    expect(token.message).toContain("did not accept the access token");

    tiktok.answer(40001, "No permission to operate event source id");
    expect((await failure(action())).message).toContain("did not accept the Pixel code");

    tiktok.answer(40132, "Too many requests");
    expect((await failure(action())).message).toContain("limiting the events of this Pixel");

    // A failed test leaves the issue open
    expect(store.issues).toHaveLength(1);
  });

  it("asks for both values before calling TikTok", async () => {
    store.settings = { tiktok: { pixel_code: "DB8S3TBC77U3SVPIKJMG" } };

    const err = await failure(action());

    expect(err.message).toBe("Enter the Pixel code and access token, save the settings, then test again.");
    expect(tiktok.requests).toHaveLength(0);
  });

  it("reports an outage as something to retry", async () => {
    tiktok.answer(new TypeError("fetch failed"));
    const outage = await failure(action());
    expect(outage.status).toBe(502);
    expect(outage.message).toContain("Try again in a minute");

    tiktok.answer(50000, "System error");
    expect((await failure(action())).status).toBe(502);
  });
});

describe("hashing", () => {
  it("never sends the shopper's email or phone in clear", async () => {
    const order = addOrder();
    await trackOrder(orderEvent(order));

    const sent = JSON.stringify(tiktok.requests[0].body);
    expect(sent).not.toContain("example.com");
    expect(sent).not.toContain("373");
    expect(tiktok.events[0].user.email).toBe(await sha256("tiktok-spike+1@example.com"));
  });
});
