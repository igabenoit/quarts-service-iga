import test from 'node:test';
import assert from 'node:assert/strict';
import {liveAppFixture} from './live-app-fixture.mjs';
import {actions, items} from '../public/supervision-schema.js';

test('Une grille enregistrée peut être relue et modifiée', async () => {
  const f = await liveAppFixture();
  try {
    const {cookie} = await f.call('POST','/api/login',{body:{code:'audit-admin-test'}});
    const headers = {Origin:f.base,'X-SST-Request':'1'};
    const save = body => f.call('POST','/api/sst/records',{cookie,headers,body});
    const get = async id => (await f.call('GET','/api/sst/state',{cookie})).body.records.find(r => r.id === id);
    const grid = {version:1,company:'Magasin test',store:'12',other:'Suivi',actions:actions.map((_,i) => i===0),
      rows:items.map((item,i) => ({rating:i===0?'Non respecté':'',tasks:item.tasks.map(() => true)}))};
    const body = {kind:'inspection',title:'Supervision test',status:'draft',details:'Observation de test',fields:{supervision:grid}};
    const result = await save(body);
    assert.ok(result.body.id,JSON.stringify(result.body));
    const record = await get(result.body.id);
    assert.deepEqual(record.fields.supervision,grid);
    assert.equal(record.details,body.details);
    grid.rows[0].rating = 'Respecté';
    const updated = await save({...body,id:record.id,version:record.version});
    assert.ok(updated.body.id,JSON.stringify(updated.body));
    assert.deepEqual((await get(record.id)).fields.supervision,grid);
  } finally { await f.close(); }
});
