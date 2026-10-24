import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/service-chat-receipts.js',import.meta.url),'utf8').replaceAll('export function','function');
function fixture(manager=false){
  const events={},requests=[],errors=[];let time=10000,focused=true,user={key:manager?'admin':'employee:1',manager};
  const node=()=>({children:[],textContent:'',append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(name,fn){this[name]=fn;}});
  const context=vm.createContext({console,Date:class extends Date{static now(){return time;}},setInterval:fn=>{events.timer=fn;},
    document:{hidden:false,hasFocus:()=>focused,createElement:node,addEventListener:(name,fn)=>events[name]=fn},
    window:{innerHeight:800,innerWidth:400,addEventListener:(name,fn)=>events[name]=fn}
  });
  vm.runInContext(source+';globalThis.create=createReadReceipts;globalThis.visible=messageVisible;',context);
  const api=async(path,options)=>{
    requests.push({path,options});
    if(options)return {ok:true};
    return {messages:path.split('messageIds=')[1].split(',').map(id=>({id,viewers:[{name:'<img src=x> Camille',viewedAt:'2026-10-24T10:00:00Z'}]}))};
  };
  const controls=context.create({api,json:body=>({body}),getUser:()=>user,onError:error=>errors.push(error)});
  const article=(top=100,bottom=200)=>{
    const card=node();Object.assign(card,{isConnected:true,collapsed:false,rect:{top,bottom,left:10,right:380,width:370,height:bottom-top},container:{top:80,bottom:500,left:0,right:400},getBoundingClientRect(){return this.rect;},closest(selector){return selector.startsWith('details')?(this.collapsed?{}:null):{getBoundingClientRect:()=>this.container};}});return card;
  };
  return {context,controls,requests,events,errors,article,node,advance:ms=>time+=ms,focus:value=>focused=value,user:value=>user=value};
}

test('views require foreground, stable visible content, and the correct open conversation',async()=>{
  const f=fixture(),visible=f.article(),offscreen=f.article(850,950),collapsed=f.article(),privateMessage=f.article();collapsed.collapsed=true;
  f.controls.attach(visible,{id:'1',authorKey:'admin'});
  f.controls.attach(offscreen,{id:'2',authorKey:'admin'});
  f.controls.attach(collapsed,{id:'3',authorKey:'admin'});
  f.controls.attach(privateMessage,{id:'4',authorKey:'admin'},'private');
  const own=f.article();f.controls.attach(own,{id:'5',authorKey:'employee:1'});
  assert.equal(own.children.length,0,'ordinary employees have no receipt control');
  await f.controls.tick();assert.equal(f.requests.length,0);
  f.advance(2000);f.focus(false);await f.controls.tick();assert.equal(f.requests.length,0);
  f.focus(true);await f.controls.tick();f.advance(1200);f.context.document.hidden=true;await f.events.visibilitychange();assert.equal(f.requests.length,0);
  f.context.document.hidden=false;await f.controls.tick();f.advance(1200);f.events.scroll();await f.controls.tick();assert.equal(f.requests.length,0,'scrolling restarts the display interval');
  f.advance(1200);await f.controls.tick();
  assert.deepEqual(f.requests.map(r=>[r.path,Array.from(r.options.body.messageIds)]),[['/api/service-chat/views',['1']],['/api/service-chat/private/views',['4']]]);
  f.advance(6000);await f.controls.tick();assert.equal(f.requests.length,2,'one receipt per displayed message, with no employee read API');
  assert.equal(f.context.visible(offscreen),false);assert.equal(f.context.visible(collapsed),false);
  const clipped=f.article();clipped.container.bottom=120;assert.equal(f.context.visible(clipped),false,'a sliver in the scroll area is not a view');
  visible.isConnected=false;assert.equal(f.context.visible(visible),false);
});

test('manager sees receipts only under their own messages, as plain text, with polling and reset',async()=>{
  const f=fixture(true),own=f.article(),other=f.article(),privateMessage=f.article();
  f.controls.attach(own,{id:'7',authorKey:'admin'});
  f.controls.attach(other,{id:'8',authorKey:'manager:2'});
  f.controls.attach(privateMessage,{id:'9',authorKey:'admin'},'private');
  assert.equal(other.children.length,0);assert.equal(own.children[0].children[0].textContent,'Voir les consultations');
  await f.controls.tick();
  assert.equal(own.children[0].children[0].textContent,'Vu par <img src=x> Camille');
  assert.match(own.children[0].children[1].children[0].textContent,/<img src=x> Camille/);
  assert.deepEqual(f.requests.map(r=>r.path),['/api/service-chat/views?messageIds=7','/api/service-chat/private/views?messageIds=9']);
  f.advance(6000);await f.controls.tick();assert.equal(f.requests.filter(r=>!r.options).length,4);
  f.controls.reset();f.advance(6000);await f.controls.tick();assert.equal(f.requests.filter(r=>!r.options).length,4,'logout discards registered message elements');
});

test('a private message refresh preserves an expanded consultation list',async()=>{
  const f=fixture(true),first=f.article();
  f.controls.attach(first,{id:'1',authorKey:'admin'},'private');
  first.children[0].open=true;first.children[0].toggle();
  await new Promise(setImmediate);
  first.isConnected=false;
  const refreshed=f.article();f.controls.attach(refreshed,{id:'1',authorKey:'admin'},'private');
  assert.equal(refreshed.children[0].open,true);
  f.controls.reset();
  const freshSession=f.article();f.controls.attach(freshSession,{id:'1',authorKey:'admin'},'private');
  assert.equal(freshSession.children[0].open,false);
});
