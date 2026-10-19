import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS_URL, TikTokError, classify, sendEvent } from "../../functions/lib/tiktok";
import { createTikTok } from "../helpers/tiktok";
import type { TestTikTok } from "../helpers/tiktok";

const CREDENTIALS = { pixel_code: " DB8S3TBC77U3SVPIKJMG ", access_token: " token-1 " };
let tiktok: TestTikTok;

beforeEach(() => {
  tiktok = createTikTok();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TikTok client", () => {
  it("sends one web event for the Pixel with the token in its header", async () => {
    await sendEvent(CREDENTIALS, { event: "Purchase", event_id: "o1" }, "TEST123");

    expect(tiktok.requests).toHaveLength(1);
    const [request] = tiktok.requests;
    expect(request.url).toBe(EVENTS_URL);
    expect(request.headers.get("access-token")).toBe("token-1");
    expect(request.body).toEqual({
      event_source: "web",
      event_source_id: "DB8S3TBC77U3SVPIKJMG",
      test_event_code: "TEST123",
      data: [{ event: "Purchase", event_id: "o1" }],
    });
  });

  it("leaves the test event code out when there is none", async () => {
    await sendEvent(CREDENTIALS, { event: "Purchase" });
    expect(tiktok.requests[0].body).not.toHaveProperty("test_event_code");
  });

  it("decides by TikTok's code, not by the HTTP status", async () => {
    tiktok.answer(new Response(JSON.stringify({ code: 40105, message: "Access token is incorrect or has been revoked." }), { status: 200 }));
    await expect(sendEvent(CREDENTIALS, {})).rejects.toMatchObject({ kind: "credentials", code: 40105 });

    tiktok.answer(new Response(JSON.stringify({ code: 20001, message: "Partially successful" }), { status: 200 }));
    await expect(sendEvent(CREDENTIALS, {})).resolves.toMatchObject({ code: 20001 });
  });

  it("treats an answer without a code and a network error as an outage", async () => {
    tiktok.answer(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(sendEvent(CREDENTIALS, {})).rejects.toMatchObject({ kind: "unavailable", message: expect.stringContaining("HTTP 502") });

    tiktok.answer(new TypeError("fetch failed"));
    const failure = await sendEvent(CREDENTIALS, {}).catch((err) => err);
    expect(failure).toBeInstanceOf(TikTokError);
    expect(failure.kind).toBe("unavailable");
  });

  it("classifies TikTok's codes as the brief's table has them", () => {
    expect([0, 20001].map(classify)).toEqual(["ok", "ok"]);
    expect([40001, 40102, 40104, 40105].map(classify)).toEqual(["credentials", "credentials", "credentials", "credentials"]);
    expect(classify(40132)).toBe("throttled");
    expect(classify(40002)).toBe("invalid");
    expect([40100, 40133, 40700, 50000, 50002, 41999].map(classify)).toEqual(Array(6).fill("unavailable"));
  });
});
