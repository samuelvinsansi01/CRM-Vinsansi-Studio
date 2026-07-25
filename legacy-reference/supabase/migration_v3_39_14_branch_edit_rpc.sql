begin;

create or replace function public.save_branch_config_v1(
  p_branch_id text,
  p_slug text,
  p_name text,
  p_category text,
  p_subcategories jsonb,
  p_associated_categories jsonb,
  p_order_index integer,
  p_min_rating numeric,
  p_min_reviews integer,
  p_image_name text,
  p_image_required boolean,
  p_active boolean,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id text := auth.uid()::text;
  v_row public.branches%rowtype;
begin
  if v_user_id is null or v_user_id = '' then
    raise exception 'Usuario nao autenticado.';
  end if;

  update public.branches
  set
    slug = nullif(trim(p_slug), ''),
    name = trim(p_name),
    category = coalesce(nullif(trim(p_category), ''), trim(p_name)),
    subcategories = coalesce(p_subcategories, '[]'::jsonb),
    associated_categories = coalesce(p_associated_categories, '[]'::jsonb),
    order_index = coalesce(p_order_index, 0),
    min_rating = coalesce(p_min_rating, 4),
    min_reviews = coalesce(p_min_reviews, 0),
    image_name = coalesce(p_image_name, ''),
    active = coalesce(p_active, true),
    status = coalesce(nullif(trim(p_status), ''), case when p_active then 'Ativo' else 'Inativo' end),
    kind = 'branches',
    data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
      'id', id::text,
      'slug', nullif(trim(p_slug), ''),
      'name', trim(p_name),
      'category', coalesce(nullif(trim(p_category), ''), trim(p_name)),
      'subcategories', coalesce(p_subcategories, '[]'::jsonb),
      'associatedCategories', coalesce(p_associated_categories, '[]'::jsonb),
      'order', coalesce(p_order_index, 0),
      'minRating', coalesce(p_min_rating, 4),
      'minReviews', coalesce(p_min_reviews, 0),
      'imageName', coalesce(p_image_name, ''),
      'imageRequired', coalesce(p_image_required, false),
      'active', coalesce(p_active, true),
      'status', coalesce(nullif(trim(p_status), ''), case when p_active then 'Ativo' else 'Inativo' end),
      'updatedAt', now()
    ),
    updated_at = now()
  where id::text = trim(p_branch_id)
    and user_id::text = v_user_id
  returning * into v_row;

  if not found then
    raise exception 'Ramo nao encontrado para o usuario autenticado. ID: %', p_branch_id;
  end if;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.save_branch_config_v1(text,text,text,text,jsonb,jsonb,integer,numeric,integer,text,boolean,boolean,text) from public;
grant execute on function public.save_branch_config_v1(text,text,text,text,jsonb,jsonb,integer,numeric,integer,text,boolean,boolean,text) to authenticated;

notify pgrst, 'reload schema';

commit;
