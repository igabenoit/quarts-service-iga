export const disciplineSchemaSQL=`
CREATE TABLE IF NOT EXISTS employee_file_discipline (
 id uuid PRIMARY KEY, case_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 employee_key text NOT NULL, occurred_on date NOT NULL, measure_type text NOT NULL CHECK(measure_type IN ('verbal','written','suspension','other')),
 title text NOT NULL, facts text NOT NULL, expectations text NOT NULL, follow_up_on date,
 status text NOT NULL CHECK(status IN ('draft','filed','withdrawn')), reason text NOT NULL DEFAULT '',
 actor jsonb NOT NULL, supersedes uuid UNIQUE REFERENCES employee_file_discipline(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(case_id,version)
);
CREATE INDEX IF NOT EXISTS employee_discipline_person ON employee_file_discipline(employee_key,case_id,version DESC);
CREATE TABLE IF NOT EXISTS employee_file_discipline_attachments (
 id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES employee_file_discipline(id),
 revision_id uuid NOT NULL REFERENCES employee_file_discipline(id), name text NOT NULL,
 size integer NOT NULL CHECK(size BETWEEN 1 AND 12582912), sha256 text NOT NULL,
 data bytea NOT NULL, actor jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS employee_discipline_attachment_case ON employee_file_discipline_attachments(case_id);
ALTER TABLE employee_file_discipline ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_file_discipline_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON employee_file_discipline,employee_file_discipline_attachments FROM PUBLIC;
CREATE OR REPLACE FUNCTION employee_discipline_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Disciplinary history is append-only'; END $$;
DROP TRIGGER IF EXISTS employee_discipline_immutable_trigger ON employee_file_discipline;
CREATE TRIGGER employee_discipline_immutable_trigger BEFORE UPDATE OR DELETE ON employee_file_discipline FOR EACH ROW EXECUTE FUNCTION employee_discipline_immutable();
DROP TRIGGER IF EXISTS employee_discipline_attachment_immutable_trigger ON employee_file_discipline_attachments;
CREATE TRIGGER employee_discipline_attachment_immutable_trigger BEFORE UPDATE OR DELETE ON employee_file_discipline_attachments FOR EACH ROW EXECUTE FUNCTION employee_discipline_immutable();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON employee_file_discipline,employee_file_discipline_attachments FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON employee_file_discipline,employee_file_discipline_attachments FROM authenticated; END IF;
END $$;`;
