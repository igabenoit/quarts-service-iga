import {createPublicKey,verify} from 'node:crypto';
const issuer=process.env.CASH_ORDER_ACCESS_ISSUER;
const audience=process.env.CASH_ORDER_ACCESS_AUD;
const depotOrigin=process.env.CASH_ORDER_DEPOT_ORIGIN;
let cache;
export async function verifyDepotToken(token){
 if(!issuer||!audience||!depotOrigin||typeof token!=='string'||token.length>16000)throw Error('Token');
 const parts=token.split('.');if(parts.length!==3)throw Error('Token');
 const head=JSON.parse(Buffer.from(parts[0],'base64url')),body=JSON.parse(Buffer.from(parts[1],'base64url'));
 const now=Date.now()/1000;
 if(head.alg!=='RS256'||body.iss!==issuer||!Array.isArray(body.aud)||!body.aud.includes(audience)||!Number.isFinite(body.exp)||body.exp<=now||body.nbf>now+30||!body.email)throw Error('Claims');
 if(!cache||cache.until<Date.now()){
  const r=await fetch(issuer+'/cdn-cgi/access/certs',{signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error('Keys');
  cache={keys:(await r.json()).keys,until:Date.now()+300000};
 }
 const jwk=cache.keys.find(k=>k.kid===head.kid);if(!jwk||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw Error('Signature');
 return body.email;
}
export function cashAccess(auth,origin){
 return async(req,res,next)=>{
  if(!req.path.startsWith('/api/depot/'))return auth(req,res,()=>req.method==='POST'?origin(req,res,next):next());
  try{
   if(req.method==='POST'&&req.get('Origin')!==depotOrigin)return res.sendStatus(403);
   const email=await verifyDepotToken(req.get('Cf-Access-Jwt-Assertion'));
   const allowed=(process.env.CASH_ORDER_DEPOT_EMAILS||process.env.CASH_ORDER_TEST_EMAIL||'').toLowerCase().split(',').map(v=>v.trim());
   if(!allowed.includes(email.toLowerCase()))return res.sendStatus(403);
   req.manager={kind:'admin'};next();
  }catch{res.status(401).json({error:'Reconnecte-toi à Dépôt IGA.'});}
 };
}
