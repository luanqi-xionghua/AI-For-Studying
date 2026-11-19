// The desktop process supplies a per-launch secret in the fragment (never in HTTP logs).
const match = /^#desktop=([a-zA-Z0-9_-]{40,100})$/.exec(location.hash)
if (match) { sessionStorage.setItem('kaizhi:desktop', match[1]); history.replaceState(null, '', location.pathname) }
const token = sessionStorage.getItem('kaizhi:desktop') || ''
export const isPythonDesktop = !!token
if (token) Object.defineProperty(globalThis, '__KAIZHI_PYTHON__', {value:true})

let connecting: Promise<WebSocket> | undefined
const channels = new Map<string, Channel<any>>()
const requests = new Map<string,string>()
export class Channel<T = unknown> {
  readonly id = crypto.randomUUID()
  onmessage: (value:T)=>void = ()=>{}
}
function events(): Promise<WebSocket> {
  return connecting ||= new Promise((resolve,reject)=>{
    const ws=new WebSocket(`ws://${location.host}/events`)
    ws.onopen=()=>ws.send(token)
    ws.onmessage=e=>{
      const {channel,event,ready}=JSON.parse(e.data)
      if(ready) { resolve(ws); return }
      channels.get(channel)?.onmessage(event)
      if(['end','error'].includes(event?.type)||event?.event==='disconnect') forget(channel)
    }
    ws.onerror=()=>reject(new Error('无法连接本机 Python 后端'))
    ws.onclose=()=>{connecting=undefined; reject(new Error('本机连接已关闭')); for(const [id,ch] of channels){ch.onmessage({type:'error',event:'disconnect',message:'本机连接已关闭',error:'本机连接已关闭'}); forget(id)}}
  })
}
function forget(id:string|undefined){ if(!id)return; channels.delete(id); for(const m of [requests]) for(const [key,v] of m) if(v===id)m.delete(key) }
export async function invoke<T=unknown>(cmd:string,args:Record<string,any>={}):Promise<T>{
  if(!token)throw new Error('此操作需要桌面版')
  const payload={...args}; const ch=payload.channel||payload.onProgress
  if(ch instanceof Channel){await events();channels.set(ch.id,ch); if(payload.channel) payload.channel=ch.id; else payload.onProgress=ch.id; if(cmd==='ai_start') requests.set(payload.id,ch.id)}
  try {
    const r=await fetch(`/api/${cmd}`,{method:'POST',headers:{'Content-Type':'application/json','X-Kaizhi-Token':token},body:JSON.stringify(payload),cache:'no-store',redirect:'error'})
    if(!r.ok)throw new Error((await r.json()).error || `HTTP ${r.status}`)
    if(r.headers.get('Content-Type')?.startsWith('application/octet-stream')) return await r.arrayBuffer() as T
    const value=await r.json()
    return value as T
  } catch(e){forget(ch?.id);throw e}
  finally{if(cmd==='ai_cancel')forget(requests.get(payload.id)); if(cmd==='update_download'||cmd==='import_documents')forget(ch?.id)}
}
export const open=(options:{multiple?:boolean;title?:string}={})=>invoke<string[]|string|null>('select_files',options)
function listen(name:string,fn:EventListener){window.addEventListener(name,fn);return Promise.resolve(()=>window.removeEventListener(name,fn))}
export function getCurrentWindow(){return {isFullscreen:()=>invoke<boolean>('is_fullscreen'),setFullscreen:(value:boolean)=>invoke('set_fullscreen',{value}),onResized:(cb:()=>void)=>listen('resize',cb),onFocusChanged:(cb:()=>void)=>listen('focus',cb)}}
export type NativeWindow = ReturnType<typeof getCurrentWindow>
type Drop={type:'enter'|'leave'|'drop';paths:string[]}
export function getCurrentWebview(){return {onDragDropEvent:(cb:(ev:{payload:Drop})=>void)=>listen('kaizhi:native-drop',(ev)=>cb({payload:(ev as CustomEvent<Drop>).detail}))}}
