import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import pg from 'pg';
import {releaseStartupConnections} from '../schedule-database.js';
class Client extends EventEmitter {
 constructor(){super();this._queryable=true;this._ending=false;}
 connect(callback){queueMicrotask(()=>callback(null));}
 query(text,values,callback){if(typeof values==='function')callback=values;queueMicrotask(()=>callback(null,{rows:[{ok:1}]}));}
 end(callback){this._ending=true;queueMicrotask(()=>{this.emit('end');callback?.();});}
}
test('startup cleanup frees idle pg sessions and preserves the pool and checked-out clients',async()=>{
 const pool=new pg.Pool({Client,max:3,idleTimeoutMillis:2000});
 try {
  const clients=await Promise.all([pool.connect(),pool.connect(),pool.connect()]);
  clients[0].release();clients[1].release();
  assert.equal(pool.idleCount,2);
  await releaseStartupConnections(pool);
  assert.equal(pool.idleCount,0);assert.equal(pool.totalCount,1);
  assert.equal(clients[2]._ending,false);
  clients[2].release();await releaseStartupConnections(pool);
  assert.equal(pool.totalCount,0);
  assert.deepEqual((await pool.query('SELECT 1')).rows,[{ok:1}]);
  await releaseStartupConnections(pool);assert.equal(pool.totalCount,0);
  await releaseStartupConnections(null);
 }finally{await pool.end();}
});
