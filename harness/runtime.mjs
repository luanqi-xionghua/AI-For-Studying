/** Reader-only DeepSeek Harness composition. No agent shell, disk, session log or telemetry plugins. */
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { BlockAssembler, createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { imageSize } from 'image-size'
import { createHash } from 'node:crypto'

const text = value => ({ type: 'text', text: value })
const APIS = { chat: 'openai-completions', responses: 'openai-responses', anthropic: 'anthropic-messages' }
const NAMES = new Set(['pdf_info', 'pdf_read', 'pdf_search', 'pdf_view'])
const bound = (n, max) => Number.isInteger(n) ? Math.max(0, Math.min(n, max)) : 0
const off = effort => effort === 'none' ? 'off' : effort

export async function run(job, emit, tool, signal) {
  const { provider, model, apiKey, baseUrl, protocol, vision, effort } = job
  const api = APIS[protocol]
  if (!api || !apiKey || !model) throw Error('请配置模型、协议和 API Key。')
  const endpoint = new URL(baseUrl)
  if (api === 'anthropic-messages') endpoint.pathname = endpoint.pathname.replace(/\/v1\/?$/, '/')
  const route = 'kaizhi-api' // no provider ambient login or catalog-based URL overrides
  const source = { provider: route, model }
  const level = off(effort)
  // A Harness reasoning profile must offer a thinking level even for an off request.
  const reasoningEfforts = level === 'off' ? { off: protocol === 'responses' ? 'none' : null, high: 'high' } : { [level]: level }
  const compat = protocol === 'chat' && ['deepseek','glm','qwen','kimi'].includes(provider) ? {
    maxTokensField: 'max_tokens', supportsStore: false, supportsDeveloperRole: false,
    ...(provider === 'deepseek' ? { thinkingFormat: 'deepseek' } : {}),
    ...(provider === 'glm' ? { thinkingFormat: 'zai', supportsReasoningEffort: false } : {}),
  } : undefined
  const profile = { api, baseURL: endpoint.href.replace(/\/$/, ''), apiKeyEnv: 'KAIZHI_REQUEST_KEY', defaultMaxTokens: 4096,
    models: [{ id: model, input: vision ? ['text','image'] : ['text'], ...(level ? { reasoningEfforts } : {}) }],
    ...(compat ? { compat } : {}), retryPolicy: { mode: 'normal', maxRetries: 0 },
    requestImagePixelBudget: 16777216, requestImageMaxBytes: 4194304, maxRequestImageBytes: 16 * 1024 * 1024,
  }
  const ctx = new Context(), images = new Map()
  function image(url) {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(url)
    if (!match || url.length > 6*1024*1024) throw Error('截图格式或大小无效。')
    const data = Buffer.from(match[2], 'base64'), info = imageSize(data)
    if (!info.width || !info.height || info.width*info.height > 16777216 || info.type !== (match[1] === 'jpeg' ? 'jpg' : match[1])) throw Error('截图格式或尺寸无效。')
    const id = `sha256:${createHash('sha256').update(data).digest('hex')}`
    const ref = { attachmentId:id, bytes:data.length, mediaType:`image/${match[1]}`, width:info.width, height:info.height }
    images.set(id, { ...ref, attachment:ref, variantId:id, data })
    return { type:'image', attachment:ref }
  }
  try {
    ctx.provide('credentials', { resolve:async ref => ref === 'KAIZHI_REQUEST_KEY' ? {value:apiKey} : undefined, readRecord:async()=>undefined, listRecords:async()=>[] })
    ctx.provide('attachments', { imageHostPath:()=>undefined, readImageRequest:async ref => images.get(ref.attachmentId) })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(PiAi, { providers: { [route]: profile } })
    if (!ctx.llm.listProviders().some(p=>p.id===route)) throw Error('DeepSeek Harness 模型适配器未能加载。')
    if (job.kind === 'models') {
      const list = await ctx.llm.discoverModels('llm-pi-ai', { baseURL: profile.baseURL, api, apiKey }, signal)
      return {models:list.slice(0,1000).map(m=>({id:m.id,name:m.name||m.id})),hidden:Math.max(0,list.length-1000)}
    }
    const messages = job.messages.map(m=>{
      if (!vision && m.images?.length) throw Error('当前模型不支持图片输入。')
      const content = [text(m.content), ...(m.images||[]).map(image)]
      if (m.role==='assistant') return createAssistantMessage({content,source})
      return { role:m.role, content }
    })
    const tools = (job.tools || []).filter(t=>NAMES.has(t.name) && (vision || t.name!=='pdf_view'))
    let calls = bound(job.limits?.calls,60), views = bound(job.limits?.images,10), retained = 0
    const rounds = bound(job.limits?.rounds,60)
    for(let round=0; ; round++) {
      signal.throwIfAborted()
      const active = round < rounds && calls > 0 ? tools.filter(t=>t.name!=='pdf_view'||views>0) : []
      const a = new BlockAssembler()
      for await (const chunk of ctx.llm.stream({ ...source, messages, system:job.system, signal, ...(level?{reasoningEffort:level}:{}), ...(active.length?{tools:active}:{}), ...(job.kind==='ping'?{maxTokens:64}:{}) })) {
        a.push(chunk)
        if (chunk.type==='text-delta'||chunk.type==='reasoning-delta') emit({type:chunk.type,text:chunk.text})
        if (chunk.type==='usage' && chunk.usage.totalTokens > 0) emit({type:'usage',usage:{input:chunk.usage.inputTokens+(chunk.usage.cacheReadTokens||0)+(chunk.usage.cacheWriteTokens||0),output:chunk.usage.outputTokens}})
      }
      if (a.finish.kind==='error'||a.finish.kind==='aborted') throw Error(a.finish.failure.message || '模型请求失败。')
      const answer = a.message(source), requested = answer.content.filter(b=>b.type==='tool-call')
      if (!requested.length) return {}
      messages.push(answer)
      for(const call of requested) {
        if (!active.some(t=>t.name===call.name) || --calls<0 || (call.name==='pdf_view' && --views<0)) throw Error('模型超出本题的文档工具权限或预算。')
        const result = await tool(call.name,JSON.parse(call.arguments)), {dataUrl,...evidence} = result
        const json = JSON.stringify(evidence); retained += json.length + (dataUrl?.length || 0)
        if (retained>16*1024*1024) throw Error('文档工具返回内容过大。')
        messages.push(createToolResultMessage({callId:call.id,content:[text(json),...(dataUrl?[image(dataUrl)]:[])],isError:Boolean(result.error)}))
      }
    }
  } finally { await ctx.fiber.dispose() }
}
