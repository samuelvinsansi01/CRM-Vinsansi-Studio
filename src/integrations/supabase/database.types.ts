/**
 * Tipos mínimos para iniciar o projeto.
 * Substitua pelo arquivo gerado pelo Supabase CLI quando o schema estabilizar:
 * supabase gen types typescript --project-id <project-id> > src/integrations/supabase/database.types.ts
 */
export type AppUser = {
  users_id: number;
  auth_user_id: string;
  status_id: number;
};
