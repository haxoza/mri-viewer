import { readFile, readdir, writeFile } from 'node:fs/promises';
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const rows = [];
const notices = [];
for (const [dir, entry] of Object.entries(lock.packages)) {
  if (!dir || entry.dev) continue;
  const manifest = await readFile(`${dir}/package.json`, 'utf8').catch(() => null);
  if (!manifest) continue; // Optional packages for other platforms are not installed.
  const pkg = JSON.parse(manifest);
  const files = (await readdir(dir)).filter((name) =>
    /^(licen[cs]e|copying|notice)(\.|$)/i.test(name),
  );
  rows.push(
    `| ${pkg.name} | ${pkg.version} | ${pkg.license ?? 'Not declared'} | ${files.length ? 'Included' : 'Not in npm package root'} |`,
  );
  notices.push(`${pkg.name} ${pkg.version}\nDeclared license: ${pkg.license ?? 'Not declared'}\n`);
  for (const file of files) {
    try {
      notices.push(await readFile(`${dir}/${file}`, 'utf8'));
    } catch {
      /* Some distributions use a LICENSE directory. */
    }
  }
}
await writeFile('public/THIRD_PARTY_NOTICES.txt', notices.join('\n\n'));
await writeFile(
  'docs/dependency-licenses.md',
  `# Dependency license inventory\n\nGenerated from the pinned installed production packages with \`node scripts/dependency-notices.mjs\`. This records package declarations and includes available license/notice texts in \`public/THIRD_PARTY_NOTICES.txt\`, copied to the production build. Codec wrapper declarations do not replace the license requirements of embedded native codec code. Review missing upstream notices and embedded codec attributions before redistributing a public release.\n\n| Package | Version | Declared license | Root notice text |\n| --- | --- | --- | --- |\n${rows.sort().join('\n')}\n`,
);
