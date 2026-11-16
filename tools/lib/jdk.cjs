// Locate a JDK 25 tool (java / javac) for tests that run production Java code.
// Order: JAVA_HOME, a Gradle-provisioned JDK 25, ~/.jdks/jdk-25*, then PATH.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const exe = (name) => (process.platform === 'win32' ? name + '.exe' : name);

function jdkBins() {
  const bins = [];
  if (process.env.JAVA_HOME) bins.push(path.join(process.env.JAVA_HOME, 'bin'));
  for (const base of [path.join(os.homedir(), '.gradle/jdks'), path.join(os.homedir(), '.jdks')]) {
    let names = [];
    try {
      names = fs.readdirSync(base);
    } catch (e) {
      continue;
    }
    names
      .filter((n) => /(^|[-_])(jdk-)?25([-_.+]|$)/.test(n))
      .sort()
      .reverse()
      .forEach((n) => bins.push(path.join(base, n, 'bin')));
  }
  return bins;
}

function jdkTool(name) {
  for (const bin of jdkBins()) {
    const file = path.join(bin, exe(name));
    if (fs.existsSync(file)) return file;
  }
  return name;
}

module.exports = { jdkTool };
