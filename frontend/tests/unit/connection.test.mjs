import {test,afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {harnessBridge,runHarness} from '../../src/ai/harness.mjs'
import {listModels,testConnection} from '../../src/ai/connection.mjs'
import {streamDocumentChat} from '../../src/ai/document-chat.mjs'
const original=harnessBridge.load;afterEach(()=>{harnessBridge.load=original})
function bridge(fn){ const calls=[];harnessBridge.load=async()=>({Channel:class{},invoke:async(cmd,p)=>{calls.push([cmd,p]);return fn(cmd,p)}});return calls }
const opts={provider:'custom',protocol:'responses',model:'fake',baseUrl:'http://localhost:12345/v1',messages:[{role:'user',content:'Q'}]}
test('settings discovery and ping both go through Harness',async()=>{
 const calls=bridge((cmd,{channel,request})=>channel.onmessage({type:'end',value:request.kind==='models'?{models:[{id:'m'},{id:'embedding-x'}],hidden:0}:{}}));
 assert.deepEqual(await listModels(opts),{models:[{id:'m'}],hidden:1});assert.equal((await testConnection(opts)).note,'DeepSeek Harness');assert.deepEqual(calls.map(([c,p])=>[c,p.request.protocol,p.request.kind]),[['ai_start','responses','models'],['ai_start','responses','ping']]);
})
test('document tool callback is validated and bound to this question; evidence reaches the worker',async()=>{
 let ch;const seen=[];bridge((cmd,p)=>{if(cmd==='ai_start'){ch=p.channel;assert.match(p.request.messages.at(-1).content,/附近内容/);queueMicrotask(()=>ch.onmessage({type:'tool',ticket:9,name:'pdf_info',args:{outline_offset:0}}))}else if(cmd==='ai_tool_result'){assert.equal(p.ticket,9);assert.equal(p.result.evidence[0].sourceId,'S1');ch.onmessage({type:'text-delta',text:'[S1]'});ch.onmessage({type:'end'})}});
 await streamDocumentChat({...opts,onDelta:v=>seen.push(v)},{tool:async n=>{assert.equal(n,'pdf_info');return {evidence:[{sourceId:'S1'}]}}},{info:{pages:2},limits:{}});assert.deepEqual(seen,['[S1]']);
})
test('aborting during registration cancels after startup, never before',async()=>{
 let registered,started;const ready=new Promise(r=>started=r);const calls=bridge((cmd,p)=>{if(cmd==='ai_start'){started();return new Promise(r=>registered=r)}});
 const c=new AbortController();const pending=runHarness(opts,{signal:c.signal});await ready;c.abort();registered();await assert.rejects(pending,/abort/i);await new Promise(r=>setImmediate(r));assert.deepEqual(calls.map(([c])=>c),['ai_start','ai_cancel']);
})
