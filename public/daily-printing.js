import {presencePages,dailyPacket} from './leadership-presence-core.js';
import {fullDate} from './portal-weeks.js';

export function dailyOverflow(sheet){
  if(!sheet.clientHeight)return 'Affichez les feuilles avant de les imprimer.';
  const bounds=sheet.getBoundingClientRect(),safe=bounds.bottom-parseFloat(getComputedStyle(sheet).paddingBottom);
  const footer=sheet.querySelector('footer');
  if(sheet.scrollHeight>sheet.clientHeight+2||footer.getBoundingClientRect().bottom>safe+2||[...sheet.querySelectorAll('td,th')].some(c=>c.scrollWidth>c.clientWidth+2))return 'Le contenu dépasse une feuille. Aucune ligne ne sera coupée : réduisez les précisions ou contactez l’administration.';
  return '';
}

export function installDailyPrinting({state,api}){
  const $=s=>document.querySelector(s);let snapshot=null,presences=null,request=0,busy=false,url=null;
  const controls=['#dailyMode','#dailyDay','#dailyPdf','#planoPrint','#planoClose'];
  const ready=()=>{$('#planoPrint').disabled=busy||!$('#planoPreviewPages').children.length;$('#dailyPdf').disabled=$('#planoPrint').disabled;};
  const clear=()=>{$('#dailyPdfResult').hidden=true;if(url){URL.revokeObjectURL(url);url=null;}$('#planoPreviewPages').innerHTML='';$('#planoPrintSheet').innerHTML='';ready();};
  async function render(){
    const ticket=++request,mode=$('#dailyMode').value,day=$('#dailyDay').value;clear();
    $('#dailyStatus').textContent='Chargement des feuilles…';
    try{
      if(mode!=='planogram'&&!presences){const data=await api('/api/weeks/'+snapshot.weekStart+'/leadership-presence');if(ticket!==request)return;if(data.weekStart!==snapshot.weekStart)throw Error('La semaine reçue ne correspond pas à la semaine choisie.');presences=data;}
      if(ticket!==request||!$('#planoPreview').open)return;
      const pages=dailyPacket(window.createPlanogramPages(snapshot),presences?presencePages(presences):[],{mode,day});
      $('#planoPreviewPages').innerHTML=pages;$('#planoPrintSheet').innerHTML=pages;
      $('#dailyStatus').textContent=`Semaine du ${fullDate(snapshot.weekStart)} · ${$('#planoPreviewPages').children.length} feuille(s) · Légal 8½ × 14 po, portrait`;
      ready();
    }catch(error){if(ticket===request){clear();$('#dailyStatus').textContent=error.message;}}
  }
  function open(mode){snapshot=structuredClone(state);presences=null;$('#dailyMode').value=mode;$('#dailyDay').value='all';$('#planoPreview').setAttribute('aria-label','Feuilles quotidiennes de présence et planogrammes');$('#planoPreview .preview-toolbar strong').textContent='Feuilles quotidiennes · Courtoisie et Service';$('#planoPreview').showModal();render();}
  $('#planoBtn').onclick=()=>open('planogram');$('#presenceBtn').onclick=()=>open('presence');
  $('#dailyMode').onchange=render;$('#dailyDay').onchange=render;
  $('#planoClose').onclick=()=>{request++;$('#planoPreview').close();};
  $('#planoPreview').addEventListener('cancel',event=>{if(busy)event.preventDefault();else request++;});
  async function checked(){await document.fonts.ready;const sheets=[...$('#planoPreviewPages').children];await Promise.all(sheets.flatMap(s=>[...s.querySelectorAll('img')]).map(img=>img.decode()));for(const sheet of sheets){const error=dailyOverflow(sheet);if(error)throw Error(error);}return sheets;}
  $('#planoPrint').onclick=async()=>{try{await checked();$('#planoPreview').close();document.body.classList.add('printing-planogram');window.print();}catch(error){$('#dailyStatus').textContent=error.message;}};
  window.addEventListener('afterprint',()=>document.body.classList.remove('printing-planogram'));
  $('#dailyPdf').onclick=async()=>{
    if(busy)return;busy=true;controls.forEach(s=>$(s).disabled=true);$('#dailyStatus').textContent='Préparation du PDF…';$('#dailyPdfResult').hidden=true;
    try{
      const sheets=await checked(),{schedulePagesPDF}=await import('./department-pdf.js');
      const blob=await schedulePagesPDF(sheets,{previewSelector:'#planoPreviewPages > article',validateSheet:dailyOverflow});
      if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);$('#dailyPdfDownload').href=url;$('#dailyPdfDownload').download=`Courtoisie-${snapshot.weekStart}-${$('#dailyMode').value}-${$('#dailyDay').value}.pdf`;$('#dailyPdfOpen').href=url;
      $('#dailyPdfResult').hidden=false;$('#dailyStatus').textContent=`PDF prêt · ${sheets.length} feuille(s) · Semaine du ${fullDate(snapshot.weekStart)}`;
    }catch(error){$('#dailyStatus').textContent=error.message;}finally{busy=false;controls.forEach(s=>$(s).disabled=false);ready();}
  };
}
