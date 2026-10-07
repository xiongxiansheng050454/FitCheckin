const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const toolsRoot = path.join(process.env.USERPROFILE, '.codex/tools/cloudbase-mcp');
const localRequire = createRequire(path.join(toolsRoot, 'package.json'));
const { parse } = localRequire('smol-toml');
if (process.stdin.isTTY) process.stdin.setRawMode(true);
const input = readline.createInterface({ input: process.stdin });
input.once('line', async line => {
  input.close();
  let child, stream, timeout;
  try {
    const config = JSON.parse(line);
    const server = parse(fs.readFileSync(path.join(process.env.USERPROFILE, '.codex/config.toml'), 'utf8')).mcp_servers.cloudbase;
    if (server.env.CLOUDBASE_ENV_ID !== 'weixing2-d7g2j6asyc5132905') throw new Error('Unexpected management environment');
    const shell = path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe');
    const credential = spawnSync(shell, ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('CLOUDBASE_API_KEY', 'User')"], { encoding: 'utf8', windowsHide: true });
    if (credential.status !== 0 || !credential.stdout.trim()) throw new Error('Management credential unavailable');
    const cli = path.join(toolsRoot, 'node_modules/@cloudbase/cloudbase-mcp/dist/cli.cjs');
    child = spawn(server.command, [cli], { cwd: process.cwd(), env: Object.assign({}, process.env, server.env, { CLOUDBASE_API_KEY: credential.stdout.trim() }), windowsHide: true });
    const pending = new Map(); let sequence = 0;
    stream = readline.createInterface({ input: child.stdout });
    stream.on('line', output => {
      let message; try { message = JSON.parse(output); } catch (error) { return; }
      if (!pending.has(message.id)) return;
      const callback = pending.get(message.id); pending.delete(message.id);
      if (message.error) callback.reject(new Error('MCP protocol error')); else callback.resolve(message.result);
    });
    child.stderr.on('data', () => {});
    child.on('error', () => pending.forEach(callback => callback.reject(new Error('Management process failed'))));
    child.on('close', () => pending.forEach(callback => callback.reject(new Error('Management process exited'))));
    const request = (method, params) => new Promise((resolve, reject) => { pending.set(++sequence, { resolve, reject }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: sequence, method, params }) + '\n'); });
    timeout = setTimeout(() => { child.kill(); pending.forEach(callback => callback.reject(new Error('Management request timeout'))); }, 55000);
    await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'Codex', version: '1.0.0' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    for (const call of config.calls || [{ method: 'tools/list', params: {} }]) {
      const result = await request(call.method || 'tools/call', call.params || {});
      if (result.tools && config.filter) result.tools = result.tools.filter(tool => new RegExp(config.filter).test(tool.name));
      console.log(JSON.stringify(result, (key, value) => {
        if (/^(secret(id|key)?|token|password|apiKey|authorization|credential|Value)$/i.test(key)) return '[redacted]';
        if (key === 'text' && typeof value === 'string') { try { return JSON.parse(value); } catch (error) {} }
        if (typeof value === 'string') return value.replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+/g, '[credential redacted]');
        return value;
      }));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { clearTimeout(timeout); if (child) child.kill(); if (stream) stream.close(); if (process.stdin.isTTY) process.stdin.setRawMode(false); process.stdin.pause(); }
});
