import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import PDFLib from './tuac/pdf-lib.min.cjs';

const dates = ['Naissance', 'Emploi', 'Signature'];
export const employer = {
  Compagnie: 'ALIMENTATION SOGESCO INC.',
  'Adresse affaires': '3000 BOUL LAFRAMBOISE, ST-HYACINTHE, J2S 4Z4'
};
export const tuacFields = ['Nom', 'Prénom', 'Naissance', 'Rue', 'Appartement', 'Ville',
  'Province', 'Code postal', 'Indicatif', 'Téléphone', 'Courriel', 'Emploi', 'Signature'];

// Bottom edges measured on the three original TUAC slips, from the top of a Letter sheet (points).
const copies = [
  {x: 0, rows: [70, 93.7, 118.7, 142.5, 166.4, 191]},
  {x: 0.25, rows: [333.4, 357.6, 382.2, 406.4, 430.5, 454.8]},
  {x: 0.35, rows: [597.6, 621.7, 646.2, 670.4, 694.5, 719]}
];
const mm = 72 / 25.4;
const rightDate = [448, 469.5, 491.7, 514];

function signaturePath(strokes) {
  if (!Array.isArray(strokes) || strokes.length > 200) throw Error('Signature invalide');
  let left = 800, right = 0, top = 200, bottom = 0;
  const commands = [];
  for (const line of strokes) {
    if (!Array.isArray(line) || line.length > 4000) throw Error('Signature invalide');
    for (const [index, point] of line.entries()) {
      if (!Array.isArray(point) || point.length !== 2 || !point.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) {
        throw Error('Signature invalide');
      }
      if (line.length < 2) continue;
      const x = point[0] * 800, y = point[1] * 200;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      commands.push(index === 0 ? PDFLib.moveTo(x, -y) : PDFLib.lineTo(x, -y));
    }
  }
  if (!commands.length || (right === left && bottom === top)) throw Error('Signature requise');
  const scale = Math.min(236 / (right - left + 2), 17 / (bottom - top + 2));
  return (page, x, y) => {
    page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.concatTransformationMatrix(scale, 0, 0, scale,
      x - scale * (left - 1), y + scale * (bottom + 1)), PDFLib.setLineWidth(2),
      PDFLib.setLineCap(1), PDFLib.setLineJoin(1));
    // Keep large valid signatures below the JS spread-argument limit.
    for (const command of commands) page.pushOperators(command);
    page.pushOperators(PDFLib.stroke(), PDFLib.popGraphicsState());
  };
}

export async function signedTuac(answers, strokes) {
  const data = {...answers, ...employer};
  for (const key of tuacFields) {
    const v = data[key];
    if (typeof v !== 'string' || !v.trim() || v.length > 200) throw Error('Champ invalide : ' + key);
    if (dates.includes(key)) {
      const d = new Date(v + 'T12:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== v) throw Error('Date invalide');
    }
    data[key] = v.trim().normalize('NFC');
  }
  const signPage = signaturePath(strokes);
  const pdf = await PDFLib.PDFDocument.create();
  pdf.setTitle('TUAC — Adhésion');
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await readFile(new URL('./tuac/LiberationSans-Regular.ttf', import.meta.url)), {subset: true});
  const page = pdf.addPage([612,792]);

  for (const {x, rows} of copies) {
    // The Xerox test placed the baseline 3 mm below the initial scan calibration.
    const [name, address, contact, company, job, sign] = rows.map(row => 792 - (row - 4) - 3 * mm);
    function field(value, left, right, y, size = 10, center = false) {
      const width = font.widthOfTextAtSize(value, size);
      const fitted = Math.min(size, size * (right - left) / (width || 1));
      const pad = center ? (right - left - width * fitted / size) / 2 : 0;
      page.drawText(value, {font, size: fitted, x: x + left + pad, y});
    }
    function date(value, edges, y) {
      const [year, month, day] = value.split('-');
      for (const [i, part] of [day, month, year].entries()) {
        field(part, edges[i] + 1, edges[i+1] - 1, y, i === 2 ? 8.1 : 9, true);
      }
    }
    field(data.Nom, 96.5, 232.5, name);
    field(data.Prénom, 236, 445.5, name);
    date(data.Naissance, rightDate, name);
    field(data.Rue, 96.5, 232.5, address, 9.4);
    field(data.Appartement, 236, 267, address, 9);
    field(data.Ville, 276, 400, address, 9.4);
    field(data.Province, 403.5, 453.5, address, 9);
    field(data['Code postal'], 460, 511.5, address, 9);
    field(data.Indicatif, 99, 132, contact + 7.4 - 2 * mm, 8.4, true);
    field(data.Téléphone, 139, 229, contact, 9.6);
    field(data.Courriel, 234.5 + 2 * mm, 511.5, contact, 9.4);
    field(data.Compagnie, 96.5, 510.5, company);
    field(data['Adresse affaires'], 96.5, 445, job, 9.5);
    date(data.Emploi, rightDate, job);
    date(data.Signature, [95, 117, 142.5, 168.7], sign);
    signPage(page, 210 + x, sign);
  }
  return Buffer.from(await pdf.save());
}
