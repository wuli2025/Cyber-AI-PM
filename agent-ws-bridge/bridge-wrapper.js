const { spawn } = require('child_process');
const path = require('path');

function startBridge() {
  console.log('[Wrapper] Starting bridge...');
  const bridge = spawn('node', ['bridge.js'], {
    cwd: __dirname,
    stdio: 'inherit'
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
