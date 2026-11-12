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
 // Managed PostgreSQL may grant access to a provisioned schema without database-wide CREATE.
 const schema=await pool.query("SELECT to_regnamespace('onboarding_private') AS existing");
 if (!schema.rows[0].existing) await pool.query('CREATE SCHEMA IF NOT EXISTS onboarding_private');
 await pool.query('CREATE TABLE IF NOT EXISTS onboarding_private.direction_signature (singleton boolean PRIMARY KEY CHECK(singleton), strokes jsonb NOT NULL, actor jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
 await db.query('CREATE TABLE IF NOT EXISTS onboarding_ethics_source(sha256 text PRIMARY KEY,document bytea NOT NULL)');
}

export async function directionSignature(){
 const result=await db.query('SELECT strokes FROM onboarding_private.direction_signature WHERE singleton=true');
 return result.rows[0]?.strokes;
}
export async function saveDirectionSignature(strokes,actor){
 const validPoint=p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=1);
 if(!Array.isArray(strokes)||!strokes.length||strokes.length>200||
    !strokes.every(line=>Array.isArray(line)&&line.length>=2&&line.length<=4000&&line.every(validPoint))||
    !strokes.some(line=>line.some(p=>Math.hypot(p[0]-line[0][0],p[1]-line[0][1])>.01))){
  throw Object.assign(Error('Tracez votre signature avant de l’enregistrer.'),{status:400});
 }
 await db.query(`INSERT INTO onboarding_private.direction_signature(singleton,strokes,actor) VALUES(true,$1,$2)
 ON CONFLICT(singleton) DO UPDATE SET strokes=EXCLUDED.strokes,actor=EXCLUDED.actor,updated_at=now()`,[JSON.stringify(strokes),JSON.stringify(actor)]);
}

