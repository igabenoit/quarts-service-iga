import express from 'express';
import {createHash} from 'node:crypto';
import {PHOTO_PART_BYTES, MAX_PHOTO_BYTES} from './public/department-photo-upload.js';
import {needsSchema} from './preview-schema.js';
import {validatePhoto} from './department-photo.js';

const table = 'schedule_department_photo_uploads';
const route = '/api/departments/:id/photo-uploads/:uploadId';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unavailable = 'Cet envoi est introuvable ou expiré. Recommencez le dépôt.';
const fail = (message,status=400) => { throw Object.assign(Error(message),{status}); };
const match = 'id=$1 AND department_id=$2 AND owner_key=$3 AND expires_at>now()';

function identity(req) {
  if (!uuid.test(req.params.uploadId)) fail(unavailable,404);
  return [req.params.uploadId,req.params.id,req.manager.kind + ':' + (req.manager.id ?? 'legacy')];
}

export const clearExpiredPhotoUploads = db => db.query('DELETE FROM '+table+' WHERE expires_at <= now()');

export async function installPhotoUploads(app, pool, {requireManager,sameOrigin,endpoint,week,department,transaction,savePhoto}) {
  if (needsSchema(pool)) await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (
    id uuid PRIMARY KEY, department_id bigint NOT NULL REFERENCES schedule_leave_departments(id),
    owner_key text NOT NULL, week_start date NOT NULL, name text NOT NULL, mime text NOT NULL,
    byte_count integer NOT NULL CHECK(byte_count BETWEEN 32 AND 8388608), sha256 text NOT NULL,
    content bytea NOT NULL DEFAULT ''::bytea,
    photo_id bigint REFERENCES schedule_department_photos(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour')
  ); CREATE INDEX IF NOT EXISTS schedule_photo_upload_expiry ON ${table}(expires_at);
  ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
  app.post(route, requireManager, sameOrigin, endpoint(async (req,res) => {
    const key = identity(req);
    const {size,sha256,mime} = req.body || {};
    const start = week(req.body?.weekStart);
    const name = String(req.body?.name || 'Photo').slice(0,120);
    if (!Number.isSafeInteger(size) || size < 32 || size > MAX_PHOTO_BYTES ||
        typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) ||
        !['image/jpeg','image/png','image/webp'].includes(mime)) fail('Choisissez une photo JPEG, PNG ou WebP de 8 Mo ou moins.');
    await transaction(async db => {
      await department(req.params.id,db);
      await clearExpiredPhotoUploads(db);
      const params = [...key,start,name,mime,size,sha256];
      const existing = await db.query(`SELECT 1 FROM ${table} WHERE ${match}
        AND week_start=$4 AND name=$5 AND mime=$6 AND byte_count=$7 AND sha256=$8`,params);
      if (existing.rowCount) return;
      const pending = await db.query(`SELECT count(*)::int AS total FROM ${table} WHERE owner_key=$1 AND photo_id IS NULL`,[key[2]]);
      if (pending.rows[0].total >= 4) fail('Quatre envois sont déjà en cours. Réessayez plus tard.',429);
      const created = await db.query(`INSERT INTO ${table}(id,department_id,owner_key,week_start,name,mime,byte_count,sha256)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING RETURNING id`,params);
      if (!created.rowCount) fail('Cet identifiant est déjà utilisé. Recommencez le dépôt.',409);
    });
    res.status(201).json({ok:true});
  }));

  app.put(route+'/parts/:offset',requireManager,sameOrigin,
    express.raw({type:'application/octet-stream',limit:PHOTO_PART_BYTES}),endpoint(async (req,res) => {
      const key = identity(req);
      const offset = Number(req.params.offset);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= MAX_PHOTO_BYTES ||
          offset % PHOTO_PART_BYTES !== 0 || !Buffer.isBuffer(req.body) || !req.body.length)
        fail('Bloc de photo invalide.');
      // UPDATE locks one upload. A repeated part can only match bytes already written.
      const params = [...key,offset,req.body,PHOTO_PART_BYTES];
      const result = await pool.query(`UPDATE ${table} SET content=content || $5::bytea
        WHERE ${match} AND photo_id IS NULL AND octet_length(content)=$4
        AND octet_length($5::bytea)=least($6::int,byte_count-$4) RETURNING id`,params);
      if (!result.rowCount) {
        const retry = await pool.query(`SELECT 1 FROM ${table} WHERE ${match} AND photo_id IS NULL
          AND octet_length($5::bytea)=least($6::int,byte_count-$4::int)
          AND substring(content FROM ($4::int+1) FOR octet_length($5::bytea))=$5::bytea`,params);
        if (!retry.rowCount) fail('Le bloc est incomplet, différent ou hors séquence.',409);
      }
      res.json({ok:true});
    }));

  app.post(route+'/complete',requireManager,sameOrigin,endpoint(async (req,res) => {
    const key = identity(req);
    const id = await transaction(async db => {
      const {rows:[upload]} = await db.query(`SELECT *,week_start::text AS week FROM ${table} WHERE ${match} FOR UPDATE`,key);
      if (!upload) fail(unavailable,404);
      if (upload.photo_id) return Number(upload.photo_id);
      const bytes = Buffer.from(upload.content);
      if (bytes.length !== upload.byte_count || createHash('sha256').update(bytes).digest('hex') !== upload.sha256)
        fail('La photo reçue est incomplète ou a changé. Recommencez le dépôt.',409);
      const data = validatePhoto('data:'+upload.mime+';base64,'+bytes.toString('base64'));
      const photoId = await savePhoto(db,upload.department_id,upload.week,upload.name,data);
      // Retain only a receipt, so a retry after COMMIT returns the same photo.
      await db.query(`UPDATE ${table} SET content=''::bytea,photo_id=$2 WHERE id=$1`,[upload.id,photoId]);
      return photoId;
    });
    res.status(201).json({id});
  }));
  app.delete(route,requireManager,sameOrigin,endpoint(async (req,res) => {
    await pool.query(`DELETE FROM ${table} WHERE ${match} AND photo_id IS NULL`,identity(req));
    res.json({ok:true});
  }));
}
