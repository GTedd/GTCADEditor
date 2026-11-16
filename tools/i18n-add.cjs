// Merge new translation keys into the language catalogs without rewriting unrelated entries.
// Usage: node tools/i18n-add.cjs fragment.json [--update]
// fragment.json: { "cadeditor.ui.area.key": { "en_us": "Text", "zh_cn": "文本", "ja_jp": "…" }, ... }
// en_us and zh_cn are required for new keys; other locales are optional. Existing keys are kept unless --update.
// Then run: node tools/i18n-sync.cjs
const fs = require('node:fs');
const path = require('node:path');
const langDir = path.resolve(__dirname, '../common/src/main/resources/assets/cadeditor/lang');
const args = process.argv.slice(2);
const update = args.includes('--update');
const file = args.find((a) => !a.startsWith('--'));
if (!file) throw new Error('Usage: node tools/i18n-add.cjs fragment.json [--update]');
const fragment = JSON.parse(fs.readFileSync(file, 'utf8'));
const locales = new Set(['en_us', 'zh_cn']);
for (const [key, entry] of Object.entries(fragment)) {
  if (!/^[a-z0-9_.-]+$/.test(key)) throw new Error('Invalid key: ' + key);
  if (!entry || typeof entry !== 'object') throw new Error('Entry must be an object: ' + key);
  for (const locale of Object.keys(entry)) {
    if (!/^[a-z0-9_]{2,32}$/.test(locale)) throw new Error('Invalid locale ' + locale + ' for ' + key);
    if (typeof entry[locale] !== 'string' || !entry[locale].trim())
      throw new Error('Empty translation ' + locale + ' for ' + key);
    locales.add(locale);
  }
}
const read = (locale) => {
  const target = path.join(langDir, locale + '.json');
  return fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
};
const english = read('en_us');
for (const [key, entry] of Object.entries(fragment))
  if (!('en_us' in entry && 'zh_cn' in entry) && !(key in english))
    throw new Error('New key needs en_us and zh_cn: ' + key);
let added = 0,
  changed = 0;
for (const locale of locales) {
  const target = path.join(langDir, locale + '.json');
  const catalog = read(locale);
  let dirty = false;
  for (const [key, entry] of Object.entries(fragment)) {
    if (!(locale in entry)) continue;
    const isNew = !Object.prototype.hasOwnProperty.call(catalog, key);
    if (isNew && locale !== 'en_us' && locale !== 'zh_cn' && !(key in english) && !('en_us' in entry))
      throw new Error('Unknown key for ' + locale + ': ' + key);
    if (isNew || (update && catalog[key] !== entry[locale])) {
      if (isNew) added++;
      else changed++;
      catalog[key] = entry[locale];
      dirty = true;
    }
  }
  if (!dirty) continue;
  const temp = target + '.tmp-' + process.pid;
  fs.writeFileSync(temp, JSON.stringify(catalog, null, 2) + '\n');
  fs.renameSync(temp, target);
}
console.log('i18n-add: ' + added + ' added, ' + changed + ' updated across ' + [...locales].join(', '));
