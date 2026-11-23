import { execSync } from 'child_process';

process.chdir('d:/1-Perfecto/flatzy-telegram-bot');
execSync('git add -A');
try {
  execSync('git commit -m "cleanup: remove HF space files"');
} catch (e) {}

console.log('Git remotes:');
console.log(execSync('git remote -v', { encoding: 'utf8' }));

console.log('Git status:');
console.log(execSync('git status', { encoding: 'utf8' }));
