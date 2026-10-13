import {MODELS} from './public/clothing-core.js';
// Minimal OOXML workbook: supplier quantities only, no employee data or executable formulas.
const xml=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
function crc32(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
function zip(files){
  const chunks=[],central=[];let offset=0;
  for(const [name,text] of Object.entries(files)){
    const data=Buffer.from(text),filename=Buffer.from(name),crc=crc32(data),header=Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x21,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x21,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE(offset,42);
    chunks.push(header,filename,data);central.push(entry,filename);offset+=header.length+filename.length+data.length;
  }
  const index=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,index,end]);
}
export function supplierWorkbook(title,rows){
  const data=[[title],['Modèle','Référence','Couleur','Grandeur','Quantité'],...rows.map(r=>[r.label,r.model,r.color,r.size,r.quantity]),['TOTAL','','','',rows.reduce((n,r)=>n+r.quantity,0)]];
  return workbook(data,'Commande fournisseur');
}
export function internalWorkbook(title,orders){
  const rows=orders.flatMap(o=>o.items.map(i=>[o.employee_name,o.department_name,MODELS.find(m=>m.id===i.model)?.name||i.model,i.color,i.size,i.quantity,i.quantity*i.unitPrice/100,o.paid_at?'Payé':'À payer',o.collected_at?'Remise':'À remettre',o.cancelled?'Annulée':'Active',o.id]));
  return workbook([[title],['Employé','Département','Modèle','Couleur','Grandeur','Quantité','Montant ligne ($)','Paiement','Remise','Commande','Référence'],...rows],'Suivi interne');
}
function workbook(data,sheetName){
  const last=String.fromCharCode(64+data[1].length);
  const sheet=data.map((r,i)=>`<row r="${i+1}">${r.map((v,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}"${typeof v==='number'?'': ' t="inlineStr"'}>${typeof v==='number'?`<v>${v}</v>`:`<is><t xml:space="preserve">${xml(v)}</t></is>`}</c>`).join('')}</row>`).join('');
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  return zip({
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':`<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="44" customWidth="1"/><col min="2" max="11" width="18" customWidth="1"/></cols><sheetData>${sheet}</sheetData><autoFilter ref="A2:${last}${Math.max(2,sheetName==='Suivi interne'?data.length:data.length-1)}"/><pageSetup paperSize="1" orientation="portrait"/></worksheet>`
  });
}
