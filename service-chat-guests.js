export async function ensureChatGuests(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_service_chat_guests(
    person_id BIGINT PRIMARY KEY REFERENCES schedule_store_people(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL)`);
}
// Applied only after the personal-code identity and active status have been checked.
export async function isChatGuest(pool,personId){
  return !!(await pool.query(`SELECT 1 FROM schedule_service_chat_guests
    WHERE person_id=$1 AND expires_at>clock_timestamp()`,[personId])).rows.length;
}
