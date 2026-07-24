-- Task 4 — função de "heads-up" no cadastro.
--
-- Aplicar no SQL editor do Supabase (NÃO roda a partir do site estático).
--
-- Retorna apenas true/false indicando se um e-mail arbitrário já consta em
-- funcionarios. É a ÚNICA exceção intencional em que expomos uma função ao
-- papel anon: ela é chamada ANTES do login, no fluxo de "criar acesso", para
-- avisar (sem bloquear) quem tenta se cadastrar com um e-mail não vinculado à
-- Quimia. Não devolve dados de linha, então é seguro expor a anônimos.
--
-- Contraste com is_registered_employee(), que não recebe argumento e checa
-- auth.email() da própria sessão (usada dentro das políticas de RLS).

CREATE OR REPLACE FUNCTION public.email_is_registered(check_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM funcionarios
    WHERE lower(jira_email) = lower(check_email)
       OR lower(clockify_email) = lower(check_email)
  );
$$;

GRANT EXECUTE ON FUNCTION public.email_is_registered(text) TO anon;
