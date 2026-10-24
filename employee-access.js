// These aliases are internal constants, never request input.
export const activePersonSQL=(p='p',e='e')=>`((${p}.service_employee_id IS NULL AND ${p}.active) OR (${e}.active AND ${e}.departed_at IS NULL))`;
export const activeManagerSQL=(a='a')=>`EXISTS(SELECT 1 FROM schedule_store_people access_person
  LEFT JOIN schedule_employees access_employee ON access_employee.id=access_person.service_employee_id
  WHERE access_person.id=${a}.person_id AND access_person.portal_person_id IS NULL
  AND ${activePersonSQL('access_person','access_employee')})`;

export async function installEmployeeRevocation(pool){
  await pool.query(`ALTER TABLE schedule_store_people ADD COLUMN IF NOT EXISTS access_version INTEGER NOT NULL DEFAULT 1;
    CREATE OR REPLACE FUNCTION schedule_person_access_version() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF (OLD.active AND NOT NEW.active) OR OLD.portal_person_id IS DISTINCT FROM NEW.portal_person_id THEN
        NEW.access_version=OLD.access_version+1;
      END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS schedule_person_access_version ON schedule_store_people;
    CREATE TRIGGER schedule_person_access_version BEFORE UPDATE OF active,portal_person_id ON schedule_store_people
      FOR EACH ROW EXECUTE FUNCTION schedule_person_access_version();
    CREATE OR REPLACE FUNCTION schedule_service_revoke_access() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF (OLD.active AND NOT NEW.active) OR (OLD.departed_at IS NULL AND NEW.departed_at IS NOT NULL) THEN
        UPDATE schedule_store_people SET access_version=access_version+1 WHERE service_employee_id=NEW.id;
      END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS schedule_service_revoke_access ON schedule_employees;
    CREATE TRIGGER schedule_service_revoke_access AFTER UPDATE OF active,departed_at ON schedule_employees
      FOR EACH ROW EXECUTE FUNCTION schedule_service_revoke_access();`);
}
