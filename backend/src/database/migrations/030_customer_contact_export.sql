-- Backfill reliable WhatsApp phone numbers already present in provider IDs.
-- Other channels remain NULL unless their provider supplies a phone number.
UPDATE channel_accounts
SET phone_number = CASE
        WHEN external_user_id LIKE '%@%' THEN substr(external_user_id, 1, instr(external_user_id, '@') - 1)
        ELSE external_user_id
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE channel = 'whatsapp'
  AND (phone_number IS NULL OR trim(phone_number) = '')
  AND external_user_id IS NOT NULL
  AND trim(external_user_id) <> '';
