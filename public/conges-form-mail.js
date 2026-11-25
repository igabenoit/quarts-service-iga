const $=selector=>document.querySelector(selector);
const form=$('#formMail'),fields=$('#formMailFields'),send=$('#sendFormMail'),status=$('#formMailStatus');
const storageKey='leave-form-email-draft-v1';
let attempt=null,busy=false;
try{attempt=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{/* A blocked storage area does not prevent sending. */}
const save=()=>{try{if(attempt)sessionStorage.setItem(storageKey,JSON.stringify(attempt));else sessionStorage.removeItem(storageKey);}catch{}};
const input=()=>({recipient:$('#formMailRecipient').value.trim().toLowerCase(),name:$('#formMailName').value.trim(),isTest:$('#formMailMode').value==='test'});
function announce(message,kind=''){
  status.textContent=message;status.className='mail-feedback '+kind;status.hidden=false;status.focus();
}
function mode(){
  const test=$('#formMailMode').value==='test';
  $('#formMailTestNote').hidden=!test;
  send.textContent=attempt?'Vérifier ou réessayer l’envoi':test?'Envoyer le courriel de test':'Envoyer le formulaire par courriel';
  $('#formMailPreview').hidden=true;
}
function lock(){fields.disabled=Boolean(attempt)||busy;$('#prepareFormMailTest').disabled=Boolean(attempt)||busy;send.disabled=busy;$('#newFormMail').hidden=!attempt;}
if(attempt?.submissionKey&&attempt?.input){
  $('#formMailRecipient').value=attempt.input.recipient;$('#formMailName').value=attempt.input.name;$('#formMailMode').value=attempt.input.isTest?'test':'real';
  announce('Un envoi précédent est conservé. Utilisez « Vérifier ou réessayer l’envoi » pour retrouver sa confirmation sans créer de doublon.');
}else attempt=null;
mode();lock();
$('#formMailMode').onchange=mode;
$('#prepareFormMailTest').onclick=()=>{
  $('#formMailRecipient').value='igabenoit@gmail.com';$('#formMailMode').value='test';mode();$('#formMailRecipient').focus();
};
$('#previewFormMail').onclick=()=>{
  $('#formMailPreviewFrame').src='/api/leave/form-email/preview?test='+String($('#formMailMode').value==='test');
  $('#formMailPreview').hidden=false;
};
$('#newFormMail').onclick=()=>{
  if(attempt&&!attempt.sent&&!confirm('L’envoi précédent n’est pas confirmé. Un nouveau courriel pourrait créer un doublon. Préparer quand même un autre envoi ?'))return;
  attempt=null;save();lock();mode();status.hidden=true;$('#formMailRecipient').focus();
};
form.onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  if(!attempt){attempt={submissionKey:crypto.randomUUID(),input:input()};save();}
  busy=true;lock();send.textContent='Envoi en cours…';announce('Envoi du courriel en cours. Patientez…');
  try{
    const response=await fetch('/api/leave/form-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...attempt.input,submissionKey:attempt.submissionKey})});
    const data=await response.json();
    if(!response.ok||data.status!=='sent')throw Error(data.error||'Envoi non confirmé. Réessayez avec le même bouton.');
    attempt.sent=true;save();
    const date=new Intl.DateTimeFormat('fr-CA',{dateStyle:'long',timeStyle:'short',timeZone:'America/Toronto'}).format(new Date(data.sentAt));
    announce(`Courriel ${data.isTest?'de test ':''}envoyé à ${data.recipient}, le ${date} (Québec). Le service d’envoi a confirmé sa prise en charge. La réception dans la boîte du destinataire reste à vérifier, y compris les indésirables.`,'success');
  }catch(error){announce(error.message||'Envoi non confirmé. Réessayez avec le même bouton.','error');}
  finally{busy=false;lock();send.textContent=attempt?.sent?'Vérifier la confirmation':'Vérifier ou réessayer l’envoi';}
};
