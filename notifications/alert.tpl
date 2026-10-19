<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>TikTok is not receiving purchases</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2933;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:8px;">
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:20px;line-height:28px;font-weight:600;">TikTok is not receiving purchases from {{ store.name }}</h1>
                {% if key == "throttled" %}
                <p style="margin:0 0 16px;font-size:15px;line-height:24px;">TikTok is limiting how many events your Pixel may receive. TikTok says this can mean that the access token is being used somewhere else as well.</p>
                <p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#616e7c;">TikTok's answer: {{ message }}</p>
                <p style="margin:0 0 8px;font-size:15px;line-height:24px;font-weight:600;">To fix it</p>
                <ol style="margin:0 0 24px;padding-left:20px;font-size:15px;line-height:24px;">
                  <li>In TikTok Ads Manager, open Tools → Events → your Pixel → Settings and generate a new access token. The old one stops working.</li>
                  <li>In Swell, open Apps → TikTok Ads → Settings, paste the new token and save.</li>
                  <li>Press Test connection.</li>
                </ol>
                {% elsif key == "invalid" %}
                <p style="margin:0 0 16px;font-size:15px;line-height:24px;">TikTok refused the details of a purchase, so that purchase is not counted for your TikTok ads. Your Pixel code and access token work, and purchases with other details still go out.</p>
                <p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#616e7c;">TikTok's answer: {{ message }}</p>
                <p style="margin:0 0 8px;font-size:15px;line-height:24px;font-weight:600;">What to do</p>
                <p style="margin:0 0 24px;font-size:15px;line-height:24px;">Your settings cannot fix this. Forward this email to support@swell.is, so we can correct what TikTok refused.</p>
                {% else %}
                <p style="margin:0 0 16px;font-size:15px;line-height:24px;">TikTok refused the access token or the Pixel code saved in the TikTok Ads app, so purchases are not counted for your TikTok ads.</p>
                <p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#616e7c;">TikTok's answer: {{ message }}</p>
                <p style="margin:0 0 8px;font-size:15px;line-height:24px;font-weight:600;">To fix it</p>
                <ol style="margin:0 0 24px;padding-left:20px;font-size:15px;line-height:24px;">
                  <li>In TikTok Ads Manager, open Tools → Events and copy the Pixel code of your website's Pixel.</li>
                  <li>Open the Pixel's Settings and generate an access token.</li>
                  <li>In Swell, open Apps → TikTok Ads → Settings, paste both values and save.</li>
                  <li>Press Test connection.</li>
                </ol>
                {% endif %}
                <p style="margin:0 0 24px;">
                  <a href="{{ store.admin_url }}/admin/apps{% if app_id %}/{{ app_id }}?tab=settings{% endif %}" style="display:inline-block;padding:10px 20px;background-color:#1f2933;color:#ffffff;font-size:15px;line-height:20px;text-decoration:none;border-radius:6px;">Open the TikTok Ads app</a>
                </p>
                <p style="margin:0;font-size:13px;line-height:20px;color:#616e7c;">{% if key != "invalid" %}Purchases keep being retried for 47 hours and go out at their next retry, within hours after TikTok accepts them again. Older ones are not sent, because TikTok could count them twice. {% endif %}If the subject of this email starts with (TEST), the problem is in your store's test environment: switch the dashboard to it after opening the app.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
