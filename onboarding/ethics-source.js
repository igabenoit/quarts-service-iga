const expected='2ae98cd7cd73c4da36a4de104f5365de098b481e55968e039abb95d2c7e9ab3a';
let db;
const annexHash="9be2e26f3a496fdc4fae57a3da5552a6ecb4d0d5ab638c5ff6f155359af24506";
export const annexSource=()=>source(annexHash);
export const ethicsSource=()=>source(expected);
async function source(hash){
 const row=(await db.query('SELECT document FROM onboarding_ethics_source WHERE sha256=$1',[hash])).rows[0];
 if(!row)throw Error('Document indisponible.');
 return Buffer.from(row.document);
}
export async function installEthicsSource(app,pool){
 db=pool;
 await db.query('CREATE TABLE IF NOT EXISTS onboarding_ethics_source(sha256 text PRIMARY KEY,document bytea NOT NULL)');
}
