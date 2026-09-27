const CFG = {
  APP_NAME: 'FlipSheet',
  API_BASE: 'https://YOUR_DOMAIN/api',
  FREE_ROWS: 500,
  FREE_AUTOMATIONS: 2,
  MAX_AUTOMATIONS: 18,
  MAX_RANGE_CELLS: 100000,
  PROP_KEY: 'sheetops_automations_v2'
};

function onOpen(e) {
  SpreadsheetApp.getUi().createAddonMenu()
    .addItem('Open FlipSheet', 'showSidebar')
    .addToUi();
}

function onInstall(e) { onOpen(e); }
function onHomepage(e) { return buildHomeCard(); }

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('FlipSheet');
  SpreadsheetApp.getUi().showSidebar(html);
}

function currentEmail_() {
  return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
}

function apiRequest_(path, options) {
  options = options || {};
  const token = ScriptApp.getIdentityToken();
  if (!token) throw new Error('Google identity is unavailable. Re-open FlipSheet and authorize it.');
  const headers = Object.assign({Authorization: 'Bearer ' + token}, options.headers || {});
  const response = UrlFetchApp.fetch(CFG.API_BASE + path, Object.assign({muteHttpExceptions: true}, options, {headers: headers}));
  const code = response.getResponseCode();
  let data = {};
  try { data = JSON.parse(response.getContentText() || '{}'); } catch (_) {}
  if (code < 200 || code >= 300) throw new Error(data.error || 'FlipSheet service is temporarily unavailable.');
  return data;
}

function license_() {
  const cache = CacheService.getUserCache();
  const cached = cache.get('sheetops_license');
  if (cached) { try { return JSON.parse(cached); } catch (_) {} }
  try { const out = apiRequest_('/license'); cache.put('sheetops_license', JSON.stringify(out), 60); return out; }
  catch (e) { return {plan: 'free', active: true, offline: true, message: e.message}; }
}

function result_(ok, message, extra) { return Object.assign({ok: !!ok, message: String(message || '')}, extra || {}); }
function friendly_(e) { return String(e && e.message || e).replace(/^Exception:\s*/, ''); }

function selectedRange_() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getActiveSheet();
  const range = sheet.getActiveRange();
  if (!range) throw new Error('Select the cells you want FlipSheet to work on first.');
  if (range.getNumRows() < 1 || range.getNumColumns() < 1) throw new Error('Select at least one cell.');
  if (range.getNumRows() * range.getNumColumns() > CFG.MAX_RANGE_CELLS) throw new Error('That selection is too large for a fast Sheets operation. Select a smaller range.');
  return {ss, sheet, range};
}

function getContext() {
  try {
    const x = selectedRange_();
    const lic = license_();
    return {
      sheet: x.sheet.getName(), range: x.range.getA1Notation(),
      rows: x.range.getNumRows(), cols: x.range.getNumColumns(),
      cells: x.range.getNumRows() * x.range.getNumColumns(), license: lic,
      email: currentEmail_()
    };
  } catch (e) {
    return {sheet: SpreadsheetApp.getActiveSheet().getName(), range: '', rows: 0, cols: 0, cells: 0, license: license_(), error: friendly_(e)};
  }
}

function checkLimit_(range) {
  const lic = license_();
  if ((lic.plan || 'free') === 'free' && range.getNumRows() > CFG.FREE_ROWS) {
    throw new Error('Free plan supports up to ' + CFG.FREE_ROWS + ' rows per operation. Upgrade for larger ranges.');
  }
  return lic;
}

function analyzeSelected() {
  try {
    const x = selectedRange_();
    checkLimit_(x.range);
    const values = x.range.getValues();
    const formulas = x.range.getFormulas();
    let blank = 0, duplicate = 0, invalidEmail = 0, textCells = 0, whitespace = 0;
    const seen = {};
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    values.forEach((row, r) => {
      const key = JSON.stringify(row.map(v => v instanceof Date ? v.toISOString() : v));
      if (seen[key]) duplicate++; else seen[key] = true;
      row.forEach((v, c) => {
        if (formulas[r][c]) return;
        if (v === '' || v === null) blank++;
        if (typeof v === 'string') {
          textCells++;
          if (/\s{2,}|^\s|\s$/.test(v)) whitespace++;
          if (v.indexOf('@') >= 0 && !emailRe.test(v.trim())) invalidEmail++;
        }
      });
    });
    return result_(true, 'Analysis complete.', {blank, duplicate, invalidEmail, whitespace, textCells, rows: values.length});
  } catch (e) { return result_(false, friendly_(e)); }
}

function transformStrings_(range, mode) {
  const values = range.getValues();
  const formulas = range.getFormulas();
  let changed = 0;
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      if (formulas[r][c] || typeof values[r][c] !== 'string') continue;
      const old = values[r][c];
      const next = mode === 'clean' ? old.replace(/\s+/g, ' ').trim() : old.trim().replace(/\s+/g, ' ');
      if (next !== old) { values[r][c] = next; changed++; }
    }
  }
  if (changed) range.setValues(values);
  return changed;
}

function cleanSelected() {
  try { const x = selectedRange_(); checkLimit_(x.range); const changed = transformStrings_(x.range, 'clean'); return result_(true, changed + ' text cells cleaned.', {changed}); }
  catch (e) { return result_(false, 'Clean failed: ' + friendly_(e)); }
}

function standardizeSelected() {
  try { const x = selectedRange_(); checkLimit_(x.range); const changed = transformStrings_(x.range, 'standardize'); return result_(true, changed + ' text cells standardized.', {changed}); }
  catch (e) { return result_(false, 'Standardize failed: ' + friendly_(e)); }
}

function validateEmailsSelected() {
  try {
    const x = selectedRange_(); checkLimit_(x.range);
    const values = x.range.getValues(); const formulas = x.range.getFormulas();
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; let invalid = 0;
    values.forEach((row, r) => row.forEach((cell, c) => {
      if (formulas[r][c] || typeof cell !== 'string' || cell.indexOf('@') < 0) return;
      if (!re.test(cell.trim())) invalid++;
    }));
    return result_(true, invalid ? invalid + ' email-like cells need review.' : 'No malformed email-like cells found.', {invalid});
  } catch (e) { return result_(false, 'Email validation failed: ' + friendly_(e)); }
}

function removeDuplicatesSelected() {
  try {
    const x = selectedRange_(); checkLimit_(x.range);
    const values = x.range.getValues();
    if (values.length < 2) return result_(true, 'Nothing to deduplicate.');
    const seen = new Set(); const duplicateRows = [];
    values.forEach((row, i) => {
      const key = JSON.stringify(row.map(v => v instanceof Date ? v.toISOString() : v));
      if (seen.has(key)) duplicateRows.push(i); else seen.add(key);
    });
    if (!duplicateRows.length) return result_(true, 'No duplicate rows found.', {removed: 0});
    // Only delete physical sheet rows when the selected range spans the sheet's full used width.
    // Otherwise clear only the duplicate cells to avoid shifting unrelated columns.
    const fullWidth = x.range.getColumn() === 1 && x.range.getNumColumns() === x.sheet.getLastColumn();
    if (fullWidth) {
      duplicateRows.slice().sort((a,b)=>b-a).forEach(i => x.sheet.deleteRow(x.range.getRow() + i));
      return result_(true, 'Deleted ' + duplicateRows.length + ' duplicate rows.', {removed: duplicateRows.length, deletedRows: true});
    }
    duplicateRows.slice().sort((a,b)=>b-a).forEach(i => x.range.offset(i, 0, 1, x.range.getNumColumns()).clearContent());
    return result_(true, 'Cleared ' + duplicateRows.length + ' duplicate rows inside the selected range.', {removed: duplicateRows.length, deletedRows: false});
  } catch (e) { return result_(false, 'Duplicate removal failed: ' + friendly_(e)); }
}

function automationStore_() {
  const props = PropertiesService.getUserProperties();
  try { return JSON.parse(props.getProperty(CFG.PROP_KEY) || '[]'); } catch (_) { return []; }
}
function saveAutomations_(arr) { PropertiesService.getUserProperties().setProperty(CFG.PROP_KEY, JSON.stringify(arr)); }

function createAutomation(name, action, hour, headerRows) {
  try {
    const x = selectedRange_();
    const lic = license_();
    const arr = automationStore_();
    if (arr.length >= CFG.MAX_AUTOMATIONS) return result_(false, 'Automation limit reached.');
    if ((lic.plan || 'free') === 'free' && arr.length >= CFG.FREE_AUTOMATIONS) return result_(false, 'Free plan includes ' + CFG.FREE_AUTOMATIONS + ' automations. Upgrade for more.');
    ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, [
      'https://www.googleapis.com/auth/script.scriptapp',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/script.external_request',
      'https://www.googleapis.com/auth/userinfo.email',
      'openid'
    ]);
    const h = Math.max(0, Math.min(23, Number(hour) || 8));
    const id = Utilities.getUuid();
    const trigger = ScriptApp.newTrigger('runAutomation').timeBased().everyDays(1).atHour(h).create();
    try {
      arr.push({
        id, name: String(name || 'Daily cleanup').slice(0, 80), action: String(action || 'clean'), hour: h,
        spreadsheetId: x.ss.getId(), sheetName: x.sheet.getName(), rangeA1: x.range.getA1Notation(), startRow: x.range.getRow(), startColumn: x.range.getColumn(), numColumns: x.range.getNumColumns(),
        headerRows: Math.max(0, Math.min(1, Number(headerRows) || 0)), triggerId: trigger.getUniqueId(),
        createdAt: new Date().toISOString(), lastRunAt: null, lastResult: null
      });
      saveAutomations_(arr);
    } catch (saveError) {
      try { ScriptApp.deleteTrigger(trigger); } catch (_) {}
      throw saveError;
    }
    return result_(true, 'Daily automation created for ' + x.sheet.getName() + '!' + x.range.getA1Notation() + '.', {id});
  } catch (e) { return result_(false, 'Could not create automation: ' + friendly_(e)); }
}

function listAutomations() {
  const triggers = {};
  ScriptApp.getProjectTriggers().forEach(t => { triggers[t.getUniqueId()] = true; });
  return automationStore_().map(x => Object.assign({}, x, {triggerActive: !!triggers[x.triggerId]}));
}


function repairAutomation(id) {
  try {
    const arr = automationStore_(); const item = arr.find(x => x.id === id);
    if (!item) return result_(false, 'Automation not found.');
    const active = ScriptApp.getProjectTriggers().some(t => t.getUniqueId() === item.triggerId);
    if (active) return result_(true, 'Automation schedule is already active.');
    ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, [
      'https://www.googleapis.com/auth/script.scriptapp',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/script.external_request',
      'https://www.googleapis.com/auth/userinfo.email',
      'openid'
    ]);
    const h = Math.max(0, Math.min(23, Number(item.hour) || 8));
    const trigger = ScriptApp.newTrigger('runAutomation').timeBased().everyDays(1).atHour(h).create();
    const previousTriggerId = item.triggerId;
    try {
      item.triggerId = trigger.getUniqueId();
      item.lastResult = null;
      saveAutomations_(arr);
    } catch (saveError) {
      try { ScriptApp.deleteTrigger(trigger); } catch (_) {}
      item.triggerId = previousTriggerId;
      throw saveError;
    }
    return result_(true, 'Automation schedule repaired.');
  } catch (e) { return result_(false, 'Could not repair automation: ' + friendly_(e)); }
}

function deleteAutomation(id) {
  try {
    const arr = automationStore_(); const item = arr.find(x => x.id === id);
    if (!item) return result_(false, 'Automation not found.');
    ScriptApp.getProjectTriggers().forEach(t => { if (t.getUniqueId() === item.triggerId) ScriptApp.deleteTrigger(t); });
    saveAutomations_(arr.filter(x => x.id !== id));
    return result_(true, 'Automation removed.');
  } catch (e) { return result_(false, 'Could not remove automation: ' + friendly_(e)); }
}

function automationRange_(item) {
  const ss = SpreadsheetApp.openById(item.spreadsheetId);
  const sheet = ss.getSheetByName(item.sheetName);
  if (!sheet) throw new Error('The sheet "' + item.sheetName + '" no longer exists.');
  const startRow = Number(item.startRow || sheet.getRange(item.rangeA1).getRow());
  const startColumn = Number(item.startColumn || sheet.getRange(item.rangeA1).getColumn());
  const numColumns = Number(item.numColumns || sheet.getRange(item.rangeA1).getNumColumns());
  const dataStart = startRow + (item.headerRows ? 1 : 0);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (dataStart > lastRow) return null;
  if (startColumn > lastCol) throw new Error('The configured columns are no longer available.');
  const cols = Math.min(numColumns, lastCol - startColumn + 1);
  const rows = lastRow - dataStart + 1;
  if (rows * cols > CFG.MAX_RANGE_CELLS) throw new Error('The automation range is too large. Reduce the number of rows or columns.');
  return sheet.getRange(dataStart, startColumn, rows, cols);
}

function executeAutomation_(item, arr) {
  try {
    const range = automationRange_(item);
    if (!range) throw new Error('No data rows found.');
    let outcome;
    if (item.action === 'duplicates') outcome = removeDuplicatesRange_(range);
    else if (item.action === 'emails') outcome = validateEmailsRange_(range);
    else if (item.action === 'standardize') outcome = {changed: transformStrings_(range, 'standardize')};
    else outcome = {changed: transformStrings_(range, 'clean')};
    item.lastRunAt = new Date().toISOString(); item.lastResult = outcome;
    saveAutomations_(arr);
    try { notifyAutomation_(item, 'Automation completed', JSON.stringify(outcome)); } catch (_) {}
    return result_(true, 'Automation completed.', outcome);
  } catch (err) {
    item.lastRunAt = new Date().toISOString(); item.lastResult = {error: friendly_(err)}; saveAutomations_(arr);
    try { notifyAutomation_(item, 'Automation needs attention', friendly_(err)); } catch (_) {}
    return result_(false, 'Automation failed: ' + friendly_(err));
  }
}

function runAutomation(e) {
  const uid = e && e.triggerUid;
  if (!uid) return;
  const arr = automationStore_(); const item = arr.find(x => x.triggerId === uid);
  if (!item) return;
  executeAutomation_(item, arr);
}

function runAutomationNow(id) {
  try {
    const arr = automationStore_(); const item = arr.find(x => x.id === id);
    if (!item) return result_(false, 'Automation not found.');
    ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/script.external_request',
      'https://www.googleapis.com/auth/userinfo.email',
      'openid'
    ]);
    return executeAutomation_(item, arr);
  } catch (e) { return result_(false, 'Could not run automation: ' + friendly_(e)); }
}

function removeDuplicatesRange_(range) {
  const values = range.getValues(); const seen = new Set(); const duplicate = [];
  values.forEach((row, i) => { const key = JSON.stringify(row.map(v => v instanceof Date ? v.toISOString() : v)); if (seen.has(key)) duplicate.push(i); else seen.add(key); });
  if (!duplicate.length) return {removed: 0};
  const sheet = range.getSheet();
  if (range.getColumn() === 1 && range.getNumColumns() === sheet.getLastColumn()) {
    duplicate.slice().sort((a,b)=>b-a).forEach(i => sheet.deleteRow(range.getRow()+i));
    return {removed: duplicate.length, deletedRows: true};
  }
  duplicate.slice().sort((a,b)=>b-a).forEach(i => range.offset(i, 0, 1, range.getNumColumns()).clearContent());
  return {removed: duplicate.length, deletedRows: false};
}
function validateEmailsRange_(range) {
  const values = range.getValues(), formulas = range.getFormulas(), re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/, invalid = [];
  values.forEach((row, r) => row.forEach((v, c) => { if (!formulas[r][c] && typeof v === 'string' && v.indexOf('@') >= 0 && !re.test(v.trim())) invalid.push([r, c]); }));
  return {invalid: invalid.length};
}

function notifyAutomation_(item, title, body) {
  try {
    apiRequest_('/push/send', {method: 'post', contentType: 'application/json', payload: JSON.stringify({title, body: item.name + ': ' + body})});
  } catch (_) {}
}

function getPlans() {
  try { return apiRequest_('/plans'); } catch (e) { return {plans: [], error: friendly_(e)}; }
}
function startCheckout(planId) {
  try {
    const out = apiRequest_('/checkout/session', {method: 'post', contentType: 'application/json', payload: JSON.stringify({plan: planId})});
    return result_(true, 'Opening secure checkout…', out);
  } catch (e) { return result_(false, friendly_(e)); }
}

function cancelSubscription() {
  try {
    const out = apiRequest_('/billing/cancel', {method: 'post', contentType: 'application/json', payload: '{}'});
    CacheService.getUserCache().remove('sheetops_license');
    return result_(true, out.message || 'Recurring renewal cancelled.');
  } catch (e) { return result_(false, friendly_(e)); }
}

function buildHomeCard() {
  const card = CardService.newCardBuilder().setHeader(
    CardService.newCardHeader().setTitle(CFG.APP_NAME).setSubtitle('Clean, repair and automate spreadsheets')
  );
  card.addSection(CardService.newCardSection().addWidget(
    CardService.newTextParagraph().setText('Select a range in Sheets, then open FlipSheet to clean data, detect duplicates, validate email-like values and schedule daily maintenance.')
  ));
  card.addSection(CardService.newCardSection().addWidget(
    CardService.newTextButton().setText('Open FlipSheet').setOnClickAction(CardService.newAction().setFunctionName('showSidebar'))
  ));
  return [card.build()];
}
