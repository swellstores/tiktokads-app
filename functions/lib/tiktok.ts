/**
 * TikTok Events API client: the only module that talks to TikTok.
 *
 * TikTok decides success by the `code` in its answer, not by the HTTP status: an answer can be
 * HTTP 200 and still be a failure.
 */

export const EVENTS_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

export interface Credentials {
  pixel_code: string;
  access_token: string;
}

/**
 * credentials: TikTok refused the access token or the Pixel code. The merchant must act.
 * throttled: too many events for this Pixel. TikTok says this can mean the token leaked.
 * invalid: TikTok refused the payload. Sending it again cannot help.
 * unavailable: timeout, outage or rate limit. Sending it again later can help.
 */
export type FailureKind = "credentials" | "throttled" | "invalid" | "unavailable";

export class TikTokError extends Error {
  kind: FailureKind;
  /** TikTok's code, or 0 when there was no answer */
  code: number;

  constructor(kind: FailureKind, code: number, message: string) {
    super(message);
    this.name = "TikTokError";
    this.kind = kind;
    this.code = code;
  }
}

const OK = new Set([0, 20001]);
const CREDENTIALS = new Set([40001, 40102, 40104, 40105]);
const THROTTLED = new Set([40132]);
const INVALID = new Set([40002]);

// Functions are stopped after 10 seconds, so give up while there is still time to report
const REQUEST_TIMEOUT_MS = 7000;

export function hasCredentials(settings: Partial<Credentials> | undefined): settings is Credentials {
  return Boolean(settings?.pixel_code?.trim() && settings?.access_token?.trim());
}

export function classify(code: number): FailureKind | "ok" {
  if (OK.has(code)) {
    return "ok";
  }
  if (CREDENTIALS.has(code)) {
    return "credentials";
  }
  if (THROTTLED.has(code)) {
    return "throttled";
  }
  if (INVALID.has(code)) {
    return "invalid";
  }
  // 40100, 40133, 40700, 5xxxx and codes TikTok may add later: retried, as a lost purchase
  // costs more than a retry, and TikTok drops repeats of the same event id
  return "unavailable";
}

export interface Answer {
  code: number;
  message: string;
  request_id?: string;
}

/** Sends a request to the Events API and returns TikTok's answer, whatever its code */
export async function post(credentials: Credentials, body: Record<string, unknown>): Promise<Answer> {
  let response: Response;
  try {
    response = await fetch(EVENTS_URL, {
      method: "POST",
      headers: {
        "Access-Token": credentials.access_token.trim(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...body, event_source: "web", event_source_id: credentials.pixel_code.trim() }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new TikTokError("unavailable", 0, `TikTok could not be reached: ${(err as Error).message}`);
  }

  let answer: Partial<Answer> = {};
  try {
    answer = (await response.json()) as Partial<Answer>;
  } catch {
    // Not JSON: an outage page or a proxy error
  }
  if (typeof answer.code !== "number") {
    throw new TikTokError("unavailable", 0, `TikTok answered HTTP ${response.status} without a result code.`);
  }
  return { code: answer.code, message: String(answer.message || ""), request_id: answer.request_id };
}

/** Sends one event. Throws a TikTokError unless TikTok accepted it */
export async function sendEvent(
  credentials: Credentials,
  event: object,
  testEventCode?: string,
): Promise<Answer> {
  const answer = await post(credentials, {
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
    data: [event],
  });
  const kind = classify(answer.code);
  if (kind !== "ok") {
    throw new TikTokError(kind, answer.code, `TikTok answered ${answer.code}: ${answer.message || "no message"}`);
  }
  return answer;
}
