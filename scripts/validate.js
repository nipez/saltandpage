import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

const files = [
  'src/App.jsx',
  'src/main.jsx',
  'src/storage.js',
  'src/ai.js',
  'src/AuthUI.jsx',
  'src/SyncBootstrap.jsx',
  'src/sync-api.js',
  'src/sync-bridge.js',
  'worker/index.js',
  'worker/ai-guard.js',
  'worker/auth.js',
  'worker/sync.js'
];

for (const file of files) {
  const code = fs.readFileSync(path.resolve(file), 'utf8');
  parse(code, {
    sourceType: 'module',
    plugins: file.endsWith('.jsx') ? ['jsx'] : []
  });
  console.log(`ok  ${file}`);
}
