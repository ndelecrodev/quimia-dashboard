# quimia-dashboard


> Também publicado como site navegável em
> https://ndelecrodev.github.io/task-time-sync-docs/


Dashboard estático (HTML, CSS e JavaScript puro, sem framework e sem build
step) para acompanhar tarefas e horas do time. Os dados vêm direto do
Postgres/Supabase que o pipeline `task-time-sync` mantém atualizado, este
site só lê, nunca escreve nessas tabelas.

Disponível em português (este arquivo, padrão) e em inglês, em
[`docs/en/readme.md`](docs/en/readme.md).

## O que é isto

Um painel de leitura para o time acompanhar o próprio progresso: tarefas por
pessoa e por projeto, horas apontadas, prazos e um detalhamento exportável.
Não existe cadastro de tarefas nem edição de dado nenhum pelo site, quem
escreve é o pipeline task-time-sync (Jira + Clockify → Postgres). O
dashboard é só a camada de visualização sobre o mesmo banco.

## Arquitetura

Não há servidor próprio, nem API intermediária. O navegador fala direto com
o Supabase por dois canais do SDK `@supabase/supabase-js`:

- **Auth**: login e cadastro por e-mail/senha.
- **PostgREST**: consultas às tabelas `funcionarios`, `tarefas`, `horas`,
  `etiquetas` e `tarefa_etiqueta`, feitas com a sessão do usuário logado.

Toda a lógica de exibição (agregações por pessoa/área, gráficos, export)
roda no navegador em cima do que essas consultas devolvem. Não há
transformação de dado no servidor.

**Controle de acesso é 100% Row Level Security no Postgres, não código do
site.** A `SUPABASE_ANON_KEY` que aparece em `app.js` é pública por design:
é a chave `anon` do Supabase, feita para rodar no navegador e ficar visível
no código-fonte, e não concede acesso a nada por si só. Cada política de
RLS só libera as linhas do usuário autenticado cujo e-mail conste em
`funcionarios.jira_email`/`clockify_email`; uma sessão anônima ou de
alguém não cadastrado enxerga zero linhas em qualquer tabela. As duas
migrações versionadas em `sql/` cobrem as funções auxiliares desse
controle. O restante das políticas de RLS, incluindo
`is_registered_employee()`, usada dentro delas para evitar recursão, foi
aplicado direto no SQL editor do Supabase e ainda não está versionado neste
repositório.

## Rodando localmente

Não há instalação nem gerenciador de pacotes: as três dependências
(Chart.js, `@supabase/supabase-js`, SheetJS/XLSX) são carregadas via CDN
direto no `index.html`, nada é vendorizado localmente.

Abrir o `index.html` direto pelo `file://` não funciona direito: o cliente
Supabase depende de `localStorage`/cookies por origem, e o navegador trata
`file://` como uma origem instável para isso. Sirva a pasta com qualquer
servidor de arquivo estático, por exemplo:

```bash
python3 -m http.server
```

ou a extensão Live Server do VS Code. Depois é só abrir a URL local no
navegador.

## Configuração

`SUPABASE_URL` e `SUPABASE_ANON_KEY` estão hardcoded no topo de `app.js`.
Para apontar o dashboard para outro projeto Supabase (outro ambiente, outro
cliente), troque as duas constantes ali. Não há `.env` nem variável de
build, porque não há build.

## Funcionalidades

- **Visão por colaborador**: tarefas, status, prioridade e horas de uma
  pessoa específica, com avatar (foto de `funcionarios.photo_url` quando
  cadastrada, com fallback automático para um círculo de iniciais se a URL
  falhar ou não existir foto).
- **Visão do projeto**: os mesmos indicadores agregados para o time
  inteiro, tarefas por área, status geral, horas por funcionário.
- **Detalhamento de tarefas**: tabela completa (por pessoa ou do projeto
  inteiro), com exportação para CSV (separador `;` e BOM UTF-8, para abrir
  certo no Excel em português) e para `.xlsx` real via SheetJS.
- **Login e cadastro**: e-mail/senha via Supabase Auth. No cadastro, se o
  e-mail digitado não constar em `funcionarios`, a tela mostra um aviso não
  bloqueante (a pessoa pode seguir mesmo assim); o aviso é só um heads-up
  no cliente, quem decide o que ela vê depois de logar é o RLS.
- **Log de cadastros não autorizados**: todo signup com e-mail fora de
  `funcionarios` é registrado no banco por um trigger em `auth.users`
  (migração `002`), inclusive se alguém pular a tela e chamar a API de Auth
  direto. Guarda e-mail e horário; não guarda IP, um trigger de Postgres
  não tem acesso a essa informação.

## Deploy

Hospedado no Cloudflare Pages, conectado a este repositório no GitHub. Sem
comando de build, diretório de saída é a raiz do repositório.

## Segurança e a chave `anon`

A `SUPABASE_ANON_KEY` presente em `app.js` é **pública por design** e pode
ficar versionada e visível no código-fonte do site. Ela **não** é um
segredo, é a chave `anon` do Supabase, criada justamente para rodar no
navegador.

A fronteira de acesso real é o **Row Level Security (RLS)** no Postgres,
como descrito em Arquitetura acima.

O que **nunca** deve entrar neste repositório é a chave `service_role`:
essa sim é secreta e **ignora o RLS**. Se um dia for necessário usá-la
(ex.: num backend), ela deve ficar fora do cliente, num `.env` não
versionado.

## Migrations SQL (`sql/`)

Aplicar em ordem no **SQL editor** do Supabase:

1. `sql/001_email_is_registered.sql`: função `email_is_registered(email)`,
   usada no aviso de cadastro (heads-up quando o e-mail não está vinculado
   à Quimia).
2. `sql/002_log_unauthorized_signups.sql`: log server-side das tentativas
   de cadastro não autorizadas (depende da função acima).

## Tentativas de cadastro não autorizadas

O aviso de "e-mail não cadastrado" na tela de acesso é apenas um heads-up
no cliente, o RLS continua sendo a fronteira real, então quem se cadastra
assim mesmo não enxerga dado nenhum. Para ter um **registro** dessas
tentativas (inclusive as que ignoram a UI e chamam a API de Auth direto), a
migração `002` cria um trigger no banco que grava e-mail e horário em
`unauthorized_signup_attempts`.

Não há notificação automática ainda, para conferir o log, rode no SQL
editor:

```sql
SELECT * FROM unauthorized_signup_attempts ORDER BY attempted_at DESC;
```

**Limitação:** só são registrados o **e-mail** e o **horário** da
tentativa. O **endereço IP** não fica disponível para um trigger de
Postgres neste setup, então não é capturado por aqui. Capturar IP exigiria
uma Supabase Edge Function na frente do signup, mudança maior, fora do
escopo atual.

## Relação com os outros repositórios

- **task-time-sync**: o pipeline que sincroniza Jira e Clockify para o
  mesmo Postgres/Supabase que este dashboard lê. Este repositório não
  escreve nessas tabelas, só consulta.
- **task-time-sync-docs**: site de documentação (MkDocs) com a visão mais
  completa do pipeline e do dashboard juntos, incluindo o modelo de dados
  compartilhado e as decisões de design por trás dele.

## Licença

MIT, ver [LICENSE](LICENSE).
