-- 002 — Log server-side de tentativas de cadastro NÃO autorizadas.
--
-- Aplicar no SQL editor do Supabase, DEPOIS de 001_email_is_registered.sql
-- (esta migração reutiliza a função email_is_registered() criada lá).
--
-- Motivação: o aviso "e-mail não cadastrado" no app.js é só client-side, e um
-- usuário curioso/malicioso pode ignorá-lo chamando a API de Auth do Supabase
-- direto. Este log NÃO depende da cooperação do cliente: é um trigger no banco,
-- que dispara em TODO signup (via UI ou chamada direta à API).

-- 1) Tabela de log.
CREATE TABLE IF NOT EXISTS public.unauthorized_signup_attempts (
  id bigint generated always as identity primary key,
  attempted_email text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

-- 2) RLS: tabela TOTALMENTE trancada para o cliente. Habilitamos o RLS e, de
--    propósito, NÃO criamos nenhuma policy (SELECT/INSERT/UPDATE/DELETE) para
--    os papéis anon/authenticated — logo, nenhuma sessão do navegador lê ou
--    escreve aqui (deny-all por padrão do RLS). Só o dono do projeto, pelo SQL
--    editor (acesso elevado, que bypassa o RLS), consegue consultar o log.
--    O trigger abaixo é SECURITY DEFINER, então grava independentemente disso.
ALTER TABLE public.unauthorized_signup_attempts ENABLE ROW LEVEL SECURITY;

-- 3) Função de trigger + trigger em auth.users.
--    SECURITY DEFINER para poder inserir na tabela trancada acima.
CREATE OR REPLACE FUNCTION public.log_unauthorized_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só registra se houver e-mail e ele NÃO estiver cadastrado em funcionarios.
  -- (email_is_registered() é STABLE e checa jira_email/clockify_email.)
  IF NEW.email IS NOT NULL AND NOT public.email_is_registered(NEW.email) THEN
    INSERT INTO public.unauthorized_signup_attempts (attempted_email)
    VALUES (NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_unauthorized_signup ON auth.users;
CREATE TRIGGER trg_log_unauthorized_signup
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.log_unauthorized_signup();

-- LIMITAÇÃO (importante): um trigger de Postgres em auth.users só enxerga a
-- linha inserida (e-mail + timestamp). O ENDEREÇO IP da requisição NÃO chega
-- até aqui, então não é possível registrá-lo por este caminho. Capturar IP em
-- tempo real exigiria uma Supabase Edge Function na frente do signup — mudança
-- maior, fora do escopo, a menos que seja pedida como follow-up.
