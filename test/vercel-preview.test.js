import test from 'node:test';
import assert from 'node:assert/strict';
import {schedulePoolConfig,verifyPreviewDatabase} from '../schedule-database.js';

const ref='abcdefghijklmnopqrst';
const env={VERCEL:'1',VERCEL_ENV:'preview',QUART_PREVIEW_PROJECT_REF:ref,QUART_PREVIEW_SCHEMA:'quart_test',
  QUART_PREVIEW_DB_ROLE:'quart_rehearsal',DATABASE_URL:'postgresql://quart_rehearsal@db.'+ref+'.supabase.co/postgres?sslmode=disable'};

test('Vercel ouvre uniquement le projet, le rôle et le schéma attendus, avec vérification TLS', async()=>{
  for(const address of [env.DATABASE_URL,'postgresql://quart_rehearsal.'+ref+'@aws-0-ca-central-1.pooler.supabase.com:5432/postgres']){
    const config=schedulePoolConfig({...env,DATABASE_URL:address});
    const url=new URL(config.connectionString);
    assert.equal(url.searchParams.get('options'),'-c search_path=quart_test');
    assert.equal(url.searchParams.has('sslmode'),false);
    assert.equal(config.ssl.rejectUnauthorized,true);
    assert.match(config.ssl.ca,/BEGIN CERTIFICATE/);
  }
  for(const mismatch of [{QUART_PREVIEW_SCHEMA:'public'},{VERCEL_ENV:'production'},{QUART_PREVIEW_SCHEMA:''},
    {QUART_PREVIEW_DB_ROLE:'another'},{QUART_PREVIEW_PROJECT_REF:'z'.repeat(20)}]){
    assert.throws(()=>schedulePoolConfig({...env,...mismatch}));
  }
  const pool={query:async()=>({rows:[{schema:'public',role:'quart_rehearsal'}]})};
  await assert.rejects(verifyPreviewDatabase(pool,env),/Schéma/);
});
