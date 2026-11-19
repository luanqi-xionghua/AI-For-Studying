/** One authenticated renderer → Python contract for all Harness tasks. No provider HTTP here. */
export const harnessBridge = { load: () => import('../sdk/python') }
export async function runHarness(request, handlers={}) {
  const {signal,onDelta,onReasoning,onUsage,onTool}=handlers
  signal?.throwIfAborted()
  const {Channel,invoke} = await harnessBridge.load(), channel=new Channel(), id=crypto.randomUUID()
  signal?.throwIfAborted()
  let started, finish, fail, settled=false
  const done=new Promise((resolve,reject)=>{finish=resolve;fail=reject}); done.catch(()=>{})
  const cancel=()=>{ if(settled)return; settled=true; fail(signal?.reason || new Error('已停止')); void Promise.resolve(started).then(()=>invoke('ai_cancel',{id})).catch(()=>{}) }
  channel.onmessage=async e=>{
    if(settled)return
    try {
      if(e.type==='error')throw Error(e.message || 'Harness 连接中断')
      if(e.type==='text-delta')onDelta?.(e.text)
      if(e.type==='reasoning-delta')onReasoning?.(e.text)
      if(e.type==='usage')onUsage?.(e.usage)
      if(e.type==='end'){settled=true;finish(e.value);return}
      if(e.type==='tool'){
        let result
        try {if (!onTool)throw Error('本任务禁止文档工具');result=await onTool(e.name,e.args)} catch(err){result={error:String(err.message)}}
        if(!settled) await invoke('ai_tool_result',{id,ticket:e.ticket,result})
      }
    } catch(err){if(!settled){settled=true;fail(err);void Promise.resolve(started).then(()=>invoke('ai_cancel',{id})).catch(()=>{})}}
  }
  signal?.addEventListener('abort',cancel,{once:true})
  try { started=invoke('ai_start',{id,channel,request}); await started; return await done }
  finally { signal?.removeEventListener('abort',cancel) }
}
