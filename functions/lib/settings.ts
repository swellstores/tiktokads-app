/** The merchant's settings, from settings/tiktok.json */

import { hasCredentials } from "./tiktok";
import type { Credentials } from "./tiktok";

export interface TikTokSettings {
  pixel_code?: string;
  access_token?: string;
  test_event_code?: string;
  enabled?: boolean;
}

export interface Settings {
  /** The app's record id in this store, which the dashboard address of the app's page is built from */
  id?: string;
  tiktok?: TikTokSettings;
}

export async function readSettings(swell: { settings(): Promise<unknown> }): Promise<Settings> {
  return ((await swell.settings()) as Settings | null) || {};
}

/**
 * The Pixel and token to send with, when the app is switched on and both are set.
 * Off means silent: nothing is sent or kept until then.
 */
export function activeCredentials(settings: Settings): Credentials | undefined {
  const tiktok = settings.tiktok;
  return tiktok?.enabled === true && hasCredentials(tiktok) ? tiktok : undefined;
}

export function testEventCode(settings: Settings): string | undefined {
  return settings.tiktok?.test_event_code?.trim() || undefined;
}
