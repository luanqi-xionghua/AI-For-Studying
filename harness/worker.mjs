import { createInterface } from 'node:readline'
import { run } from './runtime.mjs'
// Exactly one request per worker at a time. Never follow redirects with a user's credentials.
const transport=globalThis.fetch; let origin
const output = msg => process.stdout.write(`${JSON.stringify(msg)}\n`)
console.log = console.info = console.debug = ()=>{}
globalThis.fetch = (input,init) => {
  if (new URL(typeof input==='string'||input instanceof URL?input:input.url).origin !== origin) throw Error('禁止访问配置以外的服务地址。')
  return transport(input,{...init,redirect:'error'})
}
let busy=false, pending, sequence=0
for await (const line of createInterface({input:process.stdin,crlfDelay:Infinity})) {
  const msg=JSON.parse(line)
  if(msg.type==='tool-result') {
    if(pending && msg.ticket===pending.ticket){const done=pending.resolve; pending=null; done(msg.result)}
    continue
  }
  if(busy || msg.type!=='run') {process.exitCode=2; break}
  busy=true; origin=new URL(msg.job.baseUrl).origin
  const tool=(name,args)=>new Promise(resolve=>{const ticket=++sequence; pending={ticket,resolve}; output({type:'tool',ticket,name,args})})
  run(msg.job,output,tool,new AbortController().signal).then(value=>output({type:'end',value}),err=>{
    const message=String(err?.message || '模型请求失败').replaceAll(msg.job.apiKey,'[redacted]').slice(0,450)
    output({type:'error',message})
  }).finally(()=>{busy=false; origin=undefined; pending=null})
}
