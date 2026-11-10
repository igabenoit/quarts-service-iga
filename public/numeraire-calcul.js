export const items=[
 ['Billets de 5 $',5],['Billets de 10 $',10],
 ['Boîtes de 5 ¢',100],['Boîtes de 10 ¢',250],['Boîtes de 25 ¢',500],
 ['Boîtes de 1 $',1000],['Boîtes de 2 $',1000]
];
export function totals(q){
 if(!Array.isArray(q)||q.length!==items.length||!q.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=3000))throw Error('Entre des quantités entières positives ou nulles.');
 const amounts=q.map((v,i)=>v*items[i][1]);
 const bills=amounts[0]+amounts[1],total=amounts.reduce((a,b)=>a+b,0);
 return {bills,total,error:bills>1000?'Maximum de 1 000 $ en billets.':total>3000?'Maximum de 3 000 $ par casier.':''};
}
