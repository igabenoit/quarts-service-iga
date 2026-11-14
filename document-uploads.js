import express from 'express';
import {createHash} from 'node:crypto';
import {PART_BYTES} from './public/file-blocks.js';

const documents={table:'document_uploads',maximum:12*1024*1024};
export const sstImportUploads={table:'sst_import_uploads',maximum:16*1024*1024};
const validId=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};

export function originalName(req,fallback) {
  let name;
  try { name=decodeURIComponent(req.get('x-filename')||fallback); }
  catch { fail('Nom de fichier invalide.'); }
  name=name.replaceAll('\\','/').split('/').at(-1).replace(/[\x00-\x1f]/g,'').slice(0,180);
  if (!name) fail('Nom de fichier requis.');
  return name;
}

// The same unqualified table lives in each module's own private schema.
export async function installDocumentUploadSchema(db,storage=documents) {
  const {table,maximum}=storage;
  await db.query(`CREATE TABLE IF NOT EXISTS ${table}(
    id uuid PRIMARY KEY, owner_key text NOT NULL, target text NOT NULL, name text NOT NULL,
    options jsonb NOT NULL, byte_count integer NOT NULL CHECK(byte_count BETWEEN 1 AND ${maximum}),
    sha256 text NOT NULL, content bytea NOT NULL DEFAULT ''::bytea, original_id uuid,
    ${storage===sstImportUploads?'receipt jsonb,':''}
    expires_at timestamptz NOT NULL DEFAULT(now()+interval '1 hour'));
    CREATE INDEX IF NOT EXISTS ${storage===sstImportUploads?'sst_import_upload_expiry':'document_upload_expiry'} ON ${table}(expires_at);
    ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
}
export const clearExpiredDocuments=(db,storage=documents)=>db.query(`DELETE FROM ${storage.table} WHERE expires_at<=now()`);

export function installDocumentUploads(app,{path,auth,origin,wrap,transaction,pool,owner,target,options,authorize,save,storage=documents}) {
  const {table,maximum}=storage;
  const route=path+'/uploads/:uploadId';
  const match='id=$1 AND owner_key=$2 AND target=$3 AND expires_at>now()';
  function key(req) {
    if (!validId.test(req.params.uploadId)) fail('Identifiant de dépôt invalide.');
    return [req.params.uploadId,owner(req),target(req)];
  }
  app.post(route,auth,origin,wrap(async(req,res)=>{
    const keys=key(req);
    const {size,sha256}=req.body || {};
    const name=String(req.body?.name||'').replaceAll('\\','/').split('/').at(-1).replace(/[\x00-\x1f]/g,'').slice(0,180);
    if (!name || !Number.isInteger(size) || size<1 || size>maximum || typeof sha256!=='string' || !/^[a-f0-9]{64}$/.test(sha256))
      fail('Fichier, taille ou empreinte invalide.');
    const metadata=options(req);
    await transaction(async db=>{
      await authorize?.(db,req,metadata);
      await clearExpiredDocuments(db,storage);
      const args=[...keys,name,JSON.stringify(metadata),size,sha256];
      const existing=await db.query(`SELECT 1 FROM ${table} WHERE ${match} AND name=$4 AND options=$5 AND byte_count=$6 AND sha256=$7`,args);
      if (existing.rowCount) return;
      const {rows:[pending]}=await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE owner_key=$1 AND original_id IS NULL`,[keys[1]]);
      if (pending.n>=4) fail('Quatre dépôts sont en cours pour ce compte.',429);
      const result=await db.query(`INSERT INTO ${table}(id,owner_key,target,name,options,byte_count,sha256)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING RETURNING id`,args);
      if (!result.rowCount) fail('Ce dépôt a changé. Recommencez.',409);
    });
    res.status(201).json({ok:true});
  }));
  app.put(route+'/parts/:offset',auth,origin,express.raw({type:'application/octet-stream',limit:PART_BYTES}),wrap(async(req,res)=>{
    const offset=Number(req.params.offset);
    if (!Number.isSafeInteger(offset)||offset<0||offset>=maximum||offset%PART_BYTES||!Buffer.isBuffer(req.body)||!req.body.length)
      fail('Bloc de fichier invalide.');
    const args=[...key(req),offset,req.body,PART_BYTES];
    const valid=`${match} AND original_id IS NULL AND octet_length($5::bytea)=least($6::int,byte_count-$4::int)`;
    const result=await pool.query(`UPDATE ${table} SET content=content || $5::bytea
      WHERE ${valid} AND octet_length(content)=$4 RETURNING id`,args);
    if (!result.rowCount) {
      const retry=await pool.query(`SELECT 1 FROM ${table} WHERE ${valid}
        AND substring(content FROM ($4::int+1) FOR octet_length($5::bytea))=$5::bytea`,args);
      if (!retry.rowCount) fail('Bloc expiré, différent ou hors séquence.',409);
    }
    res.json({ok:true});
  }));
  app.post(route+'/complete',auth,origin,wrap(async(req,res)=>{
    const receipt=await transaction(async db=>{
      const {rows:[upload]}=await db.query(`SELECT * FROM ${table} WHERE ${match} FOR UPDATE`,key(req));
      if (!upload) fail('Dépôt introuvable ou expiré.',404);
      const access=await authorize?.(db,req,upload.options);
      if (upload.original_id) return upload.receipt || {id:upload.original_id};
      const bytes=Buffer.from(upload.content);
      if(bytes.length!==upload.byte_count || createHash('sha256').update(bytes).digest('hex')!==upload.sha256)
        fail('Le fichier est incomplet ou a changé. Recommencez le dépôt.',409);
      const result=await save(db,req,access,bytes,upload.name,upload.options);
      if (storage===sstImportUploads) {
        await db.query(`UPDATE ${table} SET content=''::bytea,original_id=$2,receipt=$3 WHERE id=$1`,[upload.id,result.id,result]);
        return result;
      }
      await db.query(`UPDATE ${table} SET content=''::bytea,original_id=$2 WHERE id=$1`,[upload.id,result]);
      return {id:result};
    });
    res.status(201).json(receipt);
  }));
  app.delete(route,auth,origin,wrap(async(req,res)=>{
    await pool.query(`DELETE FROM ${table} WHERE ${match} AND original_id IS NULL`,key(req));
    res.json({ok:true});
  }));
}
