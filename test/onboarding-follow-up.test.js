import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFollowUpEmails} from '../public/onboarding-follow-up.js';

test('suivi : virgules, points-virgules, collage multiligne et doublons',()=>{
 assert.deepEqual(parseFollowUpEmails('RH@example.invalid; gerant@example.invalid, rh@EXAMPLE.invalid\r\n direction@example.invalid;'),['RH@example.invalid','gerant@example.invalid','direction@example.invalid']);
 assert.deepEqual(parseFollowUpEmails(' rh@example.invalid '),['rh@example.invalid']);
 for(const input of ['',null,[],', ;','rh@example.invalid; invalide','a@example.invalid b@example.invalid','a@example.invalid\r\nBcc: intrus@example.invalid','Nom <rh@example.invalid>'])assert.throws(()=>parseFollowUpEmails(input));
 const maximum=Array.from({length:50},(_,i)=>'suivi'+i+'@example.invalid').join(',');
 assert.equal(parseFollowUpEmails(maximum).length,50);
 assert.throws(()=>parseFollowUpEmails(maximum+',suivi50@example.invalid'),/50/);
});
