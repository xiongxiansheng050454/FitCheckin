const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const toolsRoot = path.join(process.env.USERPROFILE, '.codex/tools/cloudbase-mcp');
const localRequire = createRequire(path.join(toolsRoot, 'package.json'));
const toml = localRequire('smol-toml');
if (process.stdin.isTTY) process.stdin.setRawMode(true);
const input = readline.createInterface({ input: process.stdin });
input.once('line', line => {
  try {
    let { apiKey, environment } = JSON.parse(line);
    const shell = path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe');
    if (!apiKey) {
      const existing = spawnSync(shell, ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('CLOUDBASE_API_KEY', 'User')"], { encoding: 'utf8', windowsHide: true });
      if (existing.status !== 0 || !existing.stdout.trim()) throw new Error('User environment credential unavailable');
      apiKey = existing.stdout.trim();
    }
    const claims = JSON.parse(Buffer.from(apiKey.split('.')[1], 'base64url').toString('utf8'));
    if (claims.aud !== environment || environment !== 'weixing2-d7g2j6asyc5132905') throw new Error('Credential environment mismatch');
    const configPath = path.join(process.env.USERPROFILE, '.codex/config.toml');
    const source = fs.readFileSync(configPath, 'utf8');
    const config = toml.parse(source);
    if (!config.mcp_servers || !config.mcp_servers.cloudbase) throw new Error('Existing CloudBase configuration not found');
    const cli = path.join(toolsRoot, 'node_modules/@cloudbase/cloudbase-mcp/dist/cli.cjs').replace(/\\/g, '/');
    if (!fs.existsSync(cli)) throw new Error('Local CloudBase MCP not installed');
    const launcher = path.join(toolsRoot, 'launch.cjs').replace(/\\/g, '/');
    const launcherSource = "const { spawn, spawnSync } = require('node:child_process');\nconst path = require('node:path');\nconst shell = " + JSON.stringify(shell) + ";\nconst credential = spawnSync(shell, ['-NoProfile', '-Command', \"[Environment]::GetEnvironmentVariable('CLOUDBASE_API_KEY', 'User')\"], { encoding: 'utf8', windowsHide: true });\nif (credential.status !== 0 || !credential.stdout.trim()) throw new Error('CloudBase management credential unavailable');\nconst child = spawn(process.execPath, [path.join(__dirname, 'node_modules/@cloudbase/cloudbase-mcp/dist/cli.cjs')], { stdio: 'inherit', env: Object.assign({}, process.env, { CLOUDBASE_API_KEY: credential.stdout.trim() }), windowsHide: true });\nchild.on('error', () => { console.error('CloudBase MCP could not start'); process.exitCode = 1; });\nchild.on('exit', code => { process.exitCode = code == null ? 1 : code; });\n";
    const section = '[mcp_servers.cloudbase]\ncommand = ' + JSON.stringify(process.execPath.replace(/\\/g, '/')) + '\nargs = [' + JSON.stringify(launcher) + ']\nenv_vars = ["CLOUDBASE_API_KEY"]\n\n[mcp_servers.cloudbase.env]\nCLOUDBASE_ENV_ID = ' + JSON.stringify(environment) + '\nTCB_SITE = "domestic"\nTCB_REGION = "ap-shanghai"\nCLOUDBASE_MCP_TELEMETRY_DISABLED = "true"\n\n';
    const pattern = /^\[mcp_servers\.cloudbase(?:\.[^\]]+)?\][\s\S]*?(?=^\[(?!mcp_servers\.cloudbase(?:\.|\]))|$(?![\s\S]))/m;
    const next = source.replace(pattern, section);
    const parsed = toml.parse(next);
    if (parsed.mcp_servers.cloudbase.env.CLOUDBASE_ENV_ID !== environment || parsed.mcp_servers.cloudbase.url) throw new Error('Configuration validation failed');
    const saved = spawnSync(shell, ['-NoProfile', '-Command', "$credentialText = [Console]::In.ReadLine(); [Environment]::SetEnvironmentVariable('CLOUDBASE_API_KEY', $credentialText, 'User')"], { input: apiKey + '\n', encoding: 'utf8', windowsHide: true });
    if (saved.error || saved.status !== 0) throw new Error('Could not save user environment credential');
    fs.writeFileSync(launcher, launcherSource);
    fs.writeFileSync(configPath, next);
    console.log(JSON.stringify({ configured: true, environment, configPath, credential: 'Windows user environment variable; omitted from config/project' }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { input.close(); if (process.stdin.isTTY) process.stdin.setRawMode(false); process.stdin.pause(); }
});
