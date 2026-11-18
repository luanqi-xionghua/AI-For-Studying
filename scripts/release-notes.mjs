// 从 docs/CHANGELOG.md 摘出指定版本的更新说明，作为 GitHub Release 正文。
// 用法：node scripts/release-notes.mjs <版本号> [输出文件]
//   例：node scripts/release-notes.mjs 0.10.54 notes.md
// 找到「## 开智 <版本号>」一节，取到下一个同级标题为止，并把标题各升一级（与原先单独的 RELEASE_NOTES 文件一致）。
// 没有对应小节时以退出码 1 结束，发布流程会改用 GitHub 自动生成的说明。
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [version, output] = process.argv.slice(2);
if (!version) {
  console.error('用法：node scripts/release-notes.mjs <版本号> [输出文件]');
  process.exit(2);
}
const changelog = await readFile(resolve(import.meta.dirname, '../docs/CHANGELOG.md'), 'utf8');
const lines = changelog.replace(/\r\n/g, '\n').split('\n');
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const heading = new RegExp(`^## 开智 ${escaped}(\\s|$)`);
const start = lines.findIndex(line => heading.test(line));
if (start < 0) {
  console.error(`docs/CHANGELOG.md 中没有「## 开智 ${version}」一节。`);
  process.exit(1);
}
let end = lines.findIndex((line, index) => index > start && /^## /.test(line));
if (end < 0) end = lines.length;
const notes = lines.slice(start, end).map(line => line.replace(/^#(#+ )/, '$1')).join('\n').trim() + '\n';
if (output) await writeFile(output, notes);
else process.stdout.write(notes);
