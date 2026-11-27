import {depositDocument} from './file-blocks.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function renderEmployeeAttachments(panel,key,{view}){
 const base='/api/employee-files/attachments',params=new URLSearchParams({key,view});
 panel.className='panel';panel.innerHTML='<h3>Fichiers du dossier</h3><p class="muted">Accès réservé à la direction. PDF, photos JPG/PNG/WebP, Word, Excel et PowerPoint · 12 Mo maximum par fichier.</p><form data-files-form><label>Fichiers à ajouter<input type="file" name="files" multiple required accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.pptx"></label><button type="submit">Ajouter les fichiers au dossier</button></form><p role="status" aria-live="polite" data-file-status></p><div data-file-list></div>';
 const status=panel.querySelector('[data-file-status]'),form=panel.querySelector('form');
 async function refresh(){
  const r=await fetch(base+'?'+params,{cache:'no-store'}),data=await r.json();if(!r.ok)throw Error(data.error||'Lecture impossible.');if(!panel.isConnected)return;
  panel.querySelector('[data-file-list]').innerHTML=data.files.length?data.files.map(f=>{
   const url=base+'/'+encodeURIComponent(f.id)+'?'+params;
   return '<div style="padding:14px 0;border-bottom:1px solid #ddd;overflow-wrap:anywhere"><strong>'+esc(f.name)+'</strong><p class="muted">'+esc(new Intl.DateTimeFormat('fr-CA',{dateStyle:'medium',timeZone:'America/Toronto'}).format(new Date(f.created_at)))+' · '+esc((f.size/1024/1024).toLocaleString('fr-CA',{maximumFractionDigits:2}))+' Mo</p><div class="actions">'+(['application/pdf','image/jpeg','image/png','image/webp'].includes(f.mime)?'<a class="button secondary" href="'+esc(url)+'" target="_blank" rel="noopener">Ouvrir</a>':'')+'<a class="button secondary" href="'+esc(url+'&download=1')+'">Télécharger</a><button type="button" class="secondary" data-remove="'+esc(f.id)+'" data-name="'+esc(f.name)+'">Supprimer</button></div></div>';
  }).join(''):'<p class="muted">Aucun fichier ajouté dans cette section.</p>';
  for(const button of panel.querySelectorAll('[data-remove]'))button.onclick=async()=>{
   if(!confirm('Retirer « '+button.dataset.name+' » de ce dossier? Le fichier ne sera plus accessible dans cette section. Une copie et la trace du retrait sont conservées dans les archives.'))return;
   button.disabled=true;
   try{const r=await fetch(base+'/'+encodeURIComponent(button.dataset.remove)+'/remove?'+params,{method:'POST',headers:{'Content-Type':'application/json','X-Employee-Files':'1'},body:JSON.stringify({confirmed:true})});const result=await r.json();if(!r.ok)throw Error(result.error||'Retrait impossible.');status.textContent='Fichier retiré du dossier.';await refresh();}catch(e){status.textContent=e.message;button.disabled=false;}
  };

 }
 form.onsubmit=async event=>{
  event.preventDefault();const input=form.elements.files,files=[...input.files];if(!files.length)return;
  if(files.some(f=>!f.size||f.size>12*1024*1024)){status.textContent='Chaque fichier doit être non vide et ne pas dépasser 12 Mo.';return;}
  form.querySelector('button').disabled=true;input.disabled=true;let completed=0;
  try{
   for(const file of files){status.textContent='Ajout '+(completed+1)+' / '+files.length+' : '+file.name;await depositDocument(file,base+'?'+params,'X-Employee-Files');completed++;}
   form.reset();status.textContent=completed+' fichier(s) ajouté(s) au dossier.';
  }catch(e){status.textContent=completed+' fichier(s) ajouté(s). '+e.message+' Les fichiers déjà enregistrés sont conservés; une reprise ne les duplique pas.';}
  finally{input.disabled=false;form.querySelector('button').disabled=false;try{await refresh();}catch(e){status.textContent+=' '+e.message;}}
 };
 await refresh();
}
