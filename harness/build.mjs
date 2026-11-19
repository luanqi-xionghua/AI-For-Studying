// Freeze the exact locked Harness composition, not a user's global dsh installation.
import { build } from 'esbuild'
import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
process.chdir(fileURLToPath(new URL('.',import.meta.url)))
await mkdir('dist',{recursive:true})
const result=await build({metafile:true,absWorkingDir:process.cwd(),entryPoints:['worker.mjs'],outdir:'dist',entryNames:'bin/worker',chunkNames:'chunks/[name]-[hash]',outExtension:{'.js':'.mjs'},platform:'node',target:'node24',format:'esm',bundle:true,splitting:true,minify:true,banner:{js:"import { createRequire as __makeRequire } from 'node:module'; const require = __makeRequire(import.meta.url);"},legalComments:'eof'})
// dsh-llm reads ../package.json relative to its module for User-Agent attribution.
// Keep the official metadata and relative layout even outside the source checkout.
await copyFile('node_modules/@deepseek-ai/dsh-llm/package.json','dist/package.json')
await writeFile('dist/worker.mjs', "import './bin/worker.mjs'\n")
await copyFile(process.execPath,'dist/node.exe')

// Only modules actually included by esbuild need redistribution notices.
const {readdir,readFile}=await import('node:fs/promises')
const {dirname,join,resolve}=await import('node:path')

await mkdir('dist/licenses',{recursive:true})
try { await copyFile(process.env.KAIZHI_NODE_LICENSE || `licenses/node-${process.version}.txt`, 'dist/licenses/Node.txt') } catch { throw Error('Supply the LICENSE matching the packaging Node version via KAIZHI_NODE_LICENSE') }
const seen=new Set()
for(const input of Object.keys(result.metafile.inputs)){
  if(!input.includes('node_modules/'))continue
  let dir=dirname(resolve(input));let meta
  while(dir!==dirname(dir)){
    try{meta=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));if(meta.name)break}catch{}
    dir=dirname(dir)
  }
  if(!meta?.name || seen.has(dir))continue
  seen.add(dir)
  for(const file of await readdir(dir,{withFileTypes:true})){
    if(file.isFile() && /^(licen[cs]e|notice|copying)(?:[.-]|$)/i.test(file.name))await copyFile(join(dir,file.name),`dist/licenses/${meta.name.replace(/[/@]/g,'_')}-${file.name}`)
  }
}
