import { describe, expect, it } from "vitest";
import { normalizeEmail, sha256 } from "../../functions/lib/match-keys";
import { contentId, purchaseEvent } from "../../functions/lib/purchase";
import { storefrontOrder } from "../fixtures/orders";

const STORE_URL = "https://alder.swell.store";

describe("Purchase event", () => {
  it("carries the order's value, items and id", async () => {
    const event = await purchaseEvent(storefrontOrder(), undefined, STORE_URL);

    expect(event).toMatchObject({
      event: "Purchase",
      event_id: "6ad1c3e82607510012311d5b",
      event_time: Math.floor(Date.parse("2026-10-16T06:27:52.856Z") / 1000),
      page: { url: "https://alder.swell.store/checkout" },
      properties: {
        currency: "USD",
        value: 157.3,
        order_id: "100362",
        content_type: "product",
        contents: [{ content_id: "PACK-01", content_name: "Agency Reporting Pack", price: 149, quantity: 1 }],
        content_ids: ["PACK-01"],
        num_items: 1,
      },
    });
  });

  it("hashes what identifies the shopper and keeps the place raw", async () => {
    const { user } = await purchaseEvent(storefrontOrder(), undefined, STORE_URL);

    expect(user).toEqual({
      email: await sha256("tiktok-spike+1@example.com"),
      phone: await sha256("+12133734253"),
      external_id: await sha256("6ad1c391cbd53b001211018f"),
      first_name: await sha256("tik"),
      last_name: await sha256("spike"),
      zip_code: await sha256("95110"),
      city: "sanjose",
      state: "ca",
      country: "us",
    });
    for (const key of ["email", "phone", "external_id", "first_name", "last_name", "zip_code"]) {
      expect(user[key]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("adds the keys the browser handed over, and names the checkout of the page they came from", async () => {
    const event = await purchaseEvent(
      storefrontOrder(),
      { ttclid: "E.C.P.abc", ttp: "UqBuLHl7TuWsDXUu-ViOGOLA5YP", ip: "81.2.69.160", user_agent: "Mozilla/5.0", origin: "https://shop.example.com" },
      STORE_URL,
    );

    expect(event.user).toMatchObject({ ttclid: "E.C.P.abc", ttp: "UqBuLHl7TuWsDXUu-ViOGOLA5YP", ip: "81.2.69.160", user_agent: "Mozilla/5.0" });
    expect(event.page.url).toBe("https://shop.example.com/checkout");
  });

  it("uses the shipping address when billing has no location, and leaves out what is missing", async () => {
    const order = storefrontOrder({
      account: { id: "a1", email: "x@example.com" },
      billing: { first_name: "Ann" },
      shipping: { first_name: "Ben", last_name: "Lee", city: "Berlin", zip: "10115", country: "DE", phone: "030 1234567" },
    });
    const { user } = await purchaseEvent(order, undefined, STORE_URL);

    expect(user.first_name).toBe(await sha256("ben"));
    expect(user.phone).toBe(await sha256("+49301234567"));
    expect(user.country).toBe("de");
    expect(user).not.toHaveProperty("state");
    expect(user.email).toBe(await sha256(normalizeEmail("x@example.com")));
  });

  it("sends the locale as a language tag, and none it cannot read", async () => {
    expect((await purchaseEvent(storefrontOrder({ display_locale: "zh_Hant_TW" }), undefined, STORE_URL)).user.locale).toBe("zh-Hant-TW");
    expect((await purchaseEvent(storefrontOrder({ display_locale: "English" }), undefined, STORE_URL)).user).not.toHaveProperty("locale");
  });

  it("matches products by variant SKU, then product SKU, then product id", () => {
    expect(contentId({ product_id: "p1", product: { sku: "P-SKU" }, variant: { sku: "V-SKU" } })).toBe("V-SKU");
    expect(contentId({ product_id: "p1", product: { sku: "P-SKU" }, variant: { sku: "" } })).toBe("P-SKU");
    expect(contentId({ product_id: "p1", product: { sku: null }, variant: null })).toBe("p1");
  });

  it("lists each line, and the same product once among the ids", async () => {
    const order = storefrontOrder({
      items: [
        { product_id: "p1", quantity: 2, price: 10, product: { name: "Tee", sku: "TEE" }, variant: { sku: "TEE-S" } },
        { product_id: "p1", quantity: 1, price: 10, product: { name: "Tee", sku: "TEE" }, variant: { sku: "TEE-S" } },
        { product_id: "p2", quantity: 3, price: 4.5, product: null, product_name: "Sticker", variant: null },
      ],
    });
    const { properties } = await purchaseEvent(order, undefined, STORE_URL);

    expect(properties.contents.map((content) => [content.content_id, content.quantity])).toEqual([
      ["TEE-S", 2],
      ["TEE-S", 1],
      ["p2", 3],
    ]);
    expect(properties.contents[2].content_name).toBe("Sticker");
    expect(properties.content_ids).toEqual(["TEE-S", "p2"]);
    expect(properties.num_items).toBe(6);
  });

  it("never names the real checkout address, and ignores an origin that is not a web address", async () => {
    const event = await purchaseEvent(storefrontOrder(), { origin: "javascript:alert(1)" }, STORE_URL);
    expect(event.page.url).toBe("https://alder.swell.store/checkout");
  });
});
