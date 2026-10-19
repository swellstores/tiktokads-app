import { resolveIssue } from "./lib/issues";
import { readSettings, testEventCode } from "./lib/settings";
import { TikTokError, hasCredentials, post } from "./lib/tiktok";

export const config: SwellConfig = {
  description: "Check the saved Pixel code and access token with TikTok",
  action: true,
};

const TOKEN_REFUSED =
  "TikTok did not accept the access token. In TikTok Ads Manager open Tools → Events → your Pixel → Settings, generate a new access token, paste it here, save and test again.";
const PIXEL_REFUSED =
  "TikTok did not accept the Pixel code with this access token. Copy the Pixel code from the top of your Pixel in TikTok Ads Manager (Tools → Events), and check that the token was generated for a Pixel of the same ad account.";
const THROTTLED =
  "TikTok is limiting the events of this Pixel, which can mean the access token is used somewhere else as well. Generate a new access token in TikTok Ads Manager (your Pixel → Settings), paste it here, save and test again.";

/**
 * Checks the credentials without creating an event: TikTok checks the token and the Pixel
 * before the payload, so an empty event list is refused as a payload error (40002) exactly when
 * both are right.
 */
export default async function (req: SwellRequest) {
  const settings = await readSettings(req.swell);
  const tiktok = settings.tiktok || {};
  const credentials = { pixel_code: tiktok.pixel_code, access_token: tiktok.access_token };

  if (!hasCredentials(credentials)) {
    throw new SwellError("Enter the Pixel code and access token, save the settings, then test again.", { status: 400 });
  }

  let code: number;
  let message: string;
  try {
    ({ code, message } = await post(credentials, { data: [] }));
  } catch (err) {
    if (err instanceof TikTokError) {
      throw new SwellError(`${err.message} Try again in a minute.`, { status: 502 });
    }
    throw err;
  }

  switch (code) {
    case 40002:
      break;
    case 40102:
    case 40104:
    case 40105:
      throw new SwellError(TOKEN_REFUSED, { status: 400 });
    case 40001:
      throw new SwellError(PIXEL_REFUSED, { status: 400 });
    case 40132:
      throw new SwellError(THROTTLED, { status: 400 });
    default:
      throw new SwellError(`TikTok answered ${code}: ${message || "no message"}. Try again in a minute.`, { status: 502 });
  }

  await resolveIssue(req.swell, "credentials");
  await resolveIssue(req.swell, "throttled");

  const parts = [`Connected to TikTok Pixel ${credentials.pixel_code.trim()}.`];
  const testCode = testEventCode(settings);
  if (testCode) {
    parts.push(`Test event code ${testCode} is set: purchases appear only in the Pixel's Test Events tab.`);
  }
  if (tiktok.enabled !== true) {
    parts.push('Turn on "Send purchases to TikTok" to start.');
  }
  return { message: parts.join(" ") };
}
