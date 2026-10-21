import {readdirSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// Include shared browser modules imported by the server, not a hand-maintained list.
const root=fileURLToPath(new URL('../',import.meta.url));
const files=[];
function collect(directory){
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    if(entry.name.startsWith('.')||entry.name==='node_modules')continue;
    const path=join(directory,entry.name);
    if(entry.isDirectory())collect(path);
    else if(/\.(?:js|mjs)$/.test(entry.name))files.push(path);
  }
}
collect(root);
for(const file of files.sort()){
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.error||result.status!==0){
    console.error('Syntax check failed: '+relative(root,file));
    console.error(result.stderr||result.error?.message||'Unknown syntax check failure');
    process.exit(1);
  }
}
console.log(`Syntax checked: ${files.length} JavaScript files.`);
