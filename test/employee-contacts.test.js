import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContactDirectory,normalizeEmail,nameKey} from '../employee-contacts.js';

const employee=(id,name,extra={})=>({id,name,active:true,role:'cashier',departed_at:null,...extra});
const request=(id,name,email,extra={})=>({id,employee_name:name,email,department_id:1,department_name:'Service',department_code:'service',submitted_at:'2026-10-10T12:00:00Z',is_test:false,...extra});

test('regroupe les demandes et archives, dédouble les adresses et conserve les employés sans adresse',()=>{
  const result=buildContactDirectory([employee(1,'Émilie St-Amant'),employee(2,'Benoît'),employee(3,'Zoé')],[
    request(1,'EMILIE ST AMANT','  EMILIE@example.com '),request(2,'Émilie St-Amant','emilie@example.com',{archived_at:'2026-10-01'}),
    request(3,'Benoît','emilie@example.com'),request(4,'Zoé','test@example.com',{is_test:true})]);
  assert.deepEqual(result.emails,['emilie@example.com']);
  assert.equal(result.summary.total,3);assert.equal(result.summary.withEmail,2);assert.equal(result.summary.missing,1);
  assert.equal(result.employees.find(e=>e.id===1).addresses[0].requestIds.length,2);
  assert.equal(result.employees.filter(e=>e.shared).length,2);
  assert.equal(result.received.some(r=>r.email==='test@example.com'),false);
});

test('exclut inactifs et départs de la diffusion, conserve leur adresse dans l’export reçu',()=>{
  const result=buildContactDirectory([employee(1,'Actif'),employee(2,'Maladie',{active:false}),employee(3,'Départ',{departed_at:'2026-10-01'})],[
    request(1,'Actif','a@example.com'),request(2,'Maladie','b@example.com'),request(3,'Départ','c@example.com')]);
  assert.deepEqual(result.emails,['a@example.com']);assert.equal(result.summary.total,1);assert.equal(result.received.length,3);
  assert.equal(result.received.filter(r=>r.status==='Employé inactif ou retiré').length,2);
});

test('homonymes, noms incomplets et autres départements nécessitent un rapprochement explicite',()=>{
  const staff=[employee(1,'Alex'),employee(2,'Alex',{active:false}),employee(3,'Olga Exemple'),employee(4,'Charlie')];
  const requests=[request(1,'Alex','a@example.com'),request(2,'Olga','o@example.com'),request(3,'Charlie','c@example.com',{department_code:'meat',department_id:2})];
  const initial=buildContactDirectory(staff,requests);
  assert.equal(initial.summary.withEmail,0);assert.equal(initial.unmatched.length,3);
  requests[1].contact_employee_id=3;
  requests.push(request(4,'Olga','o@example.com'));
  const linked=buildContactDirectory(staff,requests);
  assert.equal(linked.employees.find(e=>e.id===3).email,'o@example.com');
  assert.equal(linked.employees.find(e=>e.id===3).addresses[0].requestIds.length,2);
});

test('plusieurs adresses demandent un choix et la préférence gestionnaire reste prioritaire',()=>{
  const requests=[request(1,'Camille','a@example.com'),request(2,'Camille','b@example.com')];
  const result=buildContactDirectory([employee(1,'Camille')],requests);
  assert.equal(result.summary.review,1);assert.deepEqual(result.emails,[]);
  const chosen=buildContactDirectory([employee(1,'Camille')],requests,[{employee_id:1,email:'chosen@example.com'}]);
  assert.deepEqual(chosen.emails,['chosen@example.com']);assert.equal(chosen.employees[0].addresses.length,2);
});

test('une demande reliée reste prioritaire sur le nom et les adresses invalides ne sont pas diffusées',()=>{
  const result=buildContactDirectory([employee(1,'Ancien',{active:false}),employee(2,'Nouveau')],[
    request(1,'Nouveau','old@example.com',{employee_id:1}),request(2,'Nouveau','bad@example.com\r\nBcc:victim@example.com')]);
  assert.deepEqual(result.emails,[]);assert.equal(result.unmatched[0].valid,false);
  for(const email of ['a@','a@example.com,b@example.com','A <a@example.com>','a@example.com\nBcc: b@example.com'])assert.equal(normalizeEmail(email),'');
  assert.equal(normalizeEmail(' TEST+leave@EXAMPLE.com '),'test+leave@example.com');
  assert.equal(nameKey('Émilie St-Amant'),nameKey('emilie st amant'));
});
