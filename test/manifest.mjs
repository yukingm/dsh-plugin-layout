// Local pre-flight for the marketplace submission requirements that can be
// checked without GitHub: the installable manifest (dsh.bundle), the patch file
// it points at, the locales, the raster icon, and the metadata the awesome list
// asks for. Run with `node test/manifest.mjs`.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(join(root, name), 'utf8');
const failures = [];
const check = (condition, message) => {
  if (condition) console.log('ok   ' + message);
  else {
    failures.push(message);
    console.error('FAIL ' + message);
  }
};

const pkg = JSON.parse(read('package.json'));

check(pkg.private !== true, 'package.json is publishable (no "private": true)');
check(typeof pkg.name === 'string' && /^[a-z0-9][a-z0-9._-]*$/.test(pkg.name), 'name is a valid npm name: ' + pkg.name);
check(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pkg.version), 'version is semver: ' + pkg.version);
check(typeof pkg.description === 'string' && pkg.description.length > 0 && pkg.description.trim().endsWith('.'), 'description is non-empty and ends with a period');
check(pkg.license === 'MIT', 'license is declared');

// The one hard requirement of the awesome list: a dsh.bundle manifest.
const patchPath = pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch;
check(typeof patchPath === 'string' && patchPath.length > 0, 'dsh.bundle.patch is declared');
check(typeof patchPath === 'string' && existsSync(join(root, patchPath)), 'the patch file exists: ' + patchPath);
check(pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === 'web', 'dsh.client.platform is web');

if (typeof patchPath === 'string' && existsSync(join(root, patchPath))) {
  const patch = read(patchPath);
  check(patch.includes('insert:'), 'patch has an insert row');
  check(patch.includes('id: plugin-layout'), 'patch row id is plugin-layout');
  check(patch.includes('name: ' + pkg.name), 'patch row name matches the package name');
}

for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg']) {
  check(existsSync(join(root, file)), 'file exists: ' + file);
  check(readFileSync(join(root, 'package.json'), 'utf8').includes(file), 'file is shipped in "files": ' + file);
}

for (const locale of ['locale/zh.json', 'locale/en.json']) {
  const text = read(locale);
  const json = JSON.parse(text);
  check(typeof json.meta?.title === 'string' && json.meta.title.length > 0, locale + ' has meta.title');
  check(typeof json.meta?.description === 'string' && json.meta.description.length > 0, locale + ' has meta.description');
}

// Storefront tiles must be a raster image; SVG alone is refused by the list.
check(existsSync(join(root, 'assets/icon-180.png')), 'raster tile exists: assets/icon-180.png');
check(!read('package.json').includes('"private": true'), 'no private flag');

// GitHub placeholders are fine while developing, but the entry is published as-is.
const ownerPlaceholder = JSON.stringify(pkg).includes('OWNER');
if (ownerPlaceholder) console.warn('warn repository/author still say OWNER; replace before opening the PR');

if (failures.length > 0) {
  console.error('\n' + failures.length + ' check(s) failed');
  process.exit(1);
}
console.log('\nmanifest OK (replace OWNER before publishing)');
