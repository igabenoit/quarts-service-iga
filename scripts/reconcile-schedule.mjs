import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import pg from 'pg';
import {renderScheduleConnection,verifyRenderScheduleConnection} from '../render-schedule-database.js';

const quote = value => '"' + value.replaceAll('"','""') + '"';

async function readManifest() {
  const connection=renderScheduleConnection(process.env);
  const schema=connection.schema || 'public';
  const client=new pg.Client(connection.config);
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await verifyRenderScheduleConnection(client,connection);
    await client.query('SET LOCAL row_security TO off');
    await client.query("SET LOCAL timezone TO 'UTC'");
    await client.query("SET LOCAL datestyle TO 'ISO, YMD'");
    await client.query("SET LOCAL bytea_output TO 'hex'");
    await client.query("SET LOCAL extra_float_digits TO 3");
    await client.query("SET LOCAL intervalstyle TO 'postgres'");
    const {rows:relations}=await client.query(`SELECT c.relname AS name,c.relkind AS kind
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relkind IN ('r','S','p') ORDER BY c.relname COLLATE "C"`,[schema]);
    const tables={},sequences={};
    if(!relations.some(r=>r.name==='schedule_shifts')) throw Error('Schéma des horaires introuvable.');
    for(const {name,kind} of relations){
      const table=quote(schema)+'.'+quote(name);
      if(kind==='S'){
        sequences[name]=(await client.query('SELECT last_value::text,is_called FROM '+table)).rows[0];
        continue;
      }
      const hash=createHash('sha256');
      let count=0;
      // Only hashes leave PostgreSQL. Sorting fixed-length bytes preserves duplicates and ignores row order.
      await client.query(`DECLARE quart_rows NO SCROLL CURSOR FOR
        SELECT sha256(convert_to(to_jsonb(t)::text,'UTF8')) AS digest FROM ONLY ${table} t ORDER BY 1`);
      for(;;){
        const {rows}=await client.query('FETCH FORWARD 1024 FROM quart_rows');
        count+=rows.length;
        for(const {digest} of rows) hash.update(digest);
        if(rows.length<1024) break;
      }
      await client.query('CLOSE quart_rows');
      tables[name]={rows:count,sha256:hash.digest('hex')};
    }
    await client.query('COMMIT');
    return {format:1,tables,sequences};
  } finally {
    await client.end();
  }
}

function compare(left,right){
  if(left.format!==1 || right.format!==1) throw Error('Format de rapport incompatible.');
  const mismatches=[];
  for(const group of ['tables','sequences']){
    if(!left[group] || !right[group]) throw Error('Rapport incomplet.');
    const names=new Set([...Object.keys(left[group]),...Object.keys(right[group])]);
    for(const name of names){
      if(!isDeepStrictEqual(left[group][name],right[group][name])) mismatches.push(group+'.'+name);
    }
  }
  if(mismatches.length) throw Error('Écarts à examiner : '+mismatches.join(', '));
  return {identical:true,tables:Object.keys(left.tables).length,sequences:Object.keys(left.sequences).length};
}

try{
  const args=process.argv.slice(2);
  let result;
  if(args.length===0) result=await readManifest();
  else if(args.length===3 && args[0]==='--compare'){
    result=compare(...args.slice(1).map(file=>JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''))));
  }else throw Error('Utilisation : node scripts/reconcile-schedule.mjs [--compare source.json cible.json]');
  console.log(JSON.stringify(result,null,2));
}catch(error){
  console.error(error.code || (error instanceof Error && !error.message.includes('://') ? error.message : 'Erreur de rapprochement.'));
  process.exitCode=1;
}
