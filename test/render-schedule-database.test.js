import test from 'node:test';
import assert from 'node:assert/strict';
import {renderScheduleConnection,verifyRenderScheduleConnection} from '../render-schedule-database.js';

const project='abcdefghijklmnopqrst';
const expected={QUART_SUPABASE_PROJECT_REF:project,QUART_SUPABASE_DB_ROLE:'quart_app',QUART_SUPABASE_SCHEMA:'quart_service'};
const direct='postgresql://quart_app:demo@db.'+project+'.supabase.co/postgres';
const pooler='postgresql://quart_app.'+project+':demo@aws-0-ca-central-1.pooler.supabase.com:5432/postgres';

test('Render garde sa connexion existante quand Supabase est absent',async()=>{
  const DATABASE_URL='postgres://render.internal/app';
  const target=renderScheduleConnection({DATABASE_URL,NODE_ENV:'production'});
  assert.deepEqual(target.config,{max:5,connectionTimeoutMillis:3000,connectionString:DATABASE_URL,ssl:{rejectUnauthorized:false}});
  await verifyRenderScheduleConnection(null,target);
});
test('Supabase vérifie le certificat et limite le chemin au schéma prévu',async()=>{
  for(const url of [direct,pooler]){
    const target=renderScheduleConnection({...expected,DATABASE_URL:url+'?sslmode=disable&options=-csearch_path%3Dpublic'});
    assert.equal(target.config.ssl.rejectUnauthorized,true);
    assert.match(target.config.ssl.ca,/BEGIN CERTIFICATE/);
    assert.equal(new URL(target.config.connectionString).search,'');
    assert.equal(target.config.options,'-c search_path=quart_service');
    await verifyRenderScheduleConnection({query:async()=>({rows:[{role:'quart_app',schema:'quart_service'}]})},target);
    for(const db of [{schema:'public',role:'quart_app'},{schema:'quart_service',role:'other'}]){
      await assert.rejects(verifyRenderScheduleConnection({query:async()=>({rows:[db]})},target));
    }
  }
});
test('Une configuration partielle ou une cible différente bloque le démarrage',()=>{
  assert.throws(()=>renderScheduleConnection({DATABASE_URL:direct}));
  for(const overrides of [{DATABASE_URL:pooler.replace('5432','6543')},{DATABASE_URL:direct.replace('db.','elsewhere.')},
    {QUART_SUPABASE_DB_ROLE:'other'},{QUART_SUPABASE_SCHEMA:'public'},{QUART_SUPABASE_SCHEMA:'pg_catalog'},
    {QUART_SUPABASE_SCHEMA:'information_schema'},{QUART_SUPABASE_PROJECT_REF:'a'.repeat(20)}]){
    assert.throws(()=>renderScheduleConnection({...expected,DATABASE_URL:direct,...overrides}));
  }
});
