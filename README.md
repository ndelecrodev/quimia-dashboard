# quimia-dashboard
Dashboard estático (HTML/JS) com login via Supabase Auth, para visualização de tarefas e horas do time — dados servidos pela API REST do Supabase, com controle de acesso via Row Level Security.

## Segurança e a chave `anon`

A `SUPABASE_ANON_KEY` presente em `app.js` é **pública por design** e pode ficar
versionada e visível no código-fonte do site. É a chave `anon` do Supabase, criada
justamente para rodar no navegador. Ela **não** é um segredo.

A fronteira de acesso real é o **Row Level Security (RLS)** no Postgres: cada política
só libera as linhas do usuário autenticado (o e-mail da sessão precisa constar em
`funcionarios.jira_email`/`clockify_email`). Uma sessão anônima ou de alguém não
cadastrado enxerga **zero linhas** em todas as tabelas — inclusive nas exportações
CSV/Excel, que partem exatamente dos mesmos dados já filtrados pelo RLS.

O que **nunca** deve entrar neste repositório é a chave `service_role`: essa sim é
secreta e **ignora o RLS**. Se um dia for necessário usá-la (ex.: num backend), ela
deve ficar fora do cliente, num `.env` não versionado.

## Migrations SQL (`sql/`)

Aplicar em ordem no **SQL editor** do Supabase:

1. `sql/001_email_is_registered.sql` — função `email_is_registered(email)`, usada no
   aviso de cadastro (heads-up quando o e-mail não está vinculado à Quimia).
2. `sql/002_log_unauthorized_signups.sql` — log server-side das tentativas de
   cadastro não autorizadas (depende da função acima).

## Tentativas de cadastro não autorizadas

O aviso de "e-mail não cadastrado" na tela de acesso é apenas um heads-up no
cliente — o RLS continua sendo a fronteira real, então quem se cadastra assim
mesmo não enxerga dado nenhum. Para ter um **registro** dessas tentativas
(inclusive as que ignoram a UI e chamam a API de Auth direto), a migração
`002` cria um trigger no banco que grava e-mail + horário em
`unauthorized_signup_attempts`.

Não há notificação automática ainda — para conferir o log, rode no SQL editor:

```sql
SELECT * FROM unauthorized_signup_attempts ORDER BY attempted_at DESC;
```

**Limitação:** só são registrados o **e-mail** e o **horário** da tentativa. O
**endereço IP** não fica disponível para um trigger de Postgres neste setup, então
não é capturado por aqui. Capturar IP exigiria uma Supabase Edge Function na frente
do signup — mudança maior, fora do escopo atual.
