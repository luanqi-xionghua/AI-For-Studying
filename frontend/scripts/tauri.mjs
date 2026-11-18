// 运行 Tauri CLI，并告诉它前后端分别在哪个目录。
//
// 仓库采用 frontend/ + backend/ 并列的结构，不再使用 Tauri 默认的 src-tauri/ 子目录，
// 所以这里通过 Tauri CLI 支持的两个环境变量指定位置：
//   TAURI_APP_PATH      → ../backend   （tauri.conf.json、Cargo.toml 所在目录）
//   TAURI_FRONTEND_PATH → .            （package.json 所在目录，beforeDev/BuildCommand 在这里执行）
// 已手动设置的环境变量优先。
//
// 用法（在 frontend/ 下）：npm run tauri -- <命令>，例如 npm run desktop:dev / npm run desktop:build
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const frontend = resolve(import.meta.dirname, '..');
const backend = resolve(frontend, '../backend');
const cli = createRequire(import.meta.url).resolve('@tauri-apps/cli/tauri.js');

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    TAURI_APP_PATH: process.env.TAURI_APP_PATH || backend,
    TAURI_FRONTEND_PATH: process.env.TAURI_FRONTEND_PATH || frontend,
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
