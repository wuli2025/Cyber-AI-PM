import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function startBridge() {
  console.log('[Wrapper] Starting bridge...');
  const bridge = spawn('node', ['bridge.js'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true
  });

  bridge.on('exit', (code) => {
    console.log(`[Wrapper] Bridge exited with code ${code}, restarting in 3s...`);
    setTimeout(startBridge, 3000);
  });

  bridge.on('error', (err) => {
    console.error('[Wrapper] Bridge error:', err.message);
  });
}

startBridge();
