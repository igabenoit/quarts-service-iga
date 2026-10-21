// Test process only: real PostgreSQL engine on disk, with pg's Pool interface.
// Never imported by the application; no production database or provider credentials.
import {EventEmitter} from 'node:events';
import pg from 'pg';
import {PGlite} from '@electric-sql/pglite';
if(!process.env.TEST_STARTUP_DB||process.env.NODE_ENV!=='test')throw Error('Isolated test environment required');
class TestPool extends EventEmitter{
  constructor(){super();this.db=new PGlite(process.env.TEST_STARTUP_DB);this.waiting=Promise.resolve();}
  async connect(){
    const previous=this.waiting;let unlock;
    this.waiting=new Promise(resolve=>unlock=resolve);await previous;
    let released=false;
    return {query:async(sql,args)=>{
      if(typeof sql==='object'){args=sql.values;sql=sql.text;}
      const result=args?await this.db.query(sql,args):(await this.db.exec(sql)).at(-1)||{rows:[]};
      return {...result,rowCount:result.rows.length||result.affectedRows||0};
    },release(){if(!released){released=true;unlock();}}};
  }
  async query(sql,args){const client=await this.connect();try{return await client.query(sql,args);}finally{client.release();}}
  async end(){await this.waiting;await this.db.close();}
}
pg.Pool=TestPool;
await import('../start.js');
