const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function renderScheduleEmailPanel(panel,key,{view}){
 const url='/api/employee-files/schedule-email?'+new URLSearchParams({key,view});
 const ids={send:crypto.randomUUID(),test:crypto.randomUUID()};
 let data,busy=false,timer;
 async function request(op,body){
  const r=await fetch(op?url.replace('?', '/'+op+'?'):url,{method:op?'POST':'GET',cache:'no-store',headers:{'Content-Type':'application/json','X-Employee-Files':'1'},...(op?{body:JSON.stringify(body)}:{})});
  const value=await r.json();if(!r.ok)throw Error(value.error||'Opération impossible.');return value;
 }
 panel.className='panel';
 panel.innerHTML='<h3>Ton horaire en ligne</h3><p>Envoyer le courriel en couleur avec le lien vers l’horaire et les instructions de première connexion.</p><label>Courriel du dossier employé<input type="email" readonly data-email></label><label>Code personnel inclus dans le courriel<input type="text" readonly data-code></label><p data-access class="muted"></p><p data-help class="muted"></p><div class="actions"><button type="button" data-send disabled>Envoyer les instructions d’horaire</button><button type="button" class="secondary" data-test disabled>M’envoyer un test à igabenoit@gmail.com</button><button type="button" class="secondary" data-refresh>Actualiser le destinataire et les envois</button></div><p data-feedback role="status" aria-live="polite"></p><details><summary>Aperçu du courriel en couleur</summary><iframe title="Aperçu du courriel horaire" sandbox="" style="width:100%;height:650px;border:0"></iframe></details><div data-history></div>';
 const q=s=>panel.querySelector(s);
 function buttons(){q('[data-send]').disabled=busy||!data?.email||!data?.emailReady||!data?.access?.code;q('[data-test]').disabled=busy||!data?.emailReady||!data?.access?.code;q('[data-refresh]').disabled=busy;}
 async function refresh(){
  clearTimeout(timer);const next=await request();if(!panel.isConnected)return;data=next;
  q('[data-code]').value=data.access?.code||'';q('[data-access]').textContent=!data.access?.code?'Code manquant ou ambigu : vérifiez la liste du personnel.':data.access.requiresPasskey?'Clé d’accès requise : le courriel inclut le matricule et explique la connexion par clé.':'Le courriel inclut ce code à six chiffres et les étapes pour ouvrir l’horaire.';
  q('[data-email]').value=data.email;q('[data-help]').textContent=!data.email?'Courriel manquant : complétez-le dans les documents d’embauche du dossier, enregistrez, puis actualisez ici. Le test reste disponible.':'Adresse reprise automatiquement du dossier. Après une correction au dossier, actualisez le destinataire ici.';
  if(!data.emailReady)q('[data-help]').textContent+=' Le service courriel est indisponible.';
  q('iframe').srcdoc=data.html;buttons();
  q('[data-history]').innerHTML=data.history.length?'<h4>Derniers envois</h4>'+data.history.map(h=>'<p><strong>'+esc(h.subject.startsWith('[TEST]')?'Test':'Employé')+' — '+esc(h.status==='sent'?'Accepté par le service d’envoi':h.status==='review'?'Envoi à vérifier manuellement':'En attente de confirmation')+'</strong><br>'+esc(h.recipients.join(', '))+' · '+esc(new Intl.DateTimeFormat('fr-CA',{dateStyle:'short',timeStyle:'short',timeZone:'America/Toronto'}).format(new Date(h.sent_at||h.created_at)))+'</p>').join('')+'<p class="muted">La confirmation du service d’envoi ne confirme pas la réception ni la lecture.</p>':'<p class="muted">Aucun courriel d’horaire envoyé depuis ce dossier.</p>';
  if(data.history.some(h=>['pending','sending'].includes(h.status)))timer=setTimeout(()=>{if(panel.isConnected)refresh().catch(e=>q('[data-feedback]').textContent=e.message);},5000);
 }
 for(const op of ['send','test'])q('[data-'+op+']').onclick=async()=>{
  busy=true;buttons();q('[data-feedback]').textContent='Préparation de l’envoi…';
  try{const result=await request(op,{requestId:ids[op],code:data.access.code,...(op==='send'?{email:data.email}:{})});ids[op]=crypto.randomUUID();q('[data-feedback]').textContent=(result.status==='sent'?'Courriel accepté par le service d’envoi pour ':'Courriel mis en file d’envoi pour ')+result.to+'.';await refresh();}
  catch(e){q('[data-feedback]').textContent=e.message;}finally{busy=false;buttons();}
 };
 q('[data-refresh]').onclick=()=>refresh().catch(e=>q('[data-feedback]').textContent=e.message);
 await refresh();
}
