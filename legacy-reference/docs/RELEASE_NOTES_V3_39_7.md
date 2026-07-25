# V3.39.7

- Corrige persistencia de perfil Instagram em ambientes com RLS.
- Usa RPC SECURITY DEFINER com validacao explicita de auth.uid().
- Salva o perfil completo e o limite diario em uma unica operacao atomica.
- Falha secundaria ao publicar runtime da extensao nao mascara mais uma gravacao concluida.
