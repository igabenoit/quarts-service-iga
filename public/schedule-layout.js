// Measure real browser layout, keeping complete rows and their original text.
// The returned pages are temporary copies: schedule data and previews stay intact.
export function prepareSchedulePages(sources,{label}={}){
  const host=document.createElement('div');
  Object.assign(host.style,{position:'absolute',left:'-10000px',top:'0',width:'816px',background:'white'});
  document.body.append(host);
  const pages=[];
  try{
    for(const source of sources){
      const model=source.cloneNode(true);
      host.append(model);
      Object.assign(model.style,{display:'flex',flexDirection:'column',width:'816px',height:'1344px',margin:'0',boxShadow:'none',overflow:'visible'});
      for(const el of model.querySelectorAll('.sheet-person-label,.sheet-work,.sheet-day-detail,.sheet-notes')){
        const height=el.getBoundingClientRect().height;
        Object.assign(el.style,{height:'auto',maxHeight:'none',minHeight:`${height}px`,overflow:'visible',flexShrink:'0'});
      }
      for(const el of model.querySelectorAll('.sheet-day-detail'))Object.assign(el.style,{position:'static'});
      for(const el of model.querySelectorAll('.sheet-day'))el.style.paddingBottom='0';
      for(const el of model.querySelectorAll('th,td,small,span,p')){
        el.style.overflowWrap='anywhere';
      }
      // No flex child may silently shrink and conceal an overflowing last line.
      for(const el of model.querySelectorAll('.sheet-work > *,.sheet-person-label > *'))el.style.flexShrink='0';
      for(const el of model.children)el.style.flexShrink='0';
      const header=model.querySelector(':scope > header');
      if(label&&header?.querySelector('p'))header.querySelector('p').textContent=label;
      let page,table,body,group=null;
      const newPage=()=>{
        page=model.cloneNode(false);host.append(page);pages.push(page);
        page.dataset.pdfRenderId=crypto.randomUUID();
        if(header)page.append(header.cloneNode(true));
        table=null;body=null;
      };
      const exceeds=()=>{
        const bounds=page.getBoundingClientRect(),style=getComputedStyle(page);
        return Math.max(...[...page.children].map(el=>el.getBoundingClientRect().bottom))>bounds.bottom-parseFloat(style.paddingBottom)+1;
      };
      const startTable=original=>{
        table=original.cloneNode(false);
        for(const child of original.children)if(child.tagName!=='TBODY'&&child.tagName!=='TFOOT')table.append(child.cloneNode(true));
        body=document.createElement('tbody');table.append(body);page.append(table);
      };
      newPage();
      for(const block of [...model.children]){
        if(block===header)continue;
        if(block.tagName==='TABLE'){
          startTable(block);group=null;
          const rows=[...block.querySelectorAll(':scope > tbody > tr,:scope > tfoot > tr')];
          for(let i=0;i<rows.length;i++){
            const row=rows[i];
            const bundle=[row.cloneNode(true)];
            if(row.classList.contains('sheet-group')){
              group=row;
              if(rows[i+1])bundle.push(rows[++i].cloneNode(true));
            }
            const previousCount=body.children.length;
            body.append(...bundle);
            if(exceeds()&&(previousCount||page.children.length>(header?2:1))){
              bundle.forEach(el=>el.remove());
              if(!previousCount)table.remove();
              newPage();startTable(block);
              if(group&&!bundle[0].classList.contains('sheet-group'))body.append(group.cloneNode(true));
              body.append(...bundle);
            }
            // Exceptionally large individual records stay complete on their own page.
            if(exceeds())page.style.height='auto';
          }
        }else{
          const copy=block.cloneNode(true);page.append(copy);
          if(exceeds()&&page.children.length>(header?2:1)){copy.remove();newPage();page.append(copy);}
          if(exceeds())page.style.height='auto';
        }
      }
      model.remove();
    }
    // These totals cover the original team, even when it spans several pages.
    for(const page of pages.filter(p=>p.classList.contains('service-sheet'))){
      const reference=page.querySelector('.sheet-header small');
      if(reference)reference.textContent=reference.textContent.replace('Feuille','Section');
      for(const el of page.querySelectorAll('.sheet-subtotal td:first-child,.sheet-totals strong')){
        el.textContent=el.textContent.replace('Sous-total sur cette feuille','Sous-total du groupe').replace('Cette feuille :','Total de cette section :');
      }
    }
    return {pages,cleanup:()=>host.remove()};
  }catch(error){host.remove();throw error;}
}
