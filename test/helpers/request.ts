import type { TestStore } from "./store";

type Row = Record<string, any>;

/** A function's request, as far as the app's functions read it */
export function createRequest(
  store: TestStore,
  options: { data?: Row; body?: Row; headers?: Record<string, string>; session?: Row | null } = {},
): SwellRequest {
  const body = options.body || {};
  return {
    appId: "tiktokads",
    storeId: "alder",
    store: { id: "alder", url: "https://alder.swell.store", admin_url: "https://alder.swell.store/admin" },
    swell: store.swell,
    session: options.session ?? null,
    data: options.data || body,
    body,
    headers: new Headers(options.headers || {}),
  } as unknown as SwellRequest;
}
