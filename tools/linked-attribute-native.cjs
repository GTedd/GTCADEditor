// Helper for LinkedAttributeTest (Java): reads plan cases as JSON on stdin and writes the
// production linkedAttributePlan results as JSON on stdout.
// Run by hand without input, it only checks that the UI scripts load and exits 0.
const H = require('./lib/ui-harness.cjs'),
  c = H.create().c;
function plans(input) {
  const cases = JSON.parse(input);
  process.stdout.write(
    JSON.stringify(
      cases.map((x) => {
        try {
          return c.linkedAttributePlan(x.def, x.row, x.requested);
        } catch (e) {
          return { error: e.message };
        }
      })
    )
  );
}
function noInput() {
  if (typeof c.linkedAttributePlan !== 'function') {
    console.error('FAIL linkedAttributePlan is not defined by the UI scripts');
    process.exit(1);
  }
  console.log('SKIP linked-attribute-native: no cases on stdin (driven by LinkedAttributeTest); UI scripts load.');
  process.exit(0);
}
if (process.stdin.isTTY) noInput();
else {
  let input = '',
    got = false;
  // An open stdin that never sends data (shell or runner) must not hang the helper.
  const idle = setTimeout(() => {
    if (!got) noInput();
  }, 2000);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    got = true;
    input += chunk;
  });
  process.stdin.on('end', () => {
    clearTimeout(idle);
    if (!input.trim()) noInput();
    plans(input);
  });
}
