import { vi } from "vitest";

type Row = Record<string, any>;

/**
 * Stands in for the TikTok Events API. Answers with the queued codes in turn, then with
 * code 0 (an empty event list gets 40002, as TikTok answers it). Keeps every request.
 */
export function createTikTok() {
  const requests: { url: string; headers: Headers; body: Row }[] = [];
  const answers: (Row | Error | Response)[] = [];

  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push({ url, headers: new Headers(init.headers), body });
    const next = answers.shift();
    if (next instanceof Error) {
      throw next;
    }
    if (next instanceof Response) {
      return next;
    }
    const answer = next || (body.data?.length ? { code: 0, message: "OK" } : { code: 40002, message: "Number of events must be between 1 and 1000." });
    return new Response(JSON.stringify({ request_id: `req_${requests.length}`, ...answer }), {
      status: answer.code === 0 ? 200 : 400,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  return {
    requests,
    /** Queues TikTok's answer to the next request: a code, a network error or a raw response */
    answer(next: number | Error | Response, message = "Refused") {
      answers.push(typeof next === "number" ? { code: next, message } : next);
    },
    /** The events TikTok received */
    get events(): Row[] {
      return requests.flatMap((request) => request.body.data || []);
    },
  };
}

export type TestTikTok = ReturnType<typeof createTikTok>;
