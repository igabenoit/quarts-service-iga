// Synthetic authenticator, test keys only. Uses real ES256 signatures, not a mocked verifier.
import crypto from 'node:crypto';
import {isoCBOR} from '@simplewebauthn/server/helpers';
const hash=b=>crypto.createHash('sha256').update(b).digest();
const b64=b=>Buffer.from(b).toString('base64url');
export function authenticator(){
  const {privateKey,publicKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'}),id=crypto.randomBytes(32);
  const cose=isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));
  let handle,counter=0;
  function data(type,options,origin,extra={}){return Buffer.from(JSON.stringify({type,challenge:options.challenge,origin,crossOrigin:false,...extra}));}
  return {
    id:b64(id),
    register(options,origin,{uv=true,rpID=options.rp.id,extra={}}={}){
      handle=options.user.id;const client=data('webauthn.create',options,origin,extra),length=Buffer.alloc(2);length.writeUInt16BE(id.length);
      const authData=Buffer.concat([hash(rpID),Buffer.from([uv?0x45:0x41]),Buffer.alloc(4),Buffer.alloc(16),length,id,cose]);
      return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{credProps:{rk:true}},response:{clientDataJSON:b64(client),attestationObject:b64(isoCBOR.encode(new Map([['fmt','none'],['attStmt',new Map()],['authData',authData]]))),transports:['internal']}};
    },
    authenticate(options,origin,{uv=true,rpID=options.rpId,userHandle=handle,extra={}}={}){
      const client=data('webauthn.get',options,origin,extra),count=Buffer.alloc(4);count.writeUInt32BE(++counter);
      const authData=Buffer.concat([hash(rpID),Buffer.from([uv?5:1]),count]),signature=crypto.sign('sha256',Buffer.concat([authData,hash(client)]),privateKey);
      return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(client),authenticatorData:b64(authData),signature:b64(signature),userHandle}};
    }
  };
}
