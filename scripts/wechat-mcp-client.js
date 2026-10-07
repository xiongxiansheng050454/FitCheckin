const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

// Credentials are read from stdin and never persisted or printed.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
const input = readline.createInterface({ input: process.stdin });
input.once('line', async line => {
  input.close();
  const config = JSON.parse(line);
  const directory = config.devtoolsRoot || process.env.WECHAT_DEVTOOLS_ROOT;
  const excluded = ['node.exe', 'node-18.exe', 'wxfilewatcher.exe', 'wxfilewatcher_x64.exe', 'notification_helper.exe', 'wechatdevtools.exe'];
  const executable = fs.readdirSync(directory).map(name => path.join(directory, name)).find(file => file.toLowerCase().endsWith('.exe') && !excluded.includes(path.basename(file).toLowerCase()) && fs.statSync(file).size > 50000000);
  if (!executable) throw new Error('WeChat Electron runtime not found');
  const cli = path.join(directory, 'resources/app.asar.unpacked/js/common/cli/skill-index.js');
  const bootstrap = "const e=process.argv[1],a=process.argv.slice(2);process.argv=[process.execPath,e,'--electron'].concat(a);require(e)";
  const child = spawn(executable, ['-e', bootstrap, cli, 'mcp', '--token=' + config.token], { cwd: directory, env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', cwd: process.cwd() }), windowsHide: true });
  const pending = new Map(); let sequence = 0;
  const stream = readline.createInterface({ input: child.stdout });
  stream.on('line', output => {
    let message; try { message = JSON.parse(output); } catch (err) { return; }
    if (!pending.has(message.id)) return;
    const callbacks = pending.get(message.id); pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(JSON.stringify(message.error))); else callbacks.resolve(message.result);
  });
  child.stderr.on('data', () => {});
  child.on('error', err => { pending.forEach(callbacks => callbacks.reject(err)); });
  child.on('close', code => { pending.forEach(callbacks => callbacks.reject(new Error('MCP process exited: ' + code))); });
  const request = (method, params) => new Promise((resolve, reject) => { sequence += 1; pending.set(sequence, { resolve, reject }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: sequence, method, params }) + '\n'); });
  const timeout = setTimeout(() => { child.kill(); console.error('WeChat MCP request timed out'); process.exitCode = 1; }, 55000);
  try {
    await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'Codex', version: '1.0.0' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const calls = config.calls || [{ method: config.method || 'tools/list', params: config.params || {} }];
    for (const call of calls) {
      const result = await request(call.method || 'tools/call', call.params || {});
      if (result.tools && config.filter) result.tools = result.tools.filter(tool => new RegExp(config.filter).test(tool.name));
      const output = result.structuredContent || result;
      if (call.imageOutput) {
        const bitmap = output.result && (output.result.result || output.result);
        const destination = path.resolve(call.imageOutput);
        if (!destination.startsWith(process.cwd() + path.sep)) throw new Error('Image output must stay inside the project');
        if (!bitmap || typeof bitmap.base64 !== 'string') throw new Error('Image export did not return base64');
        const bytes = Buffer.from(bitmap.base64, 'base64');
        if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('Image export must be PNG');
        fs.writeFileSync(destination, bytes);
        console.log(JSON.stringify({ success: true, imagePath: destination, bytes: bytes.length }));
        continue;
      }
      console.log(JSON.stringify(output, (key, value) => {
        if (key === 'qrcode' || (value && value.type === 'Buffer')) return '[binary omitted]';
        if (key === 'text' && typeof value === 'string') {
          try { return JSON.parse(value); } catch (err) { return value; }
        }
        return value;
      }));
    }
  } catch (err) { console.error(err.message); process.exitCode = 1; }
  finally { clearTimeout(timeout); child.kill(); stream.close(); if (process.stdin.isTTY) process.stdin.setRawMode(false); process.stdin.pause(); }
});
