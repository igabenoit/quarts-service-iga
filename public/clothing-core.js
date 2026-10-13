export const MODELS=[{id:'3320',name:'À capuchon'},{id:'3331',name:'À capuchon avec fermeture éclair'},{id:'3340',name:'Col rond'}];
export const COLORS=['Noir','Vert forêt'];
export const SIZES=['S','M','L','XL','XXL'];
export const PRICE=4000;
export const money=cents=>(cents/100).toLocaleString('fr-CA',{style:'currency',currency:'CAD'});
export const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function normalizeItems(value){
  if(!Array.isArray(value)||!value.length||value.length>30)throw Error('Ajoutez de 1 à 30 choix de chandails.');
  const grouped=new Map();
  for(const v of value){
    if(!MODELS.some(m=>m.id===v.model)||!COLORS.includes(v.color)||!SIZES.includes(v.size)||!Number.isInteger(v.quantity)||v.quantity<1||v.quantity>20)throw Error('Vérifiez le modèle, la couleur, la grandeur et la quantité (1 à 20).');
    const key=JSON.stringify([v.model,v.color,v.size]),old=grouped.get(key);
    grouped.set(key,{model:v.model,color:v.color,size:v.size,quantity:(old?.quantity||0)+v.quantity,unitPrice:PRICE});
  }
  const items=[...grouped.values()].sort((a,b)=>a.model.localeCompare(b.model)||COLORS.indexOf(a.color)-COLORS.indexOf(b.color)||SIZES.indexOf(a.size)-SIZES.indexOf(b.size));
  if(items.reduce((n,i)=>n+i.quantity,0)>20)throw Error('Une commande peut contenir au plus 20 chandails.');
  return items;
}
export const orderTotal=items=>items.reduce((n,i)=>n+i.quantity*i.unitPrice,0);
export function supplierRows(orders){
  const rows=new Map();
  for(const order of orders.filter(o=>!o.cancelled))for(const item of order.items){
    const key=JSON.stringify([item.model,item.color,item.size]);
    const row=rows.get(key)||{model:item.model,label:MODELS.find(m=>m.id===item.model)?.name||item.model,color:item.color,size:item.size,quantity:0};
    row.quantity+=item.quantity;rows.set(key,row);
  }
  return [...rows.values()].sort((a,b)=>a.model.localeCompare(b.model)||COLORS.indexOf(a.color)-COLORS.indexOf(b.color)||SIZES.indexOf(a.size)-SIZES.indexOf(b.size));
}
