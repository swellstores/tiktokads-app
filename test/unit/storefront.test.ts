import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import snippet from "../../storefront/checkout-snippet.html?raw";
import { handOverTikTokKeys, keepTikTokClickId } from "../../storefront/tiktok-ads.js";

type Row = Record<string, any>;

let cookies: string[];
let storage: Map<string, string>;

/** A browser page at `href`, as far as the storefront code reads it */
function openPage(href: string) {
  const url = new URL(href);
  vi.stubGlobal("window", { location: url });
  vi.stubGlobal("document", {
    get cookie() {
      return cookies.join("; ");
    },
    set cookie(value: string) {
      const pair = value.split(";")[0];
      const name = pair.split("=")[0];
      cookies = [...cookies.filter((cookie) => !cookie.startsWith(`${name}=`)), pair];
      setCookies.push(value);
    },
  });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
  });
}

let setCookies: string[];

const CHECKOUT_ID = "8ca186f7ed6f99640a00de24d3898c46";

function swellClient(answer: (body: Row) => Promise<unknown> = async (body) => ({ keys: [...Object.keys(body).filter((key) => key !== "checkout_id" && body[key]), "ip", "user_agent"] })) {
  const post = vi.fn((_app: string, _name: string, body: Row) => answer(body));
  const get = vi.fn(async () => ({ id: "cart-1", checkout_id: CHECKOUT_ID }));
  return { client: { functions: { post }, cart: { get } }, post, get };
}

beforeEach(() => {
  cookies = [];
  setCookies = [];
  storage = new Map();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("storefront touch point 1: keep the click id", () => {
  it("keeps ?ttclid in a first-party cookie for 30 days", () => {
    openPage("https://shop.example.com/products/tee?ttclid=E.C.P.abc%2B1&utm_source=tiktok");

    keepTikTokClickId();

    expect(cookies).toEqual(["ttclid=E.C.P.abc%2B1"]);
    expect(setCookies[0]).toBe("ttclid=E.C.P.abc%2B1; Max-Age=2592000; Path=/; SameSite=Lax; Secure");
  });

  it("leaves the cookie alone on pages without a click id", () => {
    cookies = ["ttclid=E.C.P.first"];
    openPage("https://shop.example.com/cart");

    keepTikTokClickId();

    expect(cookies).toEqual(["ttclid=E.C.P.first"]);
  });
});

describe("storefront touch point 2: hand over the keys", () => {
  it("posts the cart's checkout id, the click id and the _ttp cookie to the app's capture route", async () => {
    cookies = ["_ttp=UqBuLHl7TuWsDXUu-ViOGOLA5YP", "ttclid=E.C.P.abc%2B1", "other=1"];
    openPage("https://shop.example.com/cart");
    const { client, post, get } = swellClient();

    const answer = await handOverTikTokKeys(client, { checkout_id: CHECKOUT_ID });

    expect(post).toHaveBeenCalledWith("tiktokads", "capture", { checkout_id: CHECKOUT_ID, ttclid: "E.C.P.abc+1", ttp: "UqBuLHl7TuWsDXUu-ViOGOLA5YP" });
    expect(get).not.toHaveBeenCalled();
    expect(answer).toEqual({ keys: ["ttclid", "ttp", "ip", "user_agent"] });
  });

  it("reads the cart when the storefront has none at hand", async () => {
    openPage("https://shop.example.com/");
    const { client, post, get } = swellClient();

    await handOverTikTokKeys(client);

    expect(get).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][2]).toMatchObject({ checkout_id: CHECKOUT_ID });
  });

  it("calls nothing when there is no cart yet", async () => {
    openPage("https://shop.example.com/");
    const { client, post, get } = swellClient();
    get.mockResolvedValueOnce(null as never);

    await expect(handOverTikTokKeys(client)).resolves.toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });

  it("calls once per cart once the app kept what the browser holds, and again for a new cart", async () => {
    cookies = ["ttclid=E.C.P.abc"];
    openPage("https://shop.example.com/");
    const { client, post } = swellClient();

    await handOverTikTokKeys(client, { checkout_id: CHECKOUT_ID });
    await handOverTikTokKeys(client, { checkout_id: CHECKOUT_ID });
    await handOverTikTokKeys(client, { checkout_id: "1".repeat(32) });

    expect(post).toHaveBeenCalledTimes(2);
  });

  it("tries again while the app is switched off or did not keep a key", async () => {
    cookies = ["ttclid=E.C.P.abc"];
    openPage("https://shop.example.com/");
    const answers = [{ keys: [], enabled: false }, { keys: ["ip", "user_agent"] }, { keys: ["ttclid", "ip", "user_agent"] }];
    const { client, post } = swellClient(async () => answers.shift());

    for (let index = 0; index < 4; index++) {
      await handOverTikTokKeys(client, { checkout_id: CHECKOUT_ID });
    }

    expect(post).toHaveBeenCalledTimes(3);
  });

  it("tries again while the app is switched off, also when the browser holds no cookie", async () => {
    openPage("https://shop.example.com/");
    const answers = [{ keys: [], enabled: false }, { keys: ["ip", "user_agent"] }];
    const { client, post } = swellClient(async () => answers.shift());

    for (let index = 0; index < 3; index++) {
      await handOverTikTokKeys(client, { checkout_id: CHECKOUT_ID });
    }

    expect(post).toHaveBeenCalledTimes(2);
  });

  it("hands over a click id or _ttp cookie that appears after the cart was handed over", async () => {
    openPage("https://shop.example.com/");
    const { client, post } = swellClient();

    await handOverTikTokKeys(client, { checkout_id: CHECKOUT_ID });
    cookies = ["_ttp=UqBu"];
    await handOverTikTokKeys(client, { checkout_id: CHECKOUT_ID });
    await handOverTikTokKeys(client, { checkout_id: CHECKOUT_ID });

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][2]).toMatchObject({ ttp: "UqBu" });
  });

  it("tries once more when the first call fails, as a cart created a moment ago may not be found yet", async () => {
    openPage("https://shop.example.com/");
    const answers: (() => Promise<unknown>)[] = [async () => Promise.reject(new Error("No cart found")), async () => ({ keys: ["ip", "user_agent"] })];
    const { client, post } = swellClient(() => answers.shift()!());

    await expect(handOverTikTokKeys(client, { checkout_id: CHECKOUT_ID })).resolves.toEqual({ keys: ["ip", "user_agent"] });
    expect(post).toHaveBeenCalledTimes(2);
    expect(storage.get("tiktokads:cart")).toBe(`${CHECKOUT_ID}:`);
  });

  it("never throws, so a missing app cannot break the storefront", async () => {
    openPage("https://shop.example.com/");
    const { client } = swellClient(async () => {
      throw new Error("Function app.tiktokads.capture not found");
    });

    await expect(handOverTikTokKeys(client, { checkout_id: CHECKOUT_ID })).resolves.toBeUndefined();
    await expect(handOverTikTokKeys({}, undefined)).resolves.toBeUndefined();
    // A failed call is tried again next time
    expect(storage.size).toBe(0);
  });

  it("gives up after the timeout, so the checkout is never held up", async () => {
    vi.useFakeTimers();
    openPage("https://shop.example.com/");
    const { client } = swellClient(() => new Promise(() => {}));

    const pending = handOverTikTokKeys(client, { checkout_id: CHECKOUT_ID }, 2000);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(pending).resolves.toBeUndefined();
  });
});

describe("checkout snippet", () => {
  /** The snippet's script as hosted checkout renders it, run in a page that may run it again */
  function render(values: { checkout_id: string; public_key: string }) {
    const script = /<script>([\s\S]*)<\/script>/.exec(snippet)![1]
      .replace("{{ cart.checkout_id }}", values.checkout_id)
      .replace("{{ cart.settings.public_key }}", values.public_key);
    return new Function("window", "document", "fetch", script) as (window: Row, document: Row, fetch: unknown) => void;
  }

  it("hands the cart's checkout id and the cookies to the app once, however often checkout runs it", () => {
    const page: Row = {};
    const fetch = vi.fn(async () => new Response("{}"));
    const run = render({ checkout_id: "8ca186f7ed6f99640a00de24d3898c46", public_key: "pk_test_abc" });

    for (let index = 0; index < 8; index++) {
      run(page, { cookie: "ttclid=E.C.P.abc; _ttp=UqBu" }, fetch);
    }

    expect(fetch).toHaveBeenCalledTimes(1);
    const [address, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(address).toBe("/functions/tiktokads/capture");
    expect(init).toMatchObject({ method: "POST", keepalive: true, headers: { Authorization: "pk_test_abc" } });
    expect(JSON.parse(String(init.body))).toEqual({ checkout_id: "8ca186f7ed6f99640a00de24d3898c46", ttclid: "E.C.P.abc", ttp: "UqBu" });
  });

  it("does nothing where the template has no cart", () => {
    const fetch = vi.fn();
    render({ checkout_id: "", public_key: "" })({}, { cookie: "" }, fetch);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still hands the keys over when the first runs come before the cart", () => {
    const page: Row = {};
    const fetch = vi.fn(async () => new Response("{}"));
    render({ checkout_id: "", public_key: "" })(page, { cookie: "" }, fetch);
    render({ checkout_id: "8ca186f7ed6f99640a00de24d3898c46", public_key: "pk_test_abc" })(page, { cookie: "" }, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
