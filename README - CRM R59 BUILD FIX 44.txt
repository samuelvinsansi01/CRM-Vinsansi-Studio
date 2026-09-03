CRM R59 BUILD FIX 44 — Senha própria e recuperação de acesso

Implementado:
- Minha conta > Segurança permite definir ou alterar a senha da mesma conta Supabase Auth.
- Conta originalmente criada via Google continua sendo a mesma identidade; não cria novo public.users/organização.
- Login por e-mail + senha já existente permanece como caminho principal.
- Google continua disponível como alternativa.
- Login ganhou "Esqueci minha senha".
- resetPasswordForEmail usa o domínio atual do CRM e retorna para ?password_recovery=1.
- Tela dedicada de recuperação permite criar a nova senha e encerra a sessão de recuperação depois de salvar.
- Organização não é carregada durante o fluxo de recuperação.
- Senhas exigem no mínimo 8 caracteres e confirmação visual no CRM.
- Nenhuma senha é salva em public.users ou em tabelas do CRM; tudo é gerenciado pelo Supabase Auth.

Configuração necessária no Supabase do ambiente:
1. Auth > Providers: manter Email habilitado.
2. Auth > URL Configuration: o domínio publicado do CRM deve estar em Redirect URLs.
3. Configurar o envio de e-mail/SMTP do Supabase conforme o ambiente para o fluxo "Esqueci minha senha".

Não há migration SQL neste FIX.
