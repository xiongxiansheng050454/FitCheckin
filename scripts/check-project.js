const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
const mini = path.resolve(root, config.miniprogramRoot);
const app = JSON.parse(fs.readFileSync(path.join(mini, 'app.json'), 'utf8'));
const errors = [];
const subpackages = app.subPackages || [];
const routes = app.pages.concat(subpackages.flatMap(p => p.pages.map(page => p.root + '/' + page)));
const ignored = require('./check-package-size').ignored;
for (const route of routes) {
  for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
    if (!fs.existsSync(path.join(mini, route + extension))) errors.push('Missing page file: ' + route + extension);
  }
}
for (const tab of app.tabBar.list) {
  if (!app.pages.includes(tab.pagePath)) errors.push('tabBar page must be in main package: ' + tab.pagePath);
}
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const relative = path.relative(mini, file).replace(/\\/g, '/');
    if (ignored(relative, config.packOptions.ignore || [])) continue;
    if (entry.isDirectory()) { walk(file); continue; }
    const extension = path.extname(file);
    if (!['.js', '.json', '.wxml', '.wxss'].includes(extension)) continue;
    const text = fs.readFileSync(file, 'utf8');
    try {
      if (extension === '.js') new vm.Script(text, { filename: relative });
      if (extension === '.json') JSON.parse(text);
    } catch (err) { errors.push(relative + ': ' + err.message); }
    if (extension === '.js') {
      const own = subpackages.find(p => relative.startsWith(p.root + '/'));
      for (const match of text.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
        if (!match[1].startsWith('.')) continue;
        const target = path.resolve(path.dirname(file), match[1]);
        if (!fs.existsSync(target) && !fs.existsSync(target + '.js') && !fs.existsSync(path.join(target, 'index.js'))) errors.push(relative + ': missing import ' + match[1]);
        const targetRelative = path.relative(mini, target).replace(/\\/g, '/');
        const targetPackage = subpackages.find(p => targetRelative.startsWith(p.root + '/'));
        if (targetPackage && targetPackage !== own) errors.push(relative + ': forbidden cross-package import ' + match[1]);
      }
    }
    if (extension === '.wxml') {
      const jsPath = file.replace(/\.wxml$/, '.js');
      const js = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : '';
      for (const match of text.matchAll(/(?:bind|catch)(?::?[a-zA-Z]+)\s*=\s*['"]([A-Za-z_$][\w$]*)['"]/g)) {
        if (!new RegExp('\\b' + match[1] + '\\s*(?:\\(|:)').test(js)) errors.push(relative + ': missing event handler ' + match[1]);
      }
      for (const match of text.matchAll(/(?:src|iconPath|selectedIconPath)\s*=\s*['"]([^'"]+)['"]/g)) {
        if (/^(https?:|cloud:|data:)|\{\{/.test(match[1])) continue;
        const asset = match[1].startsWith('/') ? path.join(mini, match[1].slice(1)) : path.resolve(path.dirname(file), match[1]);
        if (!fs.existsSync(asset)) errors.push(relative + ': missing asset ' + match[1]);
      }
    }
  }
}
walk(mini);
if (errors.length) { errors.forEach(message => console.error(message)); process.exitCode = 1; }
else console.log('Project checks passed: ' + routes.length + ' routes, JSON/JS syntax, events, assets, tabBar and package imports.');
