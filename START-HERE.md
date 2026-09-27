# FlipSheet — START HERE

This is the simplest setup path. **Do not start with Marketplace publishing.** Get FlipSheet working as a private/test add-on first, then publish later.

## 1. Deploy the website/API first

1. Upload this project to GitHub.
2. Import the repo into Vercel.
3. Set the Vercel environment variables listed in `docs/ENVIRONMENT.md`.
4. Deploy.
5. Confirm the Vercel URL opens before touching Apps Script.

Example:

`https://flipsheet.vercel.app`

> Replace every `YOUR_DOMAIN` placeholder in this package with your real HTTPS domain before deployment.

## 2. Firebase

Firebase project: **flipsheet**.

Enable:

- Authentication (Google provider if you use the notification web page)
- Firestore Database
- Cloud Messaging

Your public Web config belongs in `FIREBASE_WEB_CONFIG`.
Your public Web Push VAPID key belongs in `FIREBASE_VAPID_KEY`.

Never put `FIREBASE_SERVICE_ACCOUNT` in the public folder or Apps Script.

## 3. Google Cloud — only the simple setup first

Go to Google Cloud Console and create/select **one dedicated FlipSheet project**.

Enable:

- **Google Workspace Marketplace SDK** — needed when you configure/publish the Marketplace add-on.

You do **not** need to manually add the Apps Script OAuth scopes in Cloud Console just to make the Apps Script runtime work. They are already declared in `apps-script/appsscript.json`.

You also do not need the Apps Script API or Google Sheets API for the core runtime in this package.

## 4. Link Apps Script to the same Cloud project

1. Open https://script.google.com/
2. Create/open the FlipSheet Apps Script project.
3. Open **Project Settings**.
4. Find **Google Cloud Platform (GCP) Project**.
5. Link/select the same FlipSheet Cloud project.
6. Make sure **Show `appsscript.json` manifest file in editor** is enabled.
7. Copy the three files from `apps-script/` into the project:
   - `Code.gs`
   - `Sidebar.html`
   - `appsscript.json`

Do not manually duplicate the scopes.

## 5. Replace YOUR_DOMAIN

In Apps Script, replace:

`https://YOUR_DOMAIN/api`

with your actual API URL, for example:

`https://flipsheet.vercel.app/api`

Also replace the manifest logo URL:

`https://YOUR_DOMAIN/assets/icon-128.png`

with:

`https://flipsheet.vercel.app/assets/icon-128.png`

Also replace the domain in public canonical URLs, sitemap, robots and Marketplace documentation if you are using those files for production.

## 6. Test before Marketplace publishing

Use the Apps Script test deployment first.

1. Apps Script → **Deploy** → **Test deployments**.
2. Select the **Editor add-on** test option.
3. Install the test deployment.
4. Open a Google Sheet.
5. Open **Extensions → FlipSheet**.
6. Open the sidebar.
7. Authorize the requested permissions.

Now test:

- Analyze
- Clean
- Duplicates
- Email check
- Standardize
- Create automation
- Run now
- Repair schedule
- Remove automation
- Notifications
- Billing/checkout

## 7. Test automation

Create one small test automation first.

Then check:

**Apps Script → Triggers**

A FlipSheet installable time-driven trigger should exist.

Use **Run now** before waiting for the scheduled time.

If the trigger is removed, use **Repair schedule** inside FlipSheet.

Do not manually create duplicate triggers.

## 8. Only after testing: Marketplace

When the private/test version works:

1. Create a versioned Apps Script deployment.
2. Configure Google Auth Platform/OAuth.
3. Configure Google Workspace Marketplace SDK.
4. Add the required Marketplace listing information.
5. Test the Marketplace installation.
6. Submit for review.

You do not need Marketplace configuration to start normal development/testing.

## 9. The scopes are already in the ZIP

Current manifest scopes:

- `openid`
- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/script.external_request`
- `https://www.googleapis.com/auth/script.container.ui`
- `https://www.googleapis.com/auth/script.scriptapp`
- `https://www.googleapis.com/auth/userinfo.email`

Do not add random Drive/Gmail/Calendar scopes.

The full `spreadsheets` scope is intentional because scheduled automations reopen the saved spreadsheet with `SpreadsheetApp.openById()`.

## 10. If something fails

### Sidebar does not open

- Check that `script.container.ui` is present in the manifest.
- Re-authorize the test deployment.
- Check Apps Script → Executions.

### Automation does not run

- Check Apps Script → Triggers.
- Use **Repair schedule**.
- Run the automation manually first.
- Check Apps Script → Executions.

### Backend says route/API failed

- Check `API_BASE` in `Code.gs`.
- Check the Vercel deployment.
- Check Vercel environment variables.

### Notifications fail

- Check `FIREBASE_WEB_CONFIG`.
- Check `FIREBASE_SERVICE_ACCOUNT`.
- Check `FIREBASE_VAPID_KEY`.
- Use HTTPS.

### Billing fails

- Use `FLW_ENV=sandbox` while testing.
- Check all Flutterwave v4 variables.
- Check Vercel logs.
- Do not use legacy Flutterwave v3 Payment Plan credentials.

## Simple mental model

`Google Sheet → FlipSheet Apps Script → FlipSheet Vercel API → Firebase / Flutterwave`

You only need to configure each layer once.
