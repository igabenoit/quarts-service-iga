// Positions are in pixels on the approved 95 dpi scan, measured from the top left.
export const retirementFields = [];
function field(group, key, label, x, y, n, options = {}) {
  retirementFields.push({group, id:group+'_'+key, label, x, y, n, ...options});
}
const title=(g,x,y)=>field(g,'titre','Titre',0,0,0,{choices:{'Mme':[x,y],'M.':[x+61,y],'Mlle':[x,y+17]}});
function name(g,x,y,step=16){field(g,'nom','Nom de famille',x,y,20,{req:true,step});field(g,'prenom','Prénom',x+21*step,y,10,{req:true,step});field(g,'init','Initiales',x+32*step,y,3,{step})}
function identity(g,nasX,dateX,y,optional=false){field(g,'nas','Nº d’assurance sociale'+(optional?' (facultatif)':''),nasX,y,9,{format:'digits',pattern:'[0-9 ]{9,11}',req:!optional});field(g,'naissance','Date de naissance',dateX,y,8,{type:'date',req:true})}
function address(g,x1,x2,x3,y,city,prov,cp,y2,step=16){field(g,'app','Appartement',x1,y,7,{step});field(g,'numero','Nº de rue',x2,y,6,{step});field(g,'rue','Rue',x3,y,28,{step,req:true});field(g,'ville','Ville',city,y2,33,{step,req:true});field(g,'province','Province (2 lettres)',prov,y2,2,{req:true,pattern:'[A-Za-z]{2}',step});field(g,'postal','Code postal',cp,y2,6,{format:'postal',pattern:'[A-Za-z][0-9][A-Za-z] ?[0-9][A-Za-z][0-9]',req:true,step})}
title('p',83,194);name('p',193,194);identity('p',200,492,238);field('p','sexe','Sexe',0,0,0,{choices:{'Féminin':[695,235],'Masculin':[695,259]}});address('p',34,162,274,293,34,579,628,339);
field('p','etat','État civil',0,0,0,{choices:{'Marié(e)':[153,384],'Célibataire':[153,405],'Union de fait':[250,384],'Séparé(e)':[250,405],'Divorcé(e)':[375,384],'Veuf/veuve':[375,405]}});field('p','langue','Langue',0,0,0,{choices:{'Français':[608,385],'Anglais':[608,406]}});field('p','tel','Téléphone résidentiel',175,434,10,{format:'tel'});field('p','travail','Téléphone au travail',521,434,10,{format:'tel'});field('p','courriel','Courriel',146,465,34,{type:'email',flex:true});field('p','employeur','Employeur actuel',185,504,20,{value:'ALIMENTATION SOGESCO',flex:true});field('p','embauche','Date d’embauche',624,505,8,{type:'date'});field('p','section','Section locale',135,535,4);field('p','adhesion','Date d’adhésion au syndicat',445,535,8,{type:'date'});
title('c',83,602);name('c',194,602);identity('c',203,492,647);field('c','sexe','Sexe',0,0,0,{choices:{'Féminin':[695,639],'Masculin':[695,663]}});for(let i=0;i<3;i++){const g='b'+i,back=i>0,y=i===2?256:0; title(g,back?101:83,back?89+y:771);name(g,back?211:194,back?88+y:771,back?15.7:16); identity(g,back?226:205,back?545:491,back?133+y:814,true);field(g,'lien','Lien de parenté',back?157:140,back?171+y:858,22,{req:true,step:back?15.7:16});field(g,'part','Pourcentage',back?646:643,back?171+y:859,3,{req:true,pattern:'[0-9]{1,3}'});address(g,back?53:35,back?180:163,back?290:275,back?219+y:901,back?54:35,back?588:579,back?635:628,back?266+y:951,back?15.7:16)}

export const retirementKeys = [...retirementFields.map(f=>f.id),'spouse','mode','count','consent','signed'];
export function visibleGroup(group, values) {
  if (group === 'p') return true;
  if (group === 'c') return values.spouse === 'yes';
  return values.mode === 'persons' && Number(group.slice(1)) < Number(values.count);
}
