import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const args=process.argv.includes('--test')?['-m','unittest','discover','-s','backend/tests','-t','.','-v']:['backend/main.py'];
const child=spawnSync(resolve(root,'.venv/Scripts/python.exe'),args,{cwd:root,stdio:'inherit'});
if(child.error) console.error(child.error.message);
process.exitCode=child.status??1;
