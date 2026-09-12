import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

const files = [
  'src/App.jsx',
  'src/main.jsx',
  'src/storage.js',
  'worker/index.js',
  'worker/ai-guard.js'
];

for (const file of files) {
  const code = fs.readFileSync(path.resolve(file), 'utf8');
  parse(code, {
    sourceType: 'module',
    plugins: file.endsWith('.jsx') ? ['jsx'] : []
  });
  console.log(`ok  ${file}`);
}
