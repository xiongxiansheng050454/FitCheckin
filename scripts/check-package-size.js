const fs = require('node:fs');
const path = require('node:path');
const MB = 1024 * 1024;
const HARD_PACKAGE = 2 * MB;
const HARD_TOTAL = 30 * MB;
const BUDGET_PACKAGE = 1.5 * MB;
const BUDGET_TOTAL = 6 * MB;

function ignored(relative, rules) {
  return rules.some(rule => {
    const value = String(rule.value || '').replace(/\\/g, '/').replace(/\/$/, '');
    if (rule.type === 'folder') return relative === value || relative.startsWith(value + '/');
    if (rule.type === 'file') return relative === value;
    if (rule.type === 'suffix') return relative.endsWith(value);
    if (rule.type === 'prefix') return relative.startsWith(value);
    if (rule.type === 'regexp') return new RegExp(value).test(relative);
    throw new Error('Unsupported packOptions ignore type: ' + rule.type);
  });
}
function analyze(projectPath) {
  const config = JSON.parse(fs.readFileSync(path.join(projectPath, 'project.config.json'), 'utf8'));
  const root = path.resolve(projectPath, config.miniprogramRoot || '.');
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const subpackages = app.subPackages || app.subpackages || [];
  const packages = [{ name: 'main', root: '', bytes: 0, files: 0 }].concat(subpackages.map(p => ({ name: p.name || p.root, root: p.root.replace(/\/$/, ''), bytes: 0, files: 0 })));
  const largest = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(root, file).replace(/\\/g, '/');
      if (ignored(relative, config.packOptions && config.packOptions.ignore || [])) continue;
      if (entry.isSymbolicLink()) throw new Error('Symlinks are not allowed in the code package: ' + relative);
      if (entry.isDirectory()) { visit(file); continue; }
      const bytes = fs.statSync(file).size;
      const target = packages.find(p => p.root && relative.startsWith(p.root + '/')) || packages[0];
      target.bytes += bytes; target.files += 1;
      largest.push({ path: relative, bytes, package: target.name });
    }
  }
  visit(root);
  const totalBytes = packages.reduce((sum, p) => sum + p.bytes, 0);
  const violations = packages.filter(p => p.bytes > HARD_PACKAGE).map(p => p.name + ' exceeds 2MB');
  if (totalBytes > HARD_TOTAL) violations.push('combined packages exceed 30MB');
  const warnings = packages.filter(p => p.bytes > BUDGET_PACKAGE).map(p => p.name + ' exceeds 1.5MB budget');
  if (totalBytes > BUDGET_TOTAL) warnings.push('combined packages exceed 6MB budget');
  return { basis: 'source files after packOptions.ignore; final authority is WeChat code package analysis', packages, totalBytes, limits: { packageBytes: HARD_PACKAGE, totalBytes: HARD_TOTAL }, warnings, violations, largest: largest.sort((a, b) => b.bytes - a.bytes).slice(0, 10) };
}
if (require.main === module) {
  const flag = process.argv.indexOf('--project');
  const project = flag >= 0 ? path.resolve(process.argv[flag + 1]) : path.resolve(__dirname, '..');
  try {
    const report = analyze(project);
    if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      console.log('IronPlan source package size (WeChat compilation must also be checked):');
      report.packages.forEach(p => console.log('  ' + p.name + ': ' + (p.bytes / 1024).toFixed(1) + 'KB, ' + p.files + ' files'));
      console.log('  total: ' + (report.totalBytes / 1024).toFixed(1) + 'KB');
      report.warnings.forEach(message => console.warn('BUDGET: ' + message));
      report.violations.forEach(message => console.error('BLOCKED: ' + message));
    }
    if (report.violations.length || (process.argv.includes('--strict-budget') && report.warnings.length)) process.exitCode = 1;
  } catch (err) { console.error(err.message); process.exitCode = 1; }
}
module.exports = { analyze, ignored };
