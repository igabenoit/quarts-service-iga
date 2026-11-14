import test from 'node:test';
import assert from 'node:assert/strict';
import {passkeyDestination} from '../public/passkey-destination.js';

test('passkeys open the current role and preserve legitimate deep links',()=>{
  const origin='https://quart.example';
  const admin={user:{kind:'admin',serviceAccess:true},path:'/index.html'};
  const manager={user:{kind:'account',serviceAccess:false},path:'/departements'};
  const service={user:{kind:'account',serviceAccess:true},path:'/index.html'};
  assert.equal(passkeyDestination(null,admin,origin),'/index.html');
  assert.equal(passkeyDestination(null,manager,origin),'/departements');
  assert.equal(passkeyDestination(null,service,origin),'/index.html');
  assert.equal(passkeyDestination(null,{user:null},origin),'/horaires-departements?vue=employe');
  assert.equal(passkeyDestination('/horaires-departements?vue=employe',admin,origin),'/index.html');
  assert.equal(passkeyDestination('/horaires-departements?vue=employe',manager,origin),'/departements');
  assert.equal(passkeyDestination('/',manager,origin),'/departements');
  assert.equal(passkeyDestination('/dossiers-employes#dossiers',admin,origin),'/dossiers-employes#dossiers');
  assert.equal(passkeyDestination('/conges',manager,origin),'/conges');
  for(const value of ['https://outside.example/','//outside.example/','javascript:alert(1)','/unknown','http://[invalid']){
    assert.equal(passkeyDestination(value,admin,origin),'/index.html');
    assert.equal(passkeyDestination(value,manager,origin),'/departements');
  }
});
