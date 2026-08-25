-- 003 — Sincroniza as funções de RLS com o rename de coluna jira_email →
-- clickup_email.
--
-- Motivação: o sistema de origem do pipeline task-time-sync deixou de ser o
-- Jira e passou a ser o ClickUp. Como parte dessa migração, a coluna
-- funcionarios.jira_email foi renomeada para funcionarios.clickup_email do
-- lado do Postgres (ALTER TABLE funcionarios RENAME COLUMN jira_email TO
-- clickup_email). Esta migração mantém a camada de RLS do dashboard em
-- sincronia com esse rename, recriando as duas funções que referenciam a
-- coluna pelo nome antigo.
--
-- ORDEM DE EXECUÇÃO OBRIGATÓRIA — rodar no SQL editor do Supabase NESTA
-- ORDEM, nunca invertida:
--   1) ALTER TABLE funcionarios RENAME COLUMN jira_email TO clickup_email;
--   2) Este arquivo (003_rename_jira_email_to_clickup_email.sql).
-- Rodar este arquivo antes do rename da coluna quebra as duas funções
-- abaixo (e, com elas, login/signup de todo mundo), porque ambas
-- referenciam a coluna pelo nome diretamente.
--
-- Usa CREATE OR REPLACE FUNCTION (não DROP + CREATE) para preservar a
-- identidade de ambas as funções, já que GRANTs e as policies de RLS nas
-- seis tabelas (funcionarios, tarefas, horas, detalhes_tarefa, etiquetas,
-- tarefa_etiqueta) referenciam is_registered_employee() por nome/OID.

-- 1) is_registered_employee() — usada dentro das políticas de RLS das seis
--    tabelas para evitar o bug de recursão já documentado no histórico
--    deste projeto (README / task-time-sync-docs).
--
-- ATENÇÃO: o corpo abaixo NÃO foi preenchido. A definição atual desta
-- função não está versionada em nenhum lugar deste repositório — segundo o
-- README (seção "Arquitetura"), ela foi aplicada direto no SQL editor do
-- Supabase e nunca foi commitada aqui. Antes de rodar esta migração,
-- substituir o bloco abaixo pela definição real, obtida rodando no SQL
-- editor do Supabase:
--
--   SELECT pg_get_functiondef(oid)
--   FROM pg_proc
--   WHERE proname = 'is_registered_employee';
--
-- e então trocar toda referência a jira_email por clickup_email no corpo
-- retornado, mantendo o resto da lógica idêntico.

-- CREATE OR REPLACE FUNCTION public.is_registered_employee()
-- RETURNS boolean
-- LANGUAGE sql
-- SECURITY DEFINER
-- SET search_path = public
-- STABLE
-- AS $$
--   -- TODO: colar aqui a definição real, com clickup_email no lugar de
--   -- jira_email.
-- $$;

-- 2) email_is_registered(check_email text) — usada pelo aviso client-side de
--    "heads-up" no fluxo de cadastro. Lógica idêntica à de
--    001_email_is_registered.sql, só troca jira_email por clickup_email.

CREATE OR REPLACE FUNCTION public.email_is_registered(check_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM funcionarios
    WHERE lower(clickup_email) = lower(check_email)
       OR lower(clockify_email) = lower(check_email)
  );
$$;

GRANT EXECUTE ON FUNCTION public.email_is_registered(text) TO anon;
