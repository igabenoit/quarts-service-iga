import { readFile } from 'node:fs/promises';
import PDFLib from './tuac/pdf-lib.min.cjs';

const dates = ['Naissance', 'Emploi', 'Signature'];
export const employer = {
  Compagnie: 'ALIMENTATION SOGESCO INC.',
  'Adresse affaires': '3000 BOUL LAFRAMBOISE, ST-HYACINTHE, J2S 4Z4'
};
export const tuacFields = ['Nom', 'Prénom', 'Naissance', 'Rue', 'Appartement', 'Ville',
  'Province', 'Code postal', 'Indicatif', 'Téléphone', 'Courriel', 'Emploi', 'Signature'];

export async function signedTuac(answers, strokes) {
  const source = await readFile(new URL('./tuac/form.pdf', import.meta.url));
  const pdf = await PDFLib.PDFDocument.load(source);
  const form = pdf.getForm();
  for (const key of [...tuacFields, ...Object.keys(employer)]) {
    const value = employer[key] ?? answers[key];
    if (typeof value !== 'string' || !value.trim() || value.length > 200) throw Error('Champ invalide : ' + key);
    if (dates.includes(key)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value+'T12:00:00Z').toISOString().slice(0,10) !== value) throw Error('Date invalide');
      const [year, month, day] = value.split('-');
      for (const [suffix, part] of [['jour',day],['mois',month],['année',year]]) form.getTextField(key+' '+suffix).setText(part);
    } else form.getTextField(key).setText(value.trim());
  }
  form.flatten();
  if (!Array.isArray(strokes) || strokes.length > 200 || !strokes.some(line=>line.length>1)) throw Error('Signature requise');
  const page = pdf.getPages()[0];
  for (const line of strokes) {
    if (!Array.isArray(line) || line.length > 4000) throw Error('Signature invalide');
    let previous;
    for (const point of line) {
      if (!Array.isArray(point) || point.length!==2 || !point.every(v=>Number.isFinite(v)&&v>=0&&v<=1)) throw Error('Signature invalide');
      const next = {x:164+point[0]*146, y:136+(1-point[1])*34};
      if (previous) page.drawLine({start:previous,end:next,thickness:0.7});
      previous=next;
    }
  }
  const output = await PDFLib.PDFDocument.create();
  const letter = output.addPage([612,792]);
  const [copy] = await output.embedPdf(await pdf.save(),[0]);
  const size = copy.scale(Math.min(576/copy.width,360/copy.height));
  for (const offset of [0,396]) letter.drawPage(copy,{x:(612-size.width)/2,y:(396-size.height)/2+offset,...size});
  return Buffer.from(await output.save());
}
