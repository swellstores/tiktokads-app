import { deleteCheckout } from "./lib/checkouts";

export const config: SwellConfig = {
  description: "Delete the match keys of carts that did not become orders within 7 days",
  cron: { schedule: "*/10 * * * *" },
};

export const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const PAGE = 100;
const PARALLEL = 20;
// Leaves time to answer before the function is stopped at 10 seconds
const BUDGET_MS = 7000;

/**
 * Converted carts delete their record when the order is sent, so only abandoned carts wait for
 * this. Runs every 10 minutes in capped pages; whatever is left goes in the next run.
 */
export default async function (req: SwellRequest) {
  const started = Date.now();
  const before = new Date(started - KEEP_MS).toISOString();
  let deleted = 0;

  while (Date.now() - started < BUDGET_MS) {
    const found = (await req.swell.get("/checkouts", {
      where: { date_created: { $lt: before } },
      fields: "id",
      limit: PAGE,
    })) as { results?: { id: string }[] };
    const ids = (found?.results || []).map((record) => record.id);
    if (ids.length === 0) {
      break;
    }
    let deletedHere = 0;
    for (let index = 0; index < ids.length && Date.now() - started < BUDGET_MS; index += PARALLEL) {
      const batch = ids.slice(index, index + PARALLEL);
      const results = await Promise.all(batch.map((id) => deleteCheckout(req.swell, id)));
      deletedHere += results.filter(Boolean).length;
    }
    deleted += deletedHere;
    // A short page is the last one. A page where nothing could be deleted would come back
    // unchanged, so the rest waits for the next run
    if (ids.length < PAGE || deletedHere === 0) {
      break;
    }
  }
  return { deleted };
}
