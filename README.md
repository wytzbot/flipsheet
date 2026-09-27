# FlipSheet

Google Sheets Editor add-on for spreadsheet data repair and recurring maintenance.

## Core experience

Select a range → Analyze → Clean. Less-used tools and automation controls live inside collapsible sections so the first screen stays focused.

Core operations run in Apps Script against the active spreadsheet. Formula cells are preserved by text-cleaning operations.

## Billing

Production billing is Flutterwave v4 only:

- v4 OAuth authentication
- v4 customer creation/reuse
- v4 encrypted card payment method
- v4 initial charge + authorization handling
- v4 charge verification
- v4 tokenized recurring charges
- signed webhook processing
- idempotency protection
- daily renewal job
- monthly + yearly plans in USD and NGN

No v3 Flutterwave checkout or legacy secret key is required.

## Notifications

FCM Web Push is optional. Core spreadsheet actions continue to work when notifications are unavailable.

## Start here

Read **[START-HERE.md](START-HERE.md)** first. It uses the simplest path: deploy Vercel → configure Firebase → link one Google Cloud project → test the Apps Script add-on privately → test automations → configure Marketplace only when the app is stable.

Replace `YOUR_DOMAIN` in Apps Script and production metadata before deployment. Configure the Vercel variables in `docs/ENVIRONMENT.md`.
