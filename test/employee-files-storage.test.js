import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {employeeFilesStorage} from '../employee-files-storage.js';

const config={EMPLOYEE_FILES_DATABASE_URL:'postgresql://postgres.fiction@pooler.example.test:5432/postgres?sslmode=no-verify',EMPLOYEE_FILES_DATABASE_PASSWORD:'fictif:@/#%+',EMPLOYEE_FILES_REGION:'ca-central-1',EMPLOYEE_FILES_HOSTING_REVIEWED:'no'};

test('connexion seule : TLS obligatoire, aucune table ni dossier lu ou créé, pool fermé',async t=>{
 let options,ended=false;const queries=[];
 t.mock.method(pg,'Pool',function(o){options=o;return {on(){},async query(sql){queries.push(sql);return {rows:[{connected:1,search_path:'employee_files_private'}]};},async end(){ended=true;}};});
 const result=await employeeFilesStorage(config);
 assert.equal(result.pool,null);assert.equal(result.status.ready,false);assert.equal(result.status.connected,true);assert.equal(result.status.reason,'hosting_review');
 assert.deepEqual(queries,["SELECT 1 AS connected, current_setting('search_path') AS search_path"]);assert.equal(ended,true);
 assert.equal(options.ssl.rejectUnauthorized,true);const url=new URL(options.connectionString);
 assert.equal(url.searchParams.has('sslmode'),false);assert.equal(decodeURIComponent(url.password),config.EMPLOYEE_FILES_DATABASE_PASSWORD);
 assert.equal(options.options,'-c search_path=employee_files_private');
 assert.ok(!JSON.stringify(result).includes(config.EMPLOYEE_FILES_DATABASE_PASSWORD));
});

for(const [code,expected] of [['28P01','authentication'],['SELF_SIGNED_CERT_IN_CHAIN','tls'],['ECONNREFUSED','connection']])test('échec fermé et diagnostic sans secret : '+code,async t=>{
 let ended=false;t.mock.method(pg,'Pool',function(){return {on(){},async query(){throw Object.assign(Error('secret-dans-erreur'),{code});},async end(){ended=true;}};});
 const result=await employeeFilesStorage(config);assert.equal(result.pool,null);assert.equal(result.status.ready,false);assert.equal(result.status.connected,false);assert.equal(result.status.reason,expected);assert.equal(ended,true);assert.ok(!JSON.stringify(result).includes('secret-dans-erreur'));
});

test('un pooler qui perd le search_path ne permet pas la collecte',async t=>{
 t.mock.method(pg,'Pool',function(){return {on(){},async query(){return {rows:[{connected:1,search_path:'public'}]};},async end(){}};});
 const result=await employeeFilesStorage(config);assert.equal(result.pool,null);assert.equal(result.status.connected,false);
});
