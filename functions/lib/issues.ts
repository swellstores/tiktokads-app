/**
 * Issues: records in the app's own collection that exist while TikTok refuses the app's events.
 * Creating one sends the store's administrators an email (see notifications/), which is the
 * reason it is a record and not a log line.
 */

/**
 * credentials: the token or Pixel code is refused. throttled: TikTok limits the Pixel's events.
 * invalid: TikTok refused the details of a purchase, which the merchant's settings cannot fix
 */
export type IssueKey = "credentials" | "throttled" | "invalid";

// The same problem seen again after a quiet day is a new incident: it gets a new record,
// which sends a new email
const SAME_INCIDENT_MS = 24 * 60 * 60 * 1000;

/** The part of the store client the app uses */
export interface StoreClient {
  settings(): Promise<unknown>;
  get(path: string, data?: any): Promise<unknown>;
  post(path: string, data?: any): Promise<unknown>;
  put(path: string, data?: any): Promise<unknown>;
  delete(path: string, data?: any): Promise<unknown>;
}

async function findIssue(swell: StoreClient, key: IssueKey): Promise<Record<string, any> | undefined> {
  const found = (await swell.get("/issues", { where: { key }, limit: 1 })) as { results?: Record<string, any>[] };
  return found?.results?.[0];
}

/**
 * Called when TikTok refuses events. `source` is the store event or app action that met the
 * problem. Never throws: failing to record a problem must not hide the problem itself.
 */
export async function recordIssue(swell: StoreClient, key: IssueKey, message: string, source: string): Promise<void> {
  try {
    const now = new Date();
    const existing = await findIssue(swell, key);

    if (existing) {
      const lastSeen = new Date(existing.date_last_seen || existing.date_created).getTime();
      if (now.getTime() - lastSeen < SAME_INCIDENT_MS) {
        await swell.put(`/issues/${existing.id}`, {
          message,
          source,
          count: (existing.count || 1) + 1,
          date_last_seen: now.toISOString(),
        });
        return;
      }
      await swell.delete(`/issues/${existing.id}`);
    }

    // The id of the settings record is the app's record id: the email links to the app's page with it
    const settings = (await swell.settings()) as { id?: string } | null;
    await swell.post("/issues", {
      key,
      message,
      source,
      count: 1,
      date_last_seen: now.toISOString(),
      app_id: settings?.id,
    });
  } catch (err) {
    console.error(`Unable to record the ${key} issue`, (err as Error).message);
  }
}

/** Called when TikTok accepts the credentials again */
export async function resolveIssue(swell: StoreClient, key: IssueKey): Promise<void> {
  try {
    const existing = await findIssue(swell, key);
    if (existing) {
      await swell.delete(`/issues/${existing.id}`);
    }
  } catch (err) {
    console.error(`Unable to resolve the ${key} issue`, (err as Error).message);
  }
}
