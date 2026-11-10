import {sections, items, actions, ratings} from './supervision-schema.js';

export function mount(container, saved) {
  // Only fixed labels from the template are inserted as markup.
  let index = 0;
  container.innerHTML = '<div id="supervisionForm"><label>Nom de l’entreprise<input name="company" maxlength="160"></label><label>Nº de magasin<input name="store" maxlength="80"></label>' +
    sections.map(section => '<h3>' + section.title + '</h3>' + section.rows.map(item => {
      const i = index++;
      return '<fieldset><legend>' + item.label + '</legend>' + item.tasks.map(task =>
        '<label><input type="checkbox" data-task="' + i + '"> ' + task + '</label>').join('') +
        '<label>Observation<select name="rating' + i + '"><option value="">À observer</option>' +
        ratings.map(r => '<option>' + r + '</option>').join('') + '</select></label></fieldset>';
    }).join('')).join('') + '<h3>Actions prises à la suite de l’observation</h3>' +
    actions.map(action => '<label><input type="checkbox" data-action> ' + action + '</label>').join('') +
    '<label>Précisions pour « Autre »<textarea name="other" maxlength="2000"></textarea></label></div>';
  for (const name of ['company','store','other']) container.querySelector('[name="'+name+'"]').value = saved[name] || '';
  saved.rows?.forEach((row,i) => {
    container.querySelector('[name="rating'+i+'"]').value = row.rating;
    container.querySelectorAll('[data-task="'+i+'"]').forEach((box,j) => box.checked = row.tasks[j]);
  });
  container.querySelectorAll('[data-action]').forEach((box,i) => box.checked = !!saved.actions?.[i]);
}

export function read(element) {
  const value = name => element.querySelector('[name="'+name+'"]').value;
  const flags = selector => Array.from(element.querySelectorAll(selector), box => box.checked);
  return {version:1, company:value('company'), store:value('store'), other:value('other'),
    rows:items.map((_,i) => ({rating:value('rating'+i),tasks:flags('[data-task="'+i+'"]')})),
    actions:flags('[data-action]')};
}

export function summary(grid, escape) {
  let index = 0;
  return '<h3>Supervision des gérants</h3><p>' + escape([grid.company,grid.store].filter(Boolean).join(' · ')) + '</p>' +
    sections.map(section => '<h4>' + section.title + '</h4><ul>' + section.rows.map(item => {
      const row = grid.rows[index++];
      const tasks = item.tasks.filter((_,j) => row.tasks[j]);
      return '<li>' + item.label + ' — <strong>' + escape(row.rating || 'À observer') + '</strong>' +
        (tasks.length ? '<br>' + tasks.join(' · ') : '') + '</li>';
    }).join('') + '</ul>').join('') + '<h4>Actions prises</h4><p>' +
    actions.filter((_,i) => grid.actions[i]).join('<br>') + '</p><p>' + escape(grid.other) + '</p>';
}
export function printBlank(target){
  const box='<span class="sv-box" aria-hidden="true"></span>';
  const table=section=>'<table><colgroup><col><col class="sv-rating" span="3"></colgroup><thead><tr><th>'+section.title+'</th>'+ratings.map(r=>'<th>'+r+'</th>').join('')+'</tr></thead><tbody>'+
    section.rows.map(row=>'<tr><td><strong>'+row.label+'</strong>'+row.tasks.map(task=>'<div>'+box+' '+task+'</div>').join('')+'</td>'+ratings.map(()=>'<td>'+box+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
  const groups=[[0],[1,2],[3,4,5]];
  target.innerHTML='<div class="sv-paper">'+groups.map((indices,i)=>'<div class="sv-sheet"><h1>Grille de supervision SST — Gérants</h1><p>Feuille '+(i+1)+' sur 3　 ·　 Département ____________________　 Date ______________</p>'+
    (i===0?'<p>Entreprise __________________________　 Nº magasin __________　 Gérant·e ______________________</p><p>Cochez les tâches observées et indiquez votre constat pour chaque point de vigilance.</p>':'')+
    indices.map(index=>table(sections[index])).join('')+
    (i===2?'<h2>Actions prises à la suite de l’observation</h2><div class="sv-actions">'+actions.map(a=>'<div>'+box+' '+a+'</div>').join('')+'</div><p>Autre __________________________________________________________________________</p>':'')+
    '<h2>Observations et commentaires</h2><div class="sv-lines"></div></div>').join('')+'</div>';
  window.print();
}
