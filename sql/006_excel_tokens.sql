-- 006 — Personal keys that let the Excel dashboard (Power Query) download the
-- spreadsheet through /api/download-planilha without a Supabase session.
--
-- Apply in the Supabase SQL editor. Depends only on the funcionarios table.
--
-- Why: Power Query cannot hold a Supabase session (the access token expires in
-- one hour), so each employee generates a long-lived personal key in the web
-- dashboard and pastes it once into Excel's credential store (Basic auth,
-- key as the password). Only the SHA-256 hash of the key is stored here.
--
-- Revocation is manual on purpose: the pipeline never deletes rows from
-- funcionarios, so removing someone from DIM_FUNCIONARIO does NOT revoke
-- their key. Revoke with:
--   UPDATE excel_tokens SET revoked_at = now()
--   WHERE funcionario_id = <id> AND revoked_at IS NULL;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1) Key table. RLS enabled with NO policies: no browser session can read or
--    write it. Every access goes through the SECURITY DEFINER functions below,
--    same pattern as unauthorized_signup_attempts (002).
CREATE TABLE IF NOT EXISTS public.excel_tokens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  funcionario_id integer NOT NULL
    REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

ALTER TABLE public.excel_tokens ENABLE ROW LEVEL SECURITY;

-- At most one active key per employee. Generating a new key revokes the old one.
CREATE UNIQUE INDEX IF NOT EXISTS excel_tokens_one_active_per_employee
  ON public.excel_tokens (funcionario_id)
  WHERE revoked_at IS NULL;

-- 2) Resolves the logged-in user to a funcionarios row, using the same email
--    columns as email_is_registered(). Internal helper, not exposed to clients.
CREATE OR REPLACE FUNCTION public.current_funcionario_id()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id FROM funcionarios
  WHERE lower(clickup_email) = lower(auth.email())
     OR lower(clockify_email) = lower(auth.email())
  ORDER BY id
  LIMIT 1;
$$;

-- 3) Creates a new key for the logged-in employee and returns it in plain
--    text. This is the only moment the plain key exists; the web UI must show
--    it once and never store it.
CREATE OR REPLACE FUNCTION public.create_excel_token()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_funcionario_id integer := public.current_funcionario_id();
  v_token text;
BEGIN
  IF v_funcionario_id IS NULL THEN
    RAISE EXCEPTION 'not a registered employee' USING ERRCODE = '42501';
  END IF;

  UPDATE excel_tokens
     SET revoked_at = now()
   WHERE funcionario_id = v_funcionario_id
     AND revoked_at IS NULL;

  -- "qxl_" prefix makes a leaked key recognizable in logs or chats.
  v_token := 'qxl_' || encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO excel_tokens (funcionario_id, token_hash)
  VALUES (v_funcionario_id, encode(extensions.digest(v_token, 'sha256'), 'hex'));

  RETURN v_token;
END;
$$;

-- 4) Revokes the logged-in employee's active key, if any.
CREATE OR REPLACE FUNCTION public.revoke_excel_token()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE excel_tokens
     SET revoked_at = now()
   WHERE funcionario_id = public.current_funcionario_id()
     AND revoked_at IS NULL;
END;
$$;

-- 5) Status of the logged-in employee's active key, for the web UI.
--    Returns zero rows when there is no active key. Never returns the hash.
CREATE OR REPLACE FUNCTION public.excel_token_status()
RETURNS TABLE (created_at timestamptz, last_used_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT t.created_at, t.last_used_at
  FROM excel_tokens t
  WHERE t.funcionario_id = public.current_funcionario_id()
    AND t.revoked_at IS NULL;
$$;

-- 6) Called by the Cloudflare Pages Function with the anon key. Returns only
--    true/false, same exposure model as email_is_registered(). Brute force is
--    not a practical concern: keys carry 256 bits of randomness.
CREATE OR REPLACE FUNCTION public.validate_excel_token(p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_token IS NULL OR p_token NOT LIKE 'qxl\_%' THEN
    RETURN false;
  END IF;

  SELECT id INTO v_id
  FROM excel_tokens
  WHERE token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    AND revoked_at IS NULL;

  IF v_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE excel_tokens SET last_used_at = now() WHERE id = v_id;
  RETURN true;
END;
$$;

-- 7) Privileges. Supabase grants EXECUTE on new public functions to anon and
--    authenticated by default, so everything is revoked first and granted back
--    explicitly.
REVOKE ALL ON FUNCTION public.current_funcionario_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_excel_token()      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_excel_token()      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.excel_token_status()      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.validate_excel_token(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_excel_token()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_excel_token()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.excel_token_status()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_excel_token(text) TO anon, authenticated;
