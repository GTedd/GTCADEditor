// The editor page's scripts in load order. index.html carries only js/boot.js, the staged loader, which inserts the
// scripts listed in its EDITOR_SCRIPTS after the first frame; tests and lint load that same list directly (never the
// loader itself). Plain <script src> tags in index.html (older UI_DIR versions) still work.
const fs = require('node:fs');
const path = require('node:path');

function scriptOrder(dir) {
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8'),
    order = [];
  html.replace(/<script src="(js\/[^"]+)"/g, (m, f) => {
    if (f === 'js/boot.js') order.push(...bootList(dir));
    else order.push(f);
    return m;
  });
  return order;
}

function bootList(dir) {
  const src = fs.readFileSync(path.join(dir, 'js/boot.js'), 'utf8');
  const m = /var EDITOR_SCRIPTS = \[([\s\S]*?)\];/.exec(src);
  if (!m) throw new Error('js/boot.js has no EDITOR_SCRIPTS list');
  const list = [...m[1].matchAll(/'(js\/[^']+)'/g)].map((x) => x[1]);
  if (!list.length) throw new Error('js/boot.js lists no scripts');
  return list;
}

module.exports = { scriptOrder };
