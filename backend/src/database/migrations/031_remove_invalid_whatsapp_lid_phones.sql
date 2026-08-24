-- LID values are private WhatsApp identifiers, not dialable phone numbers.
-- Remove values previously inferred from them; a real number will be stored
-- after whatsapp-web.js resolves the LID-to-phone mapping on an inbound event.
UPDATE channel_accounts
SET phone_number = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE channel = 'whatsapp'
  AND external_user_id LIKE '%@lid'
  AND phone_number = substr(external_user_id, 1, instr(external_user_id, '@') - 1);
