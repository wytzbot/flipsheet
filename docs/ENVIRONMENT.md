# FlipSheet production configuration

## 1. Vercel environment variables

Required:

- `APP_URL` — production HTTPS origin, no trailing slash.
- `FLW_ENV` — `sandbox` while testing; `production` for live billing.
- `FLW_CLIENT_ID` — Flutterwave v4 Client ID.
- `FLW_CLIENT_SECRET` — Flutterwave v4 Client Secret. Server only.
- `FLW_ENCRYPTION_KEY` — Flutterwave v4 Encryption Key. Used only to tell the browser how to encrypt card fields; never store card data on FlipSheet.
- `FLW_SECRET_HASH` — random webhook secret configured in Flutterwave.
- `GOOGLE_SCRIPT_CLIENT_ID` — OAuth client ID that is the audience of `ScriptApp.getIdentityToken()`.
- `FIREBASE_SERVICE_ACCOUNT` — service-account JSON for Firestore + FCM server operations.
- `FIREBASE_WEB_CONFIG` — public Firebase Web SDK config JSON for the optional notification page.
- `FIREBASE_VAPID_KEY` — Firebase Cloud Messaging Web Push public VAPID key (optional because FlipSheet has a public-key fallback; setting it in Vercel is still recommended).
- `CRON_SECRET` — long random secret used by the recurring-renewal cron endpoint.

No Flutterwave secret key, Google service-account private key, or Firebase service-account JSON belongs in the Apps Script or public folder.


## Current Vercel environment variables

These are the complete variables used by the current v8 build. There are **no additional secret variables introduced by the UI/automation polish update**.

| Variable | Required | Purpose |
|---|---|---|
| `APP_URL` | Yes | Public HTTPS FlipSheet origin, without a trailing slash |
| `FLW_ENV` | Yes | `sandbox` for testing or `production` for live Flutterwave v4 |
| `FLW_CLIENT_ID` | Yes | Flutterwave v4 OAuth client ID |
| `FLW_CLIENT_SECRET` | Yes | Flutterwave v4 OAuth client secret; server only |
| `FLW_ENCRYPTION_KEY` | Yes for card checkout | Flutterwave v4 card-field encryption key |
| `FLW_SECRET_HASH` | Yes for webhooks | Webhook signature secret/hash |
| `GOOGLE_SCRIPT_CLIENT_ID` | Yes | OAuth audience used to verify Apps Script identity tokens |
| `FIREBASE_SERVICE_ACCOUNT` | Yes for Firestore/FCM | Firebase Admin service-account JSON; server only |
| `FIREBASE_WEB_CONFIG` | Yes for web notifications | Public Firebase Web SDK config JSON returned to the notification page |
| `FIREBASE_VAPID_KEY` | Recommended | Firebase Cloud Messaging Web Push public VAPID key; the current build has a public fallback, but keeping it in Vercel is cleaner |
| `CRON_SECRET` | Yes for renewals | Secret used by the daily `/api/billing/renew` cron request |

### Values that must never be exposed

`FLW_CLIENT_SECRET`, `FIREBASE_SERVICE_ACCOUNT`, `FLW_SECRET_HASH`, `CRON_SECRET`, and any other private credentials belong only in Vercel server environment variables. The Firebase Web config and FCM VAPID public key are client configuration, not Admin credentials.

## 2. Flutterwave v4 billing

FlipSheet uses Flutterwave v4 for the entire payment lifecycle:

1. OAuth 2.0 access token.
2. Create/reuse customer.
3. Create encrypted card payment method.
4. Create initial charge.
5. Handle redirect/OTP authorization when required.
6. Verify the charge.
7. Store only the Flutterwave customer ID and payment-method ID.
8. Run later charges with `recurring: true`.
9. Receive and verify v4 webhooks.

Flutterwave's v4 tokenization flow explicitly supports recurring charges using a stored `payment_method_id` and `recurring: true`; recurring charges do not require another authorization. See the official v4 Card Payments documentation.

## 3. Flutterwave dashboard

Set the webhook URL to:

`https://YOUR_DOMAIN/api/flutterwave/webhook`

Set the webhook secret hash to the same value as `FLW_SECRET_HASH`.

Enable the payment/charge events needed for successful, failed and pending-to-successful charge updates. Flutterwave recommends signature verification, re-querying critical transactions, idempotent processing and a backup verification strategy.

For v4 card tokenization, retrieve the v4 Encryption Key from Flutterwave API settings. Do not put the v4 Client Secret in client-side code.

## 4. Plans

FlipSheet currently tests:

- USD Pro Monthly — $5/month
- USD Pro Yearly — $49/year
- NGN Pro Monthly — ₦7,500/month
- NGN Pro Yearly — ₦75,000/year

These are application-level plan values. Unlike Flutterwave Payment Plans, FlipSheet itself schedules v4 tokenized recurring charges, so there are no legacy v3 Payment Plan IDs in the application.

## 5. Recurring billing

A daily Vercel cron calls `/api/billing/renew`. It is protected with `CRON_SECRET`. Only active users whose `nextChargeAt` has passed are eligible. Each renewal uses a unique reference and idempotency key. Failed renewals move the account to `past_due`; they do not silently retain paid status.

For higher scale, move renewal processing to a queue/worker rather than increasing a single serverless function's duration.

## 6. Google Workspace / Apps Script

Create one Google Cloud project and link it to the Apps Script project. For initial private testing, the important Marketplace service is **Google Workspace Marketplace SDK**. Google Sheets API and Apps Script API are not required by the current runtime because the code uses Apps Script services directly.

Apps Script manifest scopes are intentionally narrow: current spreadsheet access, external HTTP requests, script triggers, OpenID identity and user email.

Complete OAuth verification and Marketplace review before public release.

## 7. Firebase / FCM

Enable Firebase Authentication with Google provider, Firestore, and Cloud Messaging. Web Push also needs a VAPID key and a correctly configured HTTPS origin.

Notifications are optional; the spreadsheet core does not depend on FCM.


## 8. APIs to enable

### Required for this build

1. **Google Workspace Marketplace SDK** — required to configure the Marketplace listing, integration, visibility and scopes. Google explicitly requires the SDK for Marketplace publishing.
2. **Google Workspace add-ons / Apps Script project services** — the Apps Script runtime provides the Sheets Editor add-on services.

### Recommended in the linked Google Cloud project

3. **Google Sheets API** — not called directly by the current code, because FlipSheet uses the Apps Script Spreadsheet service; enable it if you later add Advanced Sheets API features or administrative tooling.
4. **Apps Script API** — only needed if you want to manage/deploy Apps Script projects programmatically; it is not required for the runtime path in this ZIP.


### FlipSheet Web Firebase SDK
The public notification page loads `/firebase.js`, which contains the Firebase Web SDK imports and the public Firebase web configuration for the `flipsheet` project. This file is safe to expose as client configuration; Firebase Security Rules and Authentication remain responsible for protecting data. Do not put the Firebase Admin service-account JSON in `public/`.

### Automation authorization
Daily automations use an installable time-driven trigger and reopen the saved spreadsheet with `SpreadsheetApp.openById()`. The Apps Script manifest therefore uses the full `spreadsheets` scope instead of `spreadsheets.currentonly`. The add-on asks for that permission when an automation is created, because the scheduled trigger must be able to access the saved spreadsheet without an active editor selection.

### Firebase project

Enable/add Firebase to the Google Cloud project, then configure **Firebase Authentication**, **Cloud Firestore**, and **Firebase Cloud Messaging**. Firebase automatically enables several underlying Google APIs when Firebase is added to an existing Cloud project.

### OAuth scopes currently used by the add-on

- `openid`
- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/script.external_request`
- `https://www.googleapis.com/auth/script.scriptapp`
- `https://www.googleapis.com/auth/userinfo.email`

Keep these scopes aligned across the Apps Script manifest, OAuth consent configuration and Marketplace SDK. Google recommends the narrowest possible scope set for public Editor add-ons.
