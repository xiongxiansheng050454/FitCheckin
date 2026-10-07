const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const flag = process.argv.indexOf('--devtools');
const explicit = flag >= 0 ? process.argv[flag + 1] : process.env.WECHAT_DEVTOOLS_ROOT;
const candidates = explicit ? [explicit] : (process.env.PATH || '').split(path.delimiter);
const binaryRoot = candidates.map(dir => path.join(dir, 'resources/app.asar.unpacked/node_modules/wcc-exec')).find(dir => fs.existsSync(path.join(dir, 'wcc.exe')));
if (!binaryRoot) {
  console.error('WeChat native compilers not found. Pass --devtools <WeChat Developer Tools installation directory>.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
const mini = path.resolve(root, config.miniprogramRoot);
const app = JSON.parse(fs.readFileSync(path.join(mini, 'app.json'), 'utf8'));
const routes = app.pages.concat((app.subPackages || []).flatMap(p => p.pages.map(page => p.root + '/' + page)));
if (app.tabBar && app.tabBar.custom) routes.push('custom-tab-bar/index');
for (let i = 0; i < routes.length; i++) {
  const route = routes[i], json = JSON.parse(fs.readFileSync(path.join(mini, route + '.json'), 'utf8'));
  for (const component of Object.values(json.usingComponents || {})) {
    if (/^(plugin|dynamicLib):/.test(component)) continue;
    const target = (component.startsWith('/') ? component.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(route), component)));
    if (!routes.includes(target)) routes.push(target);
  }
}
let failed = false;
for (const kind of ['wxml', 'wxss']) {
  const files = routes.map(route => route + '.' + kind);
  if (kind === 'wxss') files.unshift('app.wxss');
  const compiler = path.join(binaryRoot, kind === 'wxml' ? 'wcc.exe' : 'wcsc.exe');
  const result = spawnSync(compiler, files, { cwd: mini, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: 60000 });
  if (result.error || result.status !== 0) {
    console.error(kind + ' compilation failed: ' + (result.error ? result.error.message : result.stderr || result.stdout));
    failed = true;
  } else {
    console.log('Native ' + kind.toUpperCase() + ' compilation passed: ' + files.length + ' files.');
    if (result.stderr) console.log(result.stderr.trim());
  }
}
if (failed) process.exitCode = 1;
