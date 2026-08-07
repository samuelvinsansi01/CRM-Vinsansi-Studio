CREATE SCHEMA IF NOT EXISTS realtime;

CREATE SCHEMA IF NOT EXISTS pgbouncer;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_54;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_17;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_33;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_40;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_43;

CREATE SCHEMA IF NOT EXISTS extensions;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_49;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_13;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_22;

CREATE SCHEMA IF NOT EXISTS vault;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_44;

CREATE SCHEMA IF NOT EXISTS graphql_public;

CREATE SCHEMA IF NOT EXISTS graphql;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE SCHEMA IF NOT EXISTS storage;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_48;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_21;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_4;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_28;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_7;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_47;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_20;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_32;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_8;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_2;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_34;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_29;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_55;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_25;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_59;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_27;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_36;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_1;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_50;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_46;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_23;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_6;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_26;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_11;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_38;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_52;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_10;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_42;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_39;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_53;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_3;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_41;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_45;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_16;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_31;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_24;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_58;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_51;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_30;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_14;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_35;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_37;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_18;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_5;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_56;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_12;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_9;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_15;

CREATE SCHEMA IF NOT EXISTS public;

CREATE SCHEMA IF NOT EXISTS pg_toast_temp_19;

CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone,
    ip_address character varying(64) NOT NULL
);

CREATE TABLE auth.custom_oauth_providers (
    id uuid NOT NULL,
    provider_type text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    acceptable_client_ids text[] NOT NULL,
    scopes text[] NOT NULL,
    pkce_enabled boolean NOT NULL,
    attribute_mapping jsonb NOT NULL,
    authorization_params jsonb NOT NULL,
    enabled boolean NOT NULL,
    email_optional boolean NOT NULL,
    issuer text,
    discovery_url text,
    skip_nonce_check boolean NOT NULL,
    cached_discovery jsonb,
    discovery_cached_at timestamp with time zone,
    authorization_url text,
    token_url text,
    userinfo_url text,
    jwks_uri text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    custom_claims_allowlist text[] NOT NULL
);

CREATE TABLE auth.flow_state (
    id uuid NOT NULL,
    user_id uuid,
    auth_code text,
    code_challenge_method auth.code_challenge_method,
    code_challenge text,
    provider_type text NOT NULL,
    provider_access_token text,
    provider_refresh_token text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    authentication_method text NOT NULL,
    auth_code_issued_at timestamp with time zone,
    invite_token text,
    referrer text,
    oauth_client_state_id uuid,
    linking_target_id uuid,
    email_optional boolean NOT NULL
);

CREATE TABLE auth.identities (
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    email text,
    id uuid NOT NULL
);

CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);

CREATE TABLE auth.mfa_amr_claims (
    session_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    authentication_method text NOT NULL,
    id uuid NOT NULL
);

CREATE TABLE auth.mfa_challenges (
    id uuid NOT NULL,
    factor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    ip_address inet NOT NULL,
    otp_code text,
    web_authn_session_data jsonb
);

CREATE TABLE auth.mfa_factors (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    friendly_name text,
    factor_type auth.factor_type NOT NULL,
    status auth.factor_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    secret text,
    phone text,
    last_challenged_at timestamp with time zone,
    web_authn_credential jsonb,
    web_authn_aaguid uuid,
    last_webauthn_challenge_data jsonb
);

CREATE TABLE auth.oauth_authorizations (
    id uuid NOT NULL,
    authorization_id text NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid,
    redirect_uri text NOT NULL,
    scope text NOT NULL,
    state text,
    resource text,
    code_challenge text,
    code_challenge_method auth.code_challenge_method,
    response_type auth.oauth_response_type NOT NULL,
    status auth.oauth_authorization_status NOT NULL,
    authorization_code text,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    approved_at timestamp with time zone,
    nonce text
);

CREATE TABLE auth.oauth_client_states (
    id uuid NOT NULL,
    provider_type text NOT NULL,
    code_verifier text,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE auth.oauth_clients (
    id uuid NOT NULL,
    client_secret_hash text,
    registration_type auth.oauth_registration_type NOT NULL,
    redirect_uris text NOT NULL,
    grant_types text NOT NULL,
    client_name text,
    client_uri text,
    logo_uri text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    client_type auth.oauth_client_type NOT NULL,
    token_endpoint_auth_method text NOT NULL
);

CREATE TABLE auth.oauth_consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    scopes text NOT NULL,
    granted_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone
);

CREATE TABLE auth.one_time_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_type auth.one_time_token_type NOT NULL,
    token_hash text NOT NULL,
    relates_to text NOT NULL,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    parent character varying(255),
    session_id uuid
);

CREATE TABLE auth.saml_providers (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    entity_id text NOT NULL,
    metadata_xml text NOT NULL,
    metadata_url text,
    attribute_mapping jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name_id_format text
);

CREATE TABLE auth.saml_relay_states (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    request_id text NOT NULL,
    for_email text,
    redirect_to text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    flow_state_id uuid
);

CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);

CREATE TABLE auth.sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    factor_id uuid,
    aal auth.aal_level,
    not_after timestamp with time zone,
    refreshed_at timestamp without time zone,
    user_agent text,
    ip inet,
    tag text,
    oauth_client_id uuid,
    refresh_token_hmac_key text,
    refresh_token_counter bigint,
    scopes text
);

CREATE TABLE auth.sso_domains (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);

CREATE TABLE auth.sso_providers (
    id uuid NOT NULL,
    resource_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    disabled boolean
);

CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    email_confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token_new character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone text,
    phone_confirmed_at timestamp with time zone,
    phone_change text,
    phone_change_token character varying(255),
    phone_change_sent_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    email_change_token_current character varying(255),
    email_change_confirm_status smallint,
    banned_until timestamp with time zone,
    reauthentication_token character varying(255),
    reauthentication_sent_at timestamp with time zone,
    is_sso_user boolean NOT NULL,
    deleted_at timestamp with time zone,
    is_anonymous boolean NOT NULL
);

CREATE TABLE auth.webauthn_challenges (
    id uuid NOT NULL,
    user_id uuid,
    challenge_type text NOT NULL,
    session_data jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL
);

CREATE TABLE auth.webauthn_credentials (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    credential_id bytea NOT NULL,
    public_key bytea NOT NULL,
    attestation_type text NOT NULL,
    aaguid uuid,
    sign_count bigint NOT NULL,
    transports jsonb NOT NULL,
    backup_eligible boolean NOT NULL,
    backed_up boolean NOT NULL,
    friendly_name text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    last_used_at timestamp with time zone
);

CREATE TABLE public.apify_accounts (
    apify_accounts_id bigint NOT NULL,
    users_id bigint NOT NULL,
    account_name text NOT NULL,
    token_secret text NOT NULL,
    is_active boolean NOT NULL,
    connection_status text NOT NULL,
    external_username text,
    last_checked_at timestamp with time zone,
    last_used_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.apify_import_jobs (
    apify_import_jobs_id bigint NOT NULL,
    users_id bigint NOT NULL,
    apify_accounts_id bigint,
    apify_job_status_id bigint NOT NULL,
    apify_actor_id text,
    apify_run_id text,
    apify_dataset_id text,
    apify_search_query text,
    apify_search_location text,
    apify_quantity_total integer NOT NULL,
    apify_quantity_created integer NOT NULL,
    apify_quantity_duplicate integer NOT NULL,
    apify_quantity_blocked integer NOT NULL,
    apify_quantity_invalid integer NOT NULL,
    apify_error_message text,
    apify_started_at timestamp with time zone,
    apify_finished_at timestamp with time zone,
    apify_import_jobs_created_at timestamp with time zone NOT NULL,
    apify_import_jobs_updated_at timestamp with time zone NOT NULL,
    actor_id text NOT NULL,
    external_run_id text,
    external_dataset_id text,
    search_query text,
    location_query text,
    requested_limit integer,
    status text NOT NULL,
    total_received integer NOT NULL,
    error_message text,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    search_terms jsonb NOT NULL,
    total_imported integer NOT NULL,
    total_duplicates integer NOT NULL,
    total_rejected integer NOT NULL,
    imported_at timestamp with time zone,
    branches_id bigint,
    branch_name text
);

CREATE TABLE public.backfill_user_map (
    old_user_id uuid NOT NULL,
    new_users_id bigint NOT NULL
);

CREATE TABLE public.branches (
    branches_id bigint NOT NULL,
    users_id bigint NOT NULL,
    status_id bigint NOT NULL,
    branches_name text NOT NULL,
    branches_categories jsonb,
    branches_created_at timestamp with time zone NOT NULL,
    branches_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.channels (
    channels_id bigint NOT NULL,
    channels_name text NOT NULL,
    channels_created_at timestamp with time zone NOT NULL,
    channels_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.chips (
    chips_id bigint NOT NULL,
    users_id bigint NOT NULL,
    instances_id bigint NOT NULL,
    levels_id bigint NOT NULL,
    status_id bigint NOT NULL,
    chips_name text NOT NULL,
    chips_phone text NOT NULL,
    chips_created_at timestamp with time zone NOT NULL,
    chips_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.cities (
    cities_id bigint NOT NULL,
    states_id bigint NOT NULL,
    cities_name text NOT NULL,
    cities_created_at timestamp with time zone NOT NULL,
    cities_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.contact_sources (
    contact_sources_id bigint NOT NULL,
    users_id bigint NOT NULL,
    status_id bigint NOT NULL,
    contact_sources_name text NOT NULL,
    contact_sources_key text NOT NULL,
    contact_sources_requires_review boolean NOT NULL,
    contact_sources_default_channel_id bigint,
    contact_sources_created_at timestamp with time zone NOT NULL,
    contact_sources_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.countries (
    countries_id bigint NOT NULL,
    countries_name text NOT NULL,
    countries_code text NOT NULL,
    countries_created_at timestamp with time zone NOT NULL,
    countries_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.import_rules (
    import_rules_id bigint NOT NULL,
    users_id bigint NOT NULL,
    status_id bigint NOT NULL,
    import_rules_min_rating numeric(2,1),
    import_rules_min_reviews integer,
    import_rules_require_name boolean NOT NULL,
    import_rules_require_phone boolean NOT NULL,
    import_rules_require_instagram boolean NOT NULL,
    import_rules_require_website boolean NOT NULL,
    import_rules_require_any_contact boolean NOT NULL,
    import_rules_deduplicate_phone boolean NOT NULL,
    import_rules_deduplicate_instagram boolean NOT NULL,
    import_rules_deduplicate_website boolean NOT NULL,
    import_rules_deduplicate_maps boolean NOT NULL,
    import_rules_created_at timestamp with time zone NOT NULL,
    import_rules_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.instances (
    instances_id bigint NOT NULL,
    users_id bigint NOT NULL,
    status_id bigint NOT NULL,
    instances_name text NOT NULL,
    instances_url text,
    instances_apikey text,
    instances_created_at timestamp with time zone NOT NULL,
    instances_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.lead_status (
    lead_status_id bigint NOT NULL,
    lead_status_name text NOT NULL,
    lead_status_created_at timestamp with time zone NOT NULL,
    lead_status_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.lead_validation_attempts (
    lead_validation_attempts_id bigint NOT NULL,
    users_id bigint NOT NULL,
    leads_id bigint,
    channels_id bigint NOT NULL,
    chips_id bigint,
    queue_items_id bigint,
    validation_rules_id bigint,
    lead_validation_results_id bigint,
    status_id bigint NOT NULL,
    lead_validation_attempts_input_value text NOT NULL,
    lead_validation_attempts_provider text,
    lead_validation_attempts_provider_reference text,
    lead_validation_attempts_http_status integer,
    lead_validation_attempts_error_code text,
    lead_validation_attempts_error_message text,
    lead_validation_attempts_response_metadata jsonb NOT NULL,
    lead_validation_attempts_rules_snapshot jsonb NOT NULL,
    lead_validation_attempts_started_at timestamp with time zone NOT NULL,
    lead_validation_attempts_finished_at timestamp with time zone,
    lead_validation_attempts_created_at timestamp with time zone NOT NULL,
    lead_validation_attempts_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.lead_validation_results (
    lead_validation_results_id bigint NOT NULL,
    lead_validation_results_key text NOT NULL,
    lead_validation_results_name text NOT NULL,
    status_id bigint NOT NULL,
    lead_validation_results_created_at timestamp with time zone NOT NULL,
    lead_validation_results_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.leads (
    leads_id bigint NOT NULL,
    users_id bigint NOT NULL,
    branches_id bigint NOT NULL,
    countries_id bigint NOT NULL,
    states_id bigint,
    cities_id bigint,
    channels_id bigint,
    lead_status_id bigint NOT NULL,
    apify_import_jobs_id bigint,
    leads_name text NOT NULL,
    leads_phone text,
    leads_instagram text,
    leads_website text,
    leads_maps text,
    leads_street text,
    leads_postal_code text,
    leads_categories text[],
    leads_score numeric(3,2),
    leads_reviews_count integer,
    leads_origin text NOT NULL,
    leads_created_at timestamp with time zone NOT NULL,
    leads_updated_at timestamp with time zone NOT NULL,
    contact_sources_id bigint NOT NULL
);

CREATE TABLE public.leads_backfill_stage (
    user_id text,
    branch_id text,
    branch_name text,
    branch_slug text,
    company_name text,
    title text,
    company text,
    normalized_phone text,
    phone text,
    instagram_username text,
    instagram_url text,
    instagram text,
    website text,
    street text,
    postal_code text,
    city text,
    state text,
    categories text,
    category_name text,
    category text,
    rating text,
    total_score text,
    reviews_count text,
    status text,
    channel text,
    last_channel text,
    origin text,
    raw_payload text,
    data text,
    created_at text,
    updated_at text
);

CREATE TABLE public.leads_migration_stage (
    company_name text,
    phone text,
    instagram text,
    website text,
    maps_url text,
    street text,
    city text,
    state text,
    branch_name text,
    lead_score numeric,
    reviews_count integer,
    categories_pipe text,
    lead_status_name text,
    contact_source_name text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);

CREATE TABLE public.levels (
    levels_id bigint NOT NULL,
    users_id bigint NOT NULL,
    channels_id bigint NOT NULL,
    status_id bigint NOT NULL,
    levels_name text NOT NULL,
    levels_daily_limit integer NOT NULL,
    levels_created_at timestamp with time zone NOT NULL,
    levels_updated_at timestamp with time zone NOT NULL,
    levels_queues integer
);

CREATE TABLE public.queue_items (
    queue_items_id bigint NOT NULL,
    users_id bigint NOT NULL,
    queues_id bigint NOT NULL,
    leads_id bigint NOT NULL,
    chips_id bigint,
    socials_id bigint,
    templates_id bigint,
    status_id bigint NOT NULL,
    queue_items_position integer,
    queue_items_attempts integer NOT NULL,
    queue_items_scheduled_at timestamp with time zone,
    queue_items_started_at timestamp with time zone,
    queue_items_finished_at timestamp with time zone,
    queue_items_error_message text,
    queue_items_created_at timestamp with time zone NOT NULL,
    queue_items_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.queues (
    queues_id bigint NOT NULL,
    users_id bigint NOT NULL,
    channels_id bigint NOT NULL,
    status_id bigint NOT NULL,
    queues_name text NOT NULL,
    queues_scheduled_at timestamp with time zone,
    queues_started_at timestamp with time zone,
    queues_finished_at timestamp with time zone,
    queues_created_at timestamp with time zone NOT NULL,
    queues_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.sents (
    sents_id bigint NOT NULL,
    users_id bigint NOT NULL,
    queue_items_id bigint,
    leads_id bigint,
    channels_id bigint,
    chips_id bigint,
    socials_id bigint,
    templates_id bigint,
    status_id bigint NOT NULL,
    sents_recipient text,
    sents_body text NOT NULL,
    sents_external_id text,
    sents_attempt integer NOT NULL,
    sents_error_message text,
    sents_sent_at timestamp with time zone,
    sents_created_at timestamp with time zone NOT NULL,
    sents_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.socials (
    socials_id bigint NOT NULL,
    users_id bigint NOT NULL,
    status_id bigint NOT NULL,
    levels_id bigint NOT NULL,
    socials_name text NOT NULL,
    socials_username text NOT NULL,
    socials_created_at timestamp with time zone NOT NULL,
    socials_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.states (
    states_id bigint NOT NULL,
    countries_id bigint NOT NULL,
    states_name text NOT NULL,
    states_code text,
    states_created_at timestamp with time zone NOT NULL,
    states_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.status (
    status_id bigint NOT NULL,
    status_name text NOT NULL,
    status_created_at timestamp with time zone NOT NULL,
    status_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.template_channels (
    template_channels_id bigint NOT NULL,
    template_channels_name text NOT NULL,
    template_channels_created_at timestamp with time zone NOT NULL,
    template_channels_updated_at timestamp with time zone NOT NULL,
    users_id bigint NOT NULL,
    status_id bigint NOT NULL,
    template_channels_blocked_channels bigint[] NOT NULL
);

CREATE TABLE public.template_types (
    template_types_id bigint NOT NULL,
    users_id bigint NOT NULL,
    status_id bigint NOT NULL,
    template_types_name text NOT NULL,
    template_types_created_at timestamp with time zone NOT NULL,
    template_types_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.template_variables (
    template_variables_id bigint NOT NULL,
    users_id bigint NOT NULL,
    status_id bigint NOT NULL,
    template_variables_name text NOT NULL,
    template_variables_key text NOT NULL,
    template_variables_source text NOT NULL,
    template_variables_default_value text NOT NULL,
    template_variables_created_at timestamp with time zone NOT NULL,
    template_variables_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.templates (
    templates_id bigint NOT NULL,
    users_id bigint NOT NULL,
    branches_id bigint NOT NULL,
    status_id bigint NOT NULL,
    templates_name text NOT NULL,
    templates_message_1 text NOT NULL,
    templates_message_2 text NOT NULL,
    templates_message_3 text NOT NULL,
    templates_message_4 text NOT NULL,
    templates_created_at timestamp with time zone NOT NULL,
    templates_updated_at timestamp with time zone NOT NULL,
    template_channels_id bigint NOT NULL,
    template_types_id bigint NOT NULL
);

CREATE TABLE public.users (
    users_id bigint NOT NULL,
    auth_user_id uuid NOT NULL,
    status_id bigint NOT NULL,
    users_created_at timestamp with time zone NOT NULL,
    users_updated_at timestamp with time zone NOT NULL,
    users_name text,
    users_avatar_path text
);

CREATE TABLE public.validation_rules (
    validation_rules_id bigint NOT NULL,
    users_id bigint NOT NULL,
    status_id bigint NOT NULL,
    validation_rules_source_id bigint NOT NULL,
    validation_rules_channel_id bigint NOT NULL,
    validation_rules_fallback_channel_id bigint NOT NULL,
    validation_rules_instagram_requires_approval boolean NOT NULL,
    validation_rules_max_technical_attempts integer NOT NULL,
    validation_rules_created_at timestamp with time zone NOT NULL,
    validation_rules_updated_at timestamp with time zone NOT NULL
);

CREATE TABLE realtime.schema_migrations (
    version bigint NOT NULL,
    inserted_at timestamp(0) without time zone
);

CREATE TABLE realtime.subscription (
    id bigint NOT NULL,
    subscription_id uuid NOT NULL,
    entity regclass NOT NULL,
    filters realtime.user_defined_filter[] NOT NULL,
    claims jsonb NOT NULL,
    claims_role regrole NOT NULL,
    created_at timestamp without time zone NOT NULL,
    action_filter text,
    selected_columns text[]
);

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    public boolean,
    avif_autodetection boolean,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text,
    type storage.buckettype NOT NULL
);

CREATE TABLE storage.buckets_analytics (
    name text NOT NULL,
    type storage.buckettype NOT NULL,
    format text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    id uuid NOT NULL,
    deleted_at timestamp with time zone
);

CREATE TABLE storage.buckets_vectors (
    id text NOT NULL,
    type storage.buckettype NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE storage.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone
);

CREATE TABLE storage.objects (
    id uuid NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    last_accessed_at timestamp with time zone,
    metadata jsonb,
    path_tokens text[],
    version text,
    owner_id text,
    user_metadata jsonb
);

CREATE TABLE storage.s3_multipart_uploads (
    id text NOT NULL,
    in_progress_size bigint NOT NULL,
    upload_signature text NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL,
    version text NOT NULL,
    owner_id text,
    created_at timestamp with time zone NOT NULL,
    user_metadata jsonb,
    metadata jsonb
);

CREATE TABLE storage.s3_multipart_uploads_parts (
    id uuid NOT NULL,
    upload_id text NOT NULL,
    size bigint NOT NULL,
    part_number integer NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL,
    etag text NOT NULL,
    owner_id text,
    version text NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE storage.vector_indexes (
    id text NOT NULL,
    name text NOT NULL,
    bucket_id text NOT NULL,
    data_type text NOT NULL,
    dimension integer NOT NULL,
    distance_metric text NOT NULL,
    metadata_configuration jsonb,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE vault.secrets (
    id uuid NOT NULL,
    name text,
    description text NOT NULL,
    secret text NOT NULL,
    key_id uuid,
    nonce bytea,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TYPE auth.aal_level AS ENUM ('aal1', 'aal2', 'aal3');

CREATE TYPE auth.code_challenge_method AS ENUM ('s256', 'plain');

CREATE TYPE auth.factor_status AS ENUM ('unverified', 'verified');

CREATE TYPE auth.factor_type AS ENUM ('totp', 'webauthn', 'phone');

CREATE TYPE auth.oauth_authorization_status AS ENUM ('pending', 'approved', 'denied', 'expired');

CREATE TYPE auth.oauth_client_type AS ENUM ('public', 'confidential');

CREATE TYPE auth.oauth_registration_type AS ENUM ('dynamic', 'manual');

CREATE TYPE auth.oauth_response_type AS ENUM ('code');

CREATE TYPE auth.one_time_token_type AS ENUM ('confirmation_token', 'reauthentication_token', 'recovery_token', 'email_change_token_new', 'email_change_token_current', 'phone_change_token');

CREATE TYPE realtime.action AS ENUM ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'ERROR');

CREATE TYPE realtime.equality_op AS ENUM ('eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'like', 'ilike', 'is', 'match', 'imatch', 'isdistinct');

CREATE TYPE storage.buckettype AS ENUM ('STANDARD', 'ANALYTICS', 'VECTOR');

CREATE OR REPLACE FUNCTION extensions.uuid_generate_v1()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v1$function$


CREATE OR REPLACE FUNCTION extensions.uuid_generate_v1mc()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v1mc$function$


CREATE OR REPLACE FUNCTION extensions.uuid_generate_v3(namespace uuid, name text)
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v3$function$


CREATE OR REPLACE FUNCTION extensions.uuid_generate_v4()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v4$function$


CREATE OR REPLACE FUNCTION extensions.uuid_generate_v5(namespace uuid, name text)
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_generate_v5$function$


CREATE OR REPLACE FUNCTION extensions.digest(text, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_digest$function$


CREATE OR REPLACE FUNCTION extensions.digest(bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_digest$function$


CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$


CREATE OR REPLACE FUNCTION auth.role()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$


CREATE OR REPLACE FUNCTION auth.email()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$function$


CREATE OR REPLACE FUNCTION extensions.uuid_nil()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_nil$function$


CREATE OR REPLACE FUNCTION extensions.uuid_ns_dns()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_dns$function$


CREATE OR REPLACE FUNCTION extensions.uuid_ns_url()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_url$function$


CREATE OR REPLACE FUNCTION extensions.uuid_ns_oid()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_oid$function$


CREATE OR REPLACE FUNCTION extensions.uuid_ns_x500()
 RETURNS uuid
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/uuid-ossp', $function$uuid_ns_x500$function$


CREATE OR REPLACE FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_decrypt_bytea$function$


CREATE OR REPLACE FUNCTION extensions.pgp_sym_decrypt(bytea, text, text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_decrypt_text$function$


CREATE OR REPLACE FUNCTION extensions.encrypt_iv(bytea, bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_encrypt_iv$function$


CREATE OR REPLACE FUNCTION extensions.decrypt_iv(bytea, bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_decrypt_iv$function$


CREATE OR REPLACE FUNCTION extensions.gen_random_bytes(integer)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_random_bytes$function$


CREATE OR REPLACE FUNCTION extensions.gen_random_uuid()
 RETURNS uuid
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/pgcrypto', $function$pg_random_uuid$function$


CREATE OR REPLACE FUNCTION extensions.pgp_sym_encrypt(text, text)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_encrypt_text$function$


CREATE OR REPLACE FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_encrypt_bytea$function$


CREATE OR REPLACE FUNCTION extensions.pgp_sym_encrypt(text, text, text)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_encrypt_text$function$


CREATE OR REPLACE FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text, text)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_encrypt_bytea$function$


CREATE OR REPLACE FUNCTION extensions.pgp_sym_decrypt(bytea, text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_decrypt_text$function$


CREATE OR REPLACE FUNCTION extensions.hmac(text, text, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_hmac$function$


CREATE OR REPLACE FUNCTION extensions.hmac(bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_hmac$function$


CREATE OR REPLACE FUNCTION extensions.pgp_pub_encrypt(text, bytea)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_encrypt_text$function$


CREATE OR REPLACE FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_decrypt_text$function$


CREATE OR REPLACE FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_decrypt_bytea$function$


CREATE OR REPLACE FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text, text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_decrypt_text$function$


CREATE OR REPLACE FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_decrypt_bytea$function$


CREATE OR REPLACE FUNCTION extensions.pgp_key_id(bytea)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_key_id_w$function$


CREATE OR REPLACE FUNCTION extensions.armor(bytea)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_armor$function$


CREATE OR REPLACE FUNCTION extensions.armor(bytea, text[], text[])
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_armor$function$


CREATE OR REPLACE FUNCTION extensions.dearmor(text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_dearmor$function$


CREATE OR REPLACE FUNCTION extensions.pgrst_drop_watch()
 RETURNS event_trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $function$


CREATE OR REPLACE FUNCTION extensions.pgp_armor_headers(text, OUT key text, OUT value text)
 RETURNS SETOF record
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_armor_headers$function$


CREATE OR REPLACE FUNCTION extensions.pg_stat_statements_info(OUT dealloc bigint, OUT stats_reset timestamp with time zone)
 RETURNS record
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pg_stat_statements', $function$pg_stat_statements_info$function$


CREATE OR REPLACE FUNCTION extensions.pgrst_ddl_watch()
 RETURNS event_trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $function$


CREATE OR REPLACE FUNCTION extensions.grant_pg_graphql_access()
 RETURNS event_trigger
 LANGUAGE plpgsql
AS $function$
begin
    if not exists (
        select 1
        from pg_event_trigger_ddl_commands() ev
        join pg_catalog.pg_extension e on ev.objid = e.oid
        where e.extname = 'pg_graphql'
    ) then
        return;
    end if;

    drop function if exists graphql_public.graphql;
    create or replace function graphql_public.graphql(
        "operationName" text default null,
        query text default null,
        variables jsonb default null,
        extensions jsonb default null
    )
        returns jsonb
        language sql
    as $$
        select graphql.resolve(
            query := query,
            variables := coalesce(variables, '{}'),
            "operationName" := "operationName",
            extensions := extensions
        );
    $$;

    -- Attach the wrapper to the extension so DROP EXTENSION cascades to it,
    -- which in turn triggers set_graphql_placeholder to reinstall the "not enabled" stub.
    alter extension pg_graphql add function graphql_public.graphql(text, text, jsonb, jsonb);

    grant usage on schema graphql to postgres, anon, authenticated, service_role;
    grant execute on function graphql.resolve to postgres, anon, authenticated, service_role;
    grant usage on schema graphql to postgres with grant option;
    grant usage on schema graphql_public to postgres with grant option;
end;
$function$


CREATE OR REPLACE FUNCTION vault._crypto_aead_det_noncegen()
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE
AS '$libdir/supabase_vault', $function$pgsodium_crypto_aead_det_noncegen$function$


CREATE OR REPLACE FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[])
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
    select
        filters is null
        or array_length(filters, 1) is null
        or coalesce(
            count(col.name) = count(1)
            and sum(
                realtime.check_equality_op(
                    op:=f.op,
                    type_:=coalesce(col.type_oid::regtype, col.type_name::regtype),
                    val_1:=col.value #>> '{}',
                    val_2:=f.value,
                    negate:=coalesce(f.negate, false)
                )::int
            ) filter (where col.name is not null) = count(col.name),
            false
        )
    from
        unnest(filters) f
        left join unnest(columns) col
            on f.column_name = col.name;
$function$


CREATE OR REPLACE FUNCTION vault._crypto_aead_det_encrypt(message bytea, additional bytea, key_id bigint, context bytea DEFAULT '\x7067736f6469756d'::bytea, nonce bytea DEFAULT NULL::bytea)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE
AS '$libdir/supabase_vault', $function$pgsodium_crypto_aead_det_encrypt_by_id$function$


CREATE OR REPLACE FUNCTION realtime.subscription_check_filters()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
    col_names text[] = coalesce(
            array_agg(a.attname order by a.attnum),
            '{}'::text[]
        )
        from
            pg_catalog.pg_attribute a
        where
            a.attrelid = new.entity
            and a.attnum > 0
            and not a.attisdropped
            and pg_catalog.has_column_privilege(
                (new.claims ->> 'role'),
                a.attrelid,
                a.attnum,
                'SELECT'
            );
    filter realtime.user_defined_filter;
    col_type regtype;
    in_val jsonb;
    selected_col text;
begin
    for filter in select * from unnest(new.filters) loop
        if not filter.column_name = any(col_names) then
            raise exception 'invalid column for filter %', filter.column_name;
        end if;

        col_type = (
            select atttypid::regtype
            from pg_catalog.pg_attribute
            where attrelid = new.entity
                  and attname = filter.column_name
        );
        if col_type is null then
            raise exception 'failed to lookup type for column %', filter.column_name;
        end if;

        if filter.op = 'in'::realtime.equality_op then
            in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
            if coalesce(jsonb_array_length(in_val), 0) > 100 then
                raise exception 'too many values for `in` filter. Maximum 100';
            end if;
        elsif filter.op = 'is'::realtime.equality_op then
            -- `is` requires a keyword RHS rather than a typed literal
            if filter.value not in ('null', 'true', 'false', 'unknown') then
                raise exception 'invalid value for is filter: must be null, true, false, or unknown';
            end if;
            -- IS NULL works for any type, but IS TRUE/FALSE/UNKNOWN require a boolean
            -- operand. Reject the non-null keywords on non-boolean columns here so they
            -- don't abort apply_rls at WAL time.
            if filter.value <> 'null' and col_type <> 'boolean'::regtype then
                raise exception 'is % filter requires a boolean column, got %', filter.value, col_type::text;
            end if;
        elsif filter.op in ('like'::realtime.equality_op, 'ilike'::realtime.equality_op) then
            -- like/ilike apply the text pattern operator (~~); reject column types that
            -- have no such operator instead of failing at WAL time
            if not exists (
                select 1 from pg_catalog.pg_operator
                where oprname = '~~' and oprleft = col_type
            ) then
                raise exception 'operator % requires a text-compatible column type, got %', filter.op::text, col_type::text;
            end if;
        elsif filter.op in ('match'::realtime.equality_op, 'imatch'::realtime.equality_op) then
            -- match/imatch apply the regex operators ~ / ~*; reject column types that have
            -- no such operator (e.g. integer) instead of failing at WAL time, mirroring the
            -- like/ilike guard above.
            if not exists (
                select 1 from pg_catalog.pg_operator
                where oprname = case when filter.op = 'imatch'::realtime.equality_op then '~*' else '~' end
                  and oprleft = col_type
                  and oprright = col_type
                  and oprresult = 'boolean'::regtype
            ) then
                raise exception 'operator % requires a text-compatible column type, got %', filter.op::text, col_type::text;
            end if;
            -- validate the regex eagerly so a bad pattern is rejected here, not inside
            -- apply_rls where it would abort the WAL stream for the entity
            begin
                perform '' ~ filter.value;
            exception when others then
                raise exception 'invalid regular expression for % filter: %', filter.op::text, sqlerrm;
            end;
        else
            -- eq/neq/lt/lte/gt/gte: value must be coercable to the type
            perform realtime.cast(filter.value, col_type);
        end if;
    end loop;

    if new.selected_columns is not null then
        for selected_col in select * from unnest(new.selected_columns) loop
            if not selected_col = any(col_names) then
                raise exception 'invalid column for select %', selected_col;
            end if;
        end loop;
    end if;

    -- Apply consistent order to filters so the unique constraint can't be tricked by a
    -- different filter order. negate is part of the sort key.
    new.filters = coalesce(
        array_agg(f order by f.column_name, f.op, f.value, f.negate),
        '{}'
    ) from unnest(new.filters) f;

    new.selected_columns = (
        select array_agg(c order by c)
        from unnest(new.selected_columns) c
    );

    return new;
end;
$function$


CREATE OR REPLACE FUNCTION realtime.to_regrole(role_name text)
 RETURNS regrole
 LANGUAGE sql
 IMMUTABLE
AS $function$ select role_name::regrole $function$


CREATE OR REPLACE FUNCTION realtime.topic()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
select nullif(current_setting('realtime.topic', true), '')::text;
$function$


CREATE OR REPLACE FUNCTION realtime.wal2json_escape_identifier(name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
AS $function$
  -- Prefix `\`, `,`, `.`, and any whitespace with `\`
  SELECT regexp_replace(name, '([\\,.[:space:]])', '\\\1', 'g')
$function$


CREATE OR REPLACE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL::text, new_description text DEFAULT ''::text, new_key_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  rec record;
BEGIN
  INSERT INTO vault.secrets (secret, name, description)
  VALUES (
    new_secret,
    new_name,
    new_description
  )
  RETURNING * INTO rec;
  UPDATE vault.secrets s
  SET secret = encode(vault._crypto_aead_det_encrypt(
    message := convert_to(rec.secret, 'utf8'),
    additional := convert_to(s.id::text, 'utf8'),
    key_id := 0,
    context := 'pgsodium'::bytea,
    nonce := rec.nonce
  ), 'base64')
  WHERE id = rec.id;
  RETURN rec.id;
END
$function$


CREATE OR REPLACE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL::text, new_name text DEFAULT NULL::text, new_description text DEFAULT NULL::text, new_key_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  decrypted_secret text := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = secret_id);
BEGIN
  UPDATE vault.secrets s
  SET
    secret = CASE WHEN new_secret IS NULL THEN s.secret
                  ELSE encode(vault._crypto_aead_det_encrypt(
                    message := convert_to(new_secret, 'utf8'),
                    additional := convert_to(s.id::text, 'utf8'),
                    key_id := 0,
                    context := 'pgsodium'::bytea,
                    nonce := s.nonce
                  ), 'base64') END,
    name = coalesce(new_name, s.name),
    description = coalesce(new_description, s.description),
    updated_at = now()
  WHERE s.id = secret_id;
END
$function$


CREATE OR REPLACE FUNCTION vault._crypto_aead_det_decrypt(message bytea, additional bytea, key_id bigint, context bytea DEFAULT '\x7067736f6469756d'::bytea, nonce bytea DEFAULT NULL::bytea)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE
AS '$libdir/supabase_vault', $function$pgsodium_crypto_aead_det_decrypt_by_id$function$


CREATE OR REPLACE FUNCTION extensions.pg_stat_statements_reset(userid oid DEFAULT 0, dbid oid DEFAULT 0, queryid bigint DEFAULT 0, minmax_only boolean DEFAULT false)
 RETURNS timestamp with time zone
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pg_stat_statements', $function$pg_stat_statements_reset_1_11$function$


CREATE OR REPLACE FUNCTION extensions.crypt(text, text)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_crypt$function$


CREATE OR REPLACE FUNCTION extensions.gen_salt(text)
 RETURNS text
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_gen_salt$function$


CREATE OR REPLACE FUNCTION extensions.gen_salt(text, integer)
 RETURNS text
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_gen_salt_rounds$function$


CREATE OR REPLACE FUNCTION extensions.encrypt(bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_encrypt$function$


CREATE OR REPLACE FUNCTION extensions.decrypt(bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pg_decrypt$function$


CREATE OR REPLACE FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text, text)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_sym_decrypt_bytea$function$


CREATE OR REPLACE FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_encrypt_bytea$function$


CREATE OR REPLACE FUNCTION extensions.pgp_pub_encrypt(text, bytea, text)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_encrypt_text$function$


CREATE OR REPLACE FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea, text)
 RETURNS bytea
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_encrypt_bytea$function$


CREATE OR REPLACE FUNCTION extensions.pgp_pub_decrypt(bytea, bytea)
 RETURNS text
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_decrypt_text$function$


CREATE OR REPLACE FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea)
 RETURNS bytea
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pgcrypto', $function$pgp_pub_decrypt_bytea$function$


CREATE OR REPLACE FUNCTION extensions.pg_stat_statements(showtext boolean, OUT userid oid, OUT dbid oid, OUT toplevel boolean, OUT queryid bigint, OUT query text, OUT plans bigint, OUT total_plan_time double precision, OUT min_plan_time double precision, OUT max_plan_time double precision, OUT mean_plan_time double precision, OUT stddev_plan_time double precision, OUT calls bigint, OUT total_exec_time double precision, OUT min_exec_time double precision, OUT max_exec_time double precision, OUT mean_exec_time double precision, OUT stddev_exec_time double precision, OUT rows bigint, OUT shared_blks_hit bigint, OUT shared_blks_read bigint, OUT shared_blks_dirtied bigint, OUT shared_blks_written bigint, OUT local_blks_hit bigint, OUT local_blks_read bigint, OUT local_blks_dirtied bigint, OUT local_blks_written bigint, OUT temp_blks_read bigint, OUT temp_blks_written bigint, OUT shared_blk_read_time double precision, OUT shared_blk_write_time double precision, OUT local_blk_read_time double precision, OUT local_blk_write_time double precision, OUT temp_blk_read_time double precision, OUT temp_blk_write_time double precision, OUT wal_records bigint, OUT wal_fpi bigint, OUT wal_bytes numeric, OUT jit_functions bigint, OUT jit_generation_time double precision, OUT jit_inlining_count bigint, OUT jit_inlining_time double precision, OUT jit_optimization_count bigint, OUT jit_optimization_time double precision, OUT jit_emission_count bigint, OUT jit_emission_time double precision, OUT jit_deform_count bigint, OUT jit_deform_time double precision, OUT stats_since timestamp with time zone, OUT minmax_stats_since timestamp with time zone)
 RETURNS SETOF record
 LANGUAGE c
 PARALLEL SAFE STRICT
AS '$libdir/pg_stat_statements', $function$pg_stat_statements_1_11$function$


CREATE OR REPLACE FUNCTION extensions.set_graphql_placeholder()
 RETURNS event_trigger
 LANGUAGE plpgsql
AS $function$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$function$


CREATE OR REPLACE FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer DEFAULT (1024 * 1024))
 RETURNS SETOF realtime.wal_rls
 LANGUAGE plpgsql
AS $function$
declare
    -- Regclass of the table e.g. public.notes
    entity_ regclass = (quote_ident(wal ->> 'schema') || '.' || quote_ident(wal ->> 'table'))::regclass;

    -- I, U, D, T: insert, update ...
    action realtime.action = (
        case wal ->> 'action'
            when 'I' then 'INSERT'
            when 'U' then 'UPDATE'
            when 'D' then 'DELETE'
            else 'ERROR'
        end
    );

    -- Is row level security enabled for the table
    is_rls_enabled bool = relrowsecurity from pg_class where oid = entity_;

    subscriptions realtime.subscription[] = array_agg(subs)
        from
            realtime.subscription subs
        where
            subs.entity = entity_
            -- Filter by action early - only get subscriptions interested in this action
            -- action_filter column can be: '*' (all), 'INSERT', 'UPDATE', or 'DELETE'
            and (subs.action_filter = '*' or subs.action_filter = action::text);

    -- Subscription vars
    working_role regrole;
    working_selected_columns text[];
    claimed_role regrole;
    claims jsonb;

    subscription_id uuid;
    subscription_has_access bool;
    visible_to_subscription_ids uuid[] = '{}';

    -- structured info for wal's columns
    columns realtime.wal_column[];
    -- previous identity values for update/delete
    old_columns realtime.wal_column[];

    error_record_exceeds_max_size boolean = octet_length(wal::text) > max_record_bytes;

    -- Primary jsonb output for record
    output jsonb;

    -- Loop record for iterating unique roles (outer loop)
    role_record record;
    -- Loop record for iterating unique selected_columns within a role (inner loop)
    cols_record record;
    -- Subscription ids visible at the role level (before fanning out by selected_columns)
    visible_role_sub_ids uuid[] = '{}';

begin
    perform set_config('role', null, true);

    columns =
        array_agg(
            (
                x->>'name',
                x->>'type',
                x->>'typeoid',
                realtime.cast(
                    (x->'value') #>> '{}',
                    coalesce(
                        (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                        (x->>'type')::regtype
                    )
                ),
                (pks ->> 'name') is not null,
                true
            )::realtime.wal_column
        )
        from
            jsonb_array_elements(wal -> 'columns') x
            left join jsonb_array_elements(wal -> 'pk') pks
                on (x ->> 'name') = (pks ->> 'name');

    old_columns =
        array_agg(
            (
                x->>'name',
                x->>'type',
                x->>'typeoid',
                realtime.cast(
                    (x->'value') #>> '{}',
                    coalesce(
                        (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                        (x->>'type')::regtype
                    )
                ),
                (pks ->> 'name') is not null,
                true
            )::realtime.wal_column
        )
        from
            jsonb_array_elements(wal -> 'identity') x
            left join jsonb_array_elements(wal -> 'pk') pks
                on (x ->> 'name') = (pks ->> 'name');

    for role_record in
        select claims_role
        from (select distinct claims_role from unnest(subscriptions)) t
        order by claims_role::text
    loop
        working_role := role_record.claims_role;

        -- Update `is_selectable` for columns and old_columns (once per role)
        columns =
            array_agg(
                (
                    c.name,
                    c.type_name,
                    c.type_oid,
                    c.value,
                    c.is_pkey,
                    pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                )::realtime.wal_column
            )
            from
                unnest(columns) c;

        old_columns =
                array_agg(
                    (
                        c.name,
                        c.type_name,
                        c.type_oid,
                        c.value,
                        c.is_pkey,
                        pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                    )::realtime.wal_column
                )
                from
                    unnest(old_columns) c;

        if action <> 'DELETE' and count(1) = 0 from unnest(columns) c where c.is_pkey then
            -- Fan out 400 error per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;
                return next (
                    jsonb_build_object(
                        'schema', wal ->> 'schema',
                        'table', wal ->> 'table',
                        'type', action
                    ),
                    is_rls_enabled,
                    (select array_agg(s.subscription_id) from unnest(subscriptions) as s where s.claims_role = working_role and (s.selected_columns is not distinct from working_selected_columns)),
                    array['Error 400: Bad Request, no primary key']
                )::realtime.wal_rls;
            end loop;

        -- The claims role does not have SELECT permission to the primary key of entity
        elsif action <> 'DELETE' and sum(c.is_selectable::int) <> count(1) from unnest(columns) c where c.is_pkey then
            -- Fan out 401 error per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;
                return next (
                    jsonb_build_object(
                        'schema', wal ->> 'schema',
                        'table', wal ->> 'table',
                        'type', action
                    ),
                    is_rls_enabled,
                    (select array_agg(s.subscription_id) from unnest(subscriptions) as s where s.claims_role = working_role and (s.selected_columns is not distinct from working_selected_columns)),
                    array['Error 401: Unauthorized']
                )::realtime.wal_rls;
            end loop;

        else
            -- Create the prepared statement (once per role)
            if is_rls_enabled and action <> 'DELETE' then
                if (select 1 from pg_prepared_statements where name = 'walrus_rls_stmt' limit 1) > 0 then
                    deallocate walrus_rls_stmt;
                end if;
                execute realtime.build_prepared_statement_sql('walrus_rls_stmt', entity_, columns);
            end if;

            -- Collect all visible subscription IDs for this role (filter check + RLS check)
            visible_role_sub_ids = '{}';

            for subscription_id, claims in (
                    select
                        subs.subscription_id,
                        subs.claims
                    from
                        unnest(subscriptions) subs
                    where
                        subs.entity = entity_
                        and subs.claims_role = working_role
                        and (
                            realtime.is_visible_through_filters(columns, subs.filters)
                            or (
                              action = 'DELETE'
                              and realtime.is_visible_through_filters(old_columns, subs.filters)
                            )
                        )
            ) loop

                if not is_rls_enabled or action = 'DELETE' then
                    visible_role_sub_ids = visible_role_sub_ids || subscription_id;
                else
                    -- Check if RLS allows the role to see the record
                    perform
                        -- Trim leading and trailing quotes from working_role because set_config
                        -- doesn't recognize the role as valid if they are included
                        set_config('role', trim(both '"' from working_role::text), true),
                        set_config('request.jwt.claims', claims::text, true);

                    execute 'execute walrus_rls_stmt' into subscription_has_access;

                    -- Reset the role on every FOR..LOOP batch execution.
                    -- The first batch of 10 rows is pre-fetched using the current connection role (PG internal behaviour)
                    -- then we have to reset it again otherwise it would use the role defined in the `set_config` above
                    -- to fetch the remaining rows when rows>10, which could be a user-defined role that lacks execution grants.
                    -- The flow is:
                    --   1. run batch with conn role
                    --   2. set_config working_role
                    --   3. execute walrus
                    --   4. reset role (revert)
                    --   5. repeat
                    perform set_config('role', null, true);

                    if subscription_has_access then
                        visible_role_sub_ids = visible_role_sub_ids || subscription_id;
                    end if;
                end if;
            end loop;

            perform set_config('role', null, true);

            -- Inner loop: per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;

                output = jsonb_build_object(
                    'schema', wal ->> 'schema',
                    'table', wal ->> 'table',
                    'type', action,
                    'commit_timestamp', to_char(
                        ((wal ->> 'timestamp')::timestamptz at time zone 'utc'),
                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                    ),
                    'columns', (
                        select
                            jsonb_agg(
                                jsonb_build_object(
                                    'name', pa.attname,
                                    'type', pt.typname
                                )
                                order by pa.attnum asc
                            )
                        from
                            pg_attribute pa
                            join pg_type pt
                                on pa.atttypid = pt.oid
                            left join (
                                select unnest(conkey) as pkey_attnum
                                from pg_constraint
                                where conrelid = entity_ and contype = 'p'
                            ) pk on pk.pkey_attnum = pa.attnum
                        where
                            attrelid = entity_
                            and attnum > 0
                            and pg_catalog.has_column_privilege(working_role, entity_, pa.attname, 'SELECT')
                            and (working_selected_columns is null or pa.attname = any(working_selected_columns) or pk.pkey_attnum is not null)
                    )
                )
                -- Add "record" key for insert and update
                || case
                    when action in ('INSERT', 'UPDATE') then
                        jsonb_build_object(
                            'record',
                            (
                                select
                                    jsonb_object_agg(
                                        -- if unchanged toast, get column name and value from old record
                                        coalesce((c).name, (oc).name),
                                        case
                                            when (c).name is null then (oc).value
                                            else (c).value
                                        end
                                    )
                                from
                                    unnest(columns) c
                                    full outer join unnest(old_columns) oc
                                        on (c).name = (oc).name
                                where
                                    coalesce((c).is_selectable, (oc).is_selectable)
                                    and (working_selected_columns is null or coalesce((c).name, (oc).name) = any(working_selected_columns) or coalesce((c).is_pkey, (oc).is_pkey))
                                    and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                            )
                        )
                    else '{}'::jsonb
                end
                -- Add "old_record" key for update and delete
                || case
                    when action = 'UPDATE' then
                        jsonb_build_object(
                                'old_record',
                                (
                                    select jsonb_object_agg((c).name, (c).value)
                                    from unnest(old_columns) c
                                    where
                                        (c).is_selectable
                                        and (working_selected_columns is null or (c).name = any(working_selected_columns) or (c).is_pkey)
                                        and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                                )
                            )
                    when action = 'DELETE' then
                        jsonb_build_object(
                            'old_record',
                            (
                                select jsonb_object_agg((c).name, (c).value)
                                from unnest(old_columns) c
                                where
                                    (c).is_selectable
                                    and (working_selected_columns is null or (c).name = any(working_selected_columns) or (c).is_pkey)
                                    and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                                    and ( not is_rls_enabled or (c).is_pkey ) -- if RLS enabled, we can't secure deletes so filter to pkey
                            )
                        )
                    else '{}'::jsonb
                end;

                -- Filter visible_role_sub_ids to those matching the current selected_columns group
                visible_to_subscription_ids = coalesce(
                    (
                        select array_agg(s.subscription_id)
                        from unnest(subscriptions) s
                        where s.claims_role = working_role
                          and (s.selected_columns is not distinct from working_selected_columns)
                          and s.subscription_id = any(visible_role_sub_ids)
                    ),
                    '{}'::uuid[]
                );

                return next (
                    output,
                    is_rls_enabled,
                    visible_to_subscription_ids,
                    case
                        when error_record_exceeds_max_size then array['Error 413: Payload Too Large']
                        else '{}'
                    end
                )::realtime.wal_rls;
            end loop;

        end if;
    end loop;

    perform set_config('role', null, true);
end;
$function$


CREATE OR REPLACE FUNCTION extensions.grant_pg_cron_access()
 RETURNS event_trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION extensions.grant_pg_net_access()
 RETURNS event_trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;

    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    IF EXISTS (
      SELECT FROM pg_extension
      WHERE extname = 'pg_net'
      -- all versions in use on existing projects as of 2025-02-20
      -- version 0.12.0 onwards don't need these applied
      AND extversion IN ('0.2', '0.6', '0.7', '0.7.1', '0.8', '0.10.0', '0.11.0')
    ) THEN
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION pgbouncer.get_auth(p_usename text)
 RETURNS TABLE(username text, password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  BEGIN
      RAISE DEBUG 'PgBouncer auth request: %', p_usename;

      RETURN QUERY
      SELECT
          rolname::text,
          CASE WHEN rolvaliduntil < now()
              THEN null
              ELSE rolpassword::text
          END
      FROM pg_authid
      WHERE rolname=$1 and rolcanlogin;
  END;
  $function$


CREATE OR REPLACE FUNCTION graphql_public.graphql("operationName" text DEFAULT NULL::text, query text DEFAULT NULL::text, variables jsonb DEFAULT NULL::jsonb, extensions jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $function$


CREATE OR REPLACE FUNCTION auth.jwt()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$function$


CREATE OR REPLACE FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text DEFAULT 'ROW'::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    -- Declare a variable to hold the JSONB representation of the row
    row_data jsonb := '{}'::jsonb;
BEGIN
    IF level = 'STATEMENT' THEN
        RAISE EXCEPTION 'function can only be triggered for each row, not for each statement';
    END IF;
    -- Check the operation type and handle accordingly
    IF operation = 'INSERT' OR operation = 'UPDATE' OR operation = 'DELETE' THEN
        row_data := jsonb_build_object('old_record', OLD, 'record', NEW, 'operation', operation, 'table', table_name, 'schema', table_schema);
        PERFORM realtime.send (row_data, event_name, topic_name);
    ELSE
        RAISE EXCEPTION 'Unexpected operation type: %', operation;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to process the row: %', SQLERRM;
END;

$function$


CREATE OR REPLACE FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[])
 RETURNS text
 LANGUAGE sql
AS $function$
      /*
      Builds a sql string that, if executed, creates a prepared statement to
      tests retrive a row from *entity* by its primary key columns.
      Example
          select realtime.build_prepared_statement_sql('public.notes', '{"id"}'::text[], '{"bigint"}'::text[])
      */
          select
      'prepare ' || prepared_statement_name || ' as
          select
              exists(
                  select
                      1
                  from
                      ' || entity || '
                  where
                      ' || string_agg(quote_ident(pkc.name) || '=' || quote_nullable(pkc.value #>> '{}') , ' and ') || '
              )'
          from
              unnest(columns) pkc
          where
              pkc.is_pkey
          group by
              entity
      $function$


CREATE OR REPLACE FUNCTION realtime."cast"(val text, type_ regtype)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  res jsonb;
begin
  if type_::text = 'bytea' then
    return to_jsonb(val);
  end if;
  execute format('select to_jsonb(%L::'|| type_::text || ')', val) into res;
  return res;
end
$function$


CREATE OR REPLACE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
/*
Casts *val_1* and *val_2* as type *type_* and check the *op* condition for truthiness
*/
declare
    op_symbol text = (
        case
            when op = 'eq' then '='
            when op = 'neq' then '!='
            when op = 'lt' then '<'
            when op = 'lte' then '<='
            when op = 'gt' then '>'
            when op = 'gte' then '>='
            when op = 'in' then '= any'
            else 'UNKNOWN OP'
        end
    );
    res boolean;
begin
    execute format(
        'select %L::'|| type_::text || ' ' || op_symbol
        || ' ( %L::'
        || (
            case
                when op = 'in' then type_::text || '[]'
                else type_::text end
        )
        || ')', val_1, val_2) into res;
    return res;
end;
$function$


CREATE OR REPLACE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text, negate boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
    op_symbol text;
    res boolean;
begin
    -- IS DISTINCT FROM / IS NOT DISTINCT FROM: infix, both sides typed literals
    if op = 'isdistinct' then
        execute format(
            'select %L::%s %s %L::%s',
            val_1,
            type_::text,
            case when negate then 'IS NOT DISTINCT FROM' else 'IS DISTINCT FROM' end,
            val_2,
            type_::text
        ) into res;
        return res;
    end if;

    -- IS requires a keyword RHS (NULL, TRUE, FALSE, UNKNOWN), not a typed literal
    if op = 'is' then
        if val_2 not in ('null', 'true', 'false', 'unknown') then
            raise exception 'invalid value for is filter: must be null, true, false, or unknown';
        end if;
        execute format(
            'select %L::%s %s %s',
            val_1,
            type_::text,
            case when negate then 'IS NOT' else 'IS' end,
            upper(val_2)
        ) into res;
        return res;
    end if;

    op_symbol = case
        when op = 'eq'    then '='
        when op = 'neq'   then '!='
        when op = 'lt'    then '<'
        when op = 'lte'   then '<='
        when op = 'gt'    then '>'
        when op = 'gte'   then '>='
        when op = 'in'    then '= any'
        when op = 'like'   then 'LIKE'
        when op = 'ilike'  then 'ILIKE'
        when op = 'match'  then '~'
        when op = 'imatch' then '~*'
        else null
    end;

    if op_symbol is null then
        raise exception 'unsupported equality operator: %', op::text;
    end if;

    execute format(
        'select %L::%s %s (%L::%s)',
        val_1,
        type_::text,
        op_symbol,
        val_2,
        case when op = 'in' then type_::text || '[]' else type_::text end
    ) into res;

    return case when negate then not res else res end;
end;
$function$


CREATE OR REPLACE FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer)
 RETURNS TABLE(wal jsonb, is_rls_enabled boolean, subscription_ids uuid[], errors text[], slot_changes_count bigint)
 LANGUAGE sql
 SET log_min_messages TO 'fatal'
AS $function$
  WITH pub AS (
    SELECT
      concat_ws(
        ',',
        CASE WHEN bool_or(pubinsert) THEN 'insert' ELSE NULL END,
        CASE WHEN bool_or(pubupdate) THEN 'update' ELSE NULL END,
        CASE WHEN bool_or(pubdelete) THEN 'delete' ELSE NULL END
      ) AS w2j_actions,
      coalesce(
        string_agg(
          realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
          ','
        ) filter (WHERE ppt.tablename IS NOT NULL),
        ''
      ) AS w2j_add_tables
    FROM pg_publication pp
    LEFT JOIN pg_publication_tables ppt ON pp.pubname = ppt.pubname
    WHERE pp.pubname = publication
    GROUP BY pp.pubname
    LIMIT 1
  ),
  -- MATERIALIZED ensures pg_logical_slot_get_changes is called exactly once
  w2j AS MATERIALIZED (
    SELECT x.*, pub.w2j_add_tables
    FROM pub,
         pg_logical_slot_get_changes(
           slot_name, null, max_changes,
           'include-pk', 'true',
           'include-transaction', 'false',
           'include-timestamp', 'true',
           'include-type-oids', 'true',
           'format-version', '2',
           'actions', pub.w2j_actions,
           'add-tables', pub.w2j_add_tables
         ) x
  ),
  slot_count AS (
    SELECT count(*)::bigint AS cnt
    FROM w2j
    WHERE w2j.w2j_add_tables <> ''
  ),
  rls_filtered AS (
    SELECT xyz.wal, xyz.is_rls_enabled, xyz.subscription_ids, xyz.errors
    FROM w2j,
         realtime.apply_rls(
           wal := w2j.data::jsonb,
           max_record_bytes := max_record_bytes
         ) xyz(wal, is_rls_enabled, subscription_ids, errors)
    WHERE w2j.w2j_add_tables <> ''
      AND xyz.subscription_ids[1] IS NOT NULL
  )
  SELECT rf.wal, rf.is_rls_enabled, rf.subscription_ids, rf.errors, sc.cnt
  FROM rls_filtered rf, slot_count sc

  UNION ALL

  SELECT null, null, null, null, sc.cnt
  FROM slot_count sc
  WHERE NOT EXISTS (SELECT 1 FROM rls_filtered)
$function$


CREATE OR REPLACE FUNCTION storage.filename(name text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$function$


CREATE OR REPLACE FUNCTION realtime.quote_wal2json(entity regclass)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
AS $function$
  SELECT
    realtime.wal2json_escape_identifier(nsp.nspname::text)
    || '.'
    || realtime.wal2json_escape_identifier(pc.relname::text)
  FROM pg_class pc
  JOIN pg_namespace nsp ON pc.relnamespace = nsp.oid
  WHERE pc.oid = entity
$function$


CREATE OR REPLACE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  generated_id uuid;
  final_payload jsonb;
BEGIN
  BEGIN
    generated_id := gen_random_uuid();

    -- Check if payload has an 'id' key, if not, add the generated UUID
    IF payload ? 'id' THEN
      final_payload := payload;
    ELSE
      final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
    END IF;

    -- Set the topic configuration
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    INSERT INTO realtime.messages (id, payload, event, topic, private, extension)
    VALUES (generated_id, final_payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'WarnSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$function$


CREATE OR REPLACE FUNCTION realtime.send_binary(payload bytea, event text, topic text, private boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  generated_id uuid;
BEGIN
  BEGIN
    generated_id := gen_random_uuid();

    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    INSERT INTO realtime.messages (id, binary_payload, event, topic, private, extension)
    VALUES (generated_id, payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'WarnSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$function$


CREATE OR REPLACE FUNCTION storage.extension(name text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Get the last path segment (the actual filename)
    SELECT _parts[array_length(_parts, 1)] INTO _filename;
    -- Extract extension: reverse, split on '.', then reverse again
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$function$


CREATE OR REPLACE FUNCTION storage.foldername(name text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$function$


CREATE OR REPLACE FUNCTION storage.get_size_by_bucket()
 RETURNS TABLE(size bigint, bucket_id text)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
    return query
        select sum((metadata->>'size')::bigint)::bigint as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$function$


CREATE OR REPLACE FUNCTION storage.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$function$


CREATE OR REPLACE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$function$


CREATE OR REPLACE FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, next_key_token text DEFAULT ''::text, next_upload_token text DEFAULT ''::text)
 RETURNS TABLE(key text, id text, created_at timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$function$


CREATE OR REPLACE FUNCTION public.save_apify_account(p_apify_accounts_id bigint, p_account_name text, p_token text, p_is_active boolean)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_users_id bigint := public.ensure_current_user();
  v_id bigint;
begin
  if nullif(trim(p_account_name), '') is null then
    raise exception 'Informe o nome da conta Apify';
  end if;

  if p_apify_accounts_id is null then
    if nullif(trim(coalesce(p_token, '')), '') is null then
      raise exception 'Informe o token da nova conta Apify';
    end if;

    insert into public.apify_accounts (
      users_id,
      account_name,
      token_secret,
      is_active,
      connection_status,
      created_at,
      updated_at
    )
    values (
      v_users_id,
      trim(p_account_name),
      trim(p_token),
      coalesce(p_is_active, true),
      'not_verified',
      now(),
      now()
    )
    returning apify_accounts_id into v_id;

  else
    update public.apify_accounts
    set
      account_name = trim(p_account_name),

      token_secret = case
        when nullif(trim(coalesce(p_token, '')), '') is null
          then token_secret
        else trim(p_token)
      end,

      is_active = coalesce(p_is_active, true),

      connection_status = case
        when nullif(trim(coalesce(p_token, '')), '') is null
          then connection_status
        else 'not_verified'
      end,

      last_error = case
        when nullif(trim(coalesce(p_token, '')), '') is null
          then last_error
        else null
      end,

      updated_at = now()

    where apify_accounts_id = p_apify_accounts_id
      and users_id = v_users_id

    returning apify_accounts_id into v_id;

    if v_id is null then
      raise exception 'Conta Apify não encontrada';
    end if;
  end if;

  return v_id;
end;
$function$


CREATE OR REPLACE FUNCTION storage.operation()
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$function$


CREATE OR REPLACE FUNCTION storage.enforce_bucket_name_length()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$function$


CREATE OR REPLACE FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
SELECT CASE
    WHEN position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(p_key, length(p_prefix) + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)))
    ELSE NULL
END;
$function$


CREATE OR REPLACE FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, start_after text DEFAULT ''::text, next_token text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text)
 RETURNS TABLE(name text, id uuid, metadata jsonb, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix, 1) = delimiter_param THEN
        v_upper_bound := left(v_prefix, -1) || chr(ascii(delimiter_param) + 1);
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'AND o.name COLLATE "C" < $3 ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'AND o.name COLLATE "C" >= $3 ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor: find the last item in range
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Cursor provided: determine if it refers to a folder or leaf
        IF EXISTS (
            SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = _bucket_id
              AND o.name COLLATE "C" LIKE v_start || delimiter_param || '%'
            LIMIT 1
        ) THEN
            -- Cursor refers to a folder
            IF v_is_asc THEN
                v_next_seek := v_start || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_start || delimiter_param;
            END IF;
        ELSE
            -- Cursor refers to a leaf object
            IF v_is_asc THEN
                v_next_seek := v_start || delimiter_param;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := rtrim(v_common_prefix, delimiter_param);
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1) || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := v_current.name;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                RETURN NEXT;
                v_count := v_count + 1;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := v_current.name || delimiter_param;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;
    END LOOP;
END;
$function$


CREATE OR REPLACE FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer DEFAULT 100, levels integer DEFAULT 1, start_after text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, sort_column text DEFAULT 'name'::text, sort_column_after text DEFAULT ''::text)
 RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            start_after,
            '',
            v_sort_ord
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after
        );
    END IF;
END;
$function$


CREATE OR REPLACE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text)
 RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;
    v_skipped INT := 0;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach (unchanged)
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT path_tokens[$1] AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $2 || '%%'
                  AND bucket_id = $3
                  AND array_length(objects.path_tokens, 1) <> $1
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata FROM folders)
            UNION ALL
            (SELECT path_tokens[$1] AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata
             FROM storage.objects
             WHERE objects.name ILIKE $2 || '%%'
               AND bucket_id = $3
               AND array_length(objects.path_tokens, 1) = $1
             ORDER BY %I %s)
            LIMIT $4 OFFSET $5
            $sql$, v_sort_order, v_order_by, v_sort_order
        ) USING levels, v_prefix, bucketname, v_limit, offsets;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'AND lower(o.name) COLLATE "C" < $3 ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'AND lower(o.name) COLLATE "C" >= $3 ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC: find the last item in range first (static SQL)
        IF v_upper_bound IS NOT NULL THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower AND lower(o.name) COLLATE "C" < v_upper_bound
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSIF v_prefix_lower <> '' THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSE
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        END IF;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix_lower <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := split_part(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter), v_delimiter, levels);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := lower(v_current.name);
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := split_part(v_current.name, v_delimiter, levels);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := lower(v_current.name) || v_delimiter;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;
    END LOOP;
END;
$function$


CREATE OR REPLACE FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text)
 RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
BEGIN
    v_prefix := coalesce(p_prefix, '');

    IF p_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $1 || '%%'
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                rtrim(common_prefix, '/') AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    date_trunc('milliseconds', %I),
                    name COLLATE "C"
                ) %s ROW(
                    COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz),
                    $5
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s
        LIMIT $4
    $sql$,
        p_sort_column,
        v_cursor_op,
        p_sort_column,
        p_sort_order,
        p_sort_order
    );

    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after;
END;
$function$


CREATE OR REPLACE FUNCTION storage.protect_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$function$


CREATE OR REPLACE FUNCTION storage.allow_only_operation(expected_operation text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT
      CASE
        WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
        ELSE raw_operation
      END AS current_operation,
      CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END AS requested_operation
    FROM current_operation
  )
  SELECT CASE
    WHEN requested_operation IS NULL OR requested_operation = '' THEN FALSE
    ELSE COALESCE(current_operation = requested_operation, FALSE)
  END
  FROM normalized;
$function$


CREATE OR REPLACE FUNCTION storage.allow_any_operation(expected_operations text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT CASE
      WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
      ELSE raw_operation
    END AS current_operation
    FROM current_operation
  )
  SELECT EXISTS (
    SELECT 1
    FROM normalized n
    CROSS JOIN LATERAL unnest(expected_operations) AS expected_operation
    WHERE expected_operation IS NOT NULL
      AND expected_operation <> ''
      AND n.current_operation = CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END
  );
$function$


CREATE OR REPLACE FUNCTION public.unaccent(regdictionary, text)
 RETURNS text
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/unaccent', $function$unaccent_dict$function$


CREATE OR REPLACE FUNCTION public.unaccent(text)
 RETURNS text
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/unaccent', $function$unaccent_dict$function$


CREATE OR REPLACE FUNCTION public.unaccent_init(internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/unaccent', $function$unaccent_init$function$


CREATE OR REPLACE FUNCTION public.unaccent_lexize(internal, internal, internal, internal)
 RETURNS internal
 LANGUAGE c
 PARALLEL SAFE
AS '$libdir/unaccent', $function$unaccent_lexize$function$


CREATE OR REPLACE FUNCTION public.ensure_current_user()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_users_id bigint;
  v_status_id bigint;
begin
  if v_auth_user_id is null then
    raise exception 'Usuário não autenticado';
  end if;

  select u.users_id
    into v_users_id
  from public.users u
  where u.auth_user_id = v_auth_user_id;

  if v_users_id is not null then
    return v_users_id;
  end if;

  select s.status_id
    into v_status_id
  from public.status s
  where lower(trim(s.status_name)) in ('ativo', 'active')
  order by
    case lower(trim(s.status_name)) when 'ativo' then 0 else 1 end,
    s.status_id
  limit 1;

  if v_status_id is null then
    raise exception 'Nenhum status ativo encontrado em public.status';
  end if;

  insert into public.users (auth_user_id, status_id)
  values (v_auth_user_id, v_status_id)
  on conflict (auth_user_id) do update
    set users_updated_at = now()
  returning users_id into v_users_id;

  return v_users_id;
end;
$function$


CREATE OR REPLACE FUNCTION public.list_apify_accounts()
 RETURNS TABLE(apify_accounts_id bigint, account_name text, is_active boolean, token_mask text, connection_status text, external_username text, last_checked_at timestamp with time zone, last_used_at timestamp with time zone, last_error text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    a.apify_accounts_id,
    a.account_name,
    a.is_active,
    case
      when coalesce(a.token_secret, '') = '' then ''
      when length(a.token_secret) <= 8 then '••••••••'
      else left(a.token_secret, 10) || '••••••••' || right(a.token_secret, 4)
    end as token_mask,
    a.connection_status,
    coalesce(a.external_username, ''),
    a.last_checked_at,
    a.last_used_at,
    coalesce(a.last_error, ''),
    a.created_at,
    a.updated_at
  from public.apify_accounts a
  where a.users_id = public.ensure_current_user()
  order by a.is_active desc, a.account_name, a.apify_accounts_id;
$function$


CREATE OR REPLACE FUNCTION public.delete_apify_account(p_apify_accounts_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_users_id bigint := public.ensure_current_user();
begin
  delete from public.apify_accounts
  where apify_accounts_id = p_apify_accounts_id
    and users_id = v_users_id;

  if not found then
    raise exception 'Conta Apify não encontrada';
  end if;
end;
$function$


CREATE OR REPLACE VIEW extensions.pg_stat_statements_info AS  SELECT dealloc,
    stats_reset
   FROM pg_stat_statements_info() pg_stat_statements_info(dealloc, stats_reset);;

CREATE OR REPLACE VIEW extensions.pg_stat_statements AS  SELECT userid,
    dbid,
    toplevel,
    queryid,
    query,
    plans,
    total_plan_time,
    min_plan_time,
    max_plan_time,
    mean_plan_time,
    stddev_plan_time,
    calls,
    total_exec_time,
    min_exec_time,
    max_exec_time,
    mean_exec_time,
    stddev_exec_time,
    rows,
    shared_blks_hit,
    shared_blks_read,
    shared_blks_dirtied,
    shared_blks_written,
    local_blks_hit,
    local_blks_read,
    local_blks_dirtied,
    local_blks_written,
    temp_blks_read,
    temp_blks_written,
    shared_blk_read_time,
    shared_blk_write_time,
    local_blk_read_time,
    local_blk_write_time,
    temp_blk_read_time,
    temp_blk_write_time,
    wal_records,
    wal_fpi,
    wal_bytes,
    jit_functions,
    jit_generation_time,
    jit_inlining_count,
    jit_inlining_time,
    jit_optimization_count,
    jit_optimization_time,
    jit_emission_count,
    jit_emission_time,
    jit_deform_count,
    jit_deform_time,
    stats_since,
    minmax_stats_since
   FROM pg_stat_statements(true) pg_stat_statements(userid, dbid, toplevel, queryid, query, plans, total_plan_time, min_plan_time, max_plan_time, mean_plan_time, stddev_plan_time, calls, total_exec_time, min_exec_time, max_exec_time, mean_exec_time, stddev_exec_time, rows, shared_blks_hit, shared_blks_read, shared_blks_dirtied, shared_blks_written, local_blks_hit, local_blks_read, local_blks_dirtied, local_blks_written, temp_blks_read, temp_blks_written, shared_blk_read_time, shared_blk_write_time, local_blk_read_time, local_blk_write_time, temp_blk_read_time, temp_blk_write_time, wal_records, wal_fpi, wal_bytes, jit_functions, jit_generation_time, jit_inlining_count, jit_inlining_time, jit_optimization_count, jit_optimization_time, jit_emission_count, jit_emission_time, jit_deform_count, jit_deform_time, stats_since, minmax_stats_since);;

CREATE OR REPLACE VIEW vault.decrypted_secrets AS  SELECT id,
    name,
    description,
    secret,
    convert_from(vault._crypto_aead_det_decrypt(message => decode(secret, 'base64'::text), additional => convert_to(id::text, 'utf8'::name), key_id => 0::bigint, context => '\x7067736f6469756d'::bytea, nonce => nonce), 'utf8'::name) AS decrypted_secret,
    key_id,
    nonce,
    created_at,
    updated_at
   FROM vault.secrets s;;

CREATE TRIGGER tr_check_filters BEFORE INSERT OR UPDATE ON realtime.subscription FOR EACH ROW EXECUTE FUNCTION realtime.subscription_check_filters();

CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();

CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();

CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();

CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();

CREATE UNIQUE INDEX saml_providers_pkey ON auth.saml_providers USING btree (id);

CREATE UNIQUE INDEX saml_providers_entity_id_key ON auth.saml_providers USING btree (entity_id);

CREATE UNIQUE INDEX pg_toast_17805_index ON pg_toast.pg_toast_17805 USING btree (chunk_id, chunk_seq);

CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers USING btree (sso_provider_id);

CREATE UNIQUE INDEX pg_toast_16836_index ON pg_toast.pg_toast_16836 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX saml_relay_states_pkey ON auth.saml_relay_states USING btree (id);

CREATE UNIQUE INDEX pg_toast_16716_index ON pg_toast.pg_toast_16716 USING btree (chunk_id, chunk_seq);

CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states USING btree (sso_provider_id);

CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states USING btree (for_email);

CREATE INDEX idx_auth_code ON auth.flow_state USING btree (auth_code);

CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains USING btree (lower(domain));

CREATE UNIQUE INDEX pg_toast_16818_index ON pg_toast.pg_toast_16818 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX users_phone_key ON auth.users USING btree (phone);

CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);

CREATE UNIQUE INDEX pg_toast_16889_index ON pg_toast.pg_toast_16889 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX flow_state_pkey ON auth.flow_state USING btree (id);

CREATE INDEX idx_user_id_auth_method ON auth.flow_state USING btree (user_id, authentication_method);

CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens USING btree (updated_at DESC);

CREATE INDEX flow_state_created_at_idx ON auth.flow_state USING btree (created_at DESC);

CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states USING btree (created_at DESC);

CREATE INDEX sessions_not_after_idx ON auth.sessions USING btree (not_after DESC);

CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges USING btree (created_at DESC);

CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors USING btree (user_id);

CREATE UNIQUE INDEX users_auth_user_id_unique ON public.users USING btree (auth_user_id);

CREATE UNIQUE INDEX pg_toast_19265_index ON pg_toast.pg_toast_19265 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX lead_validation_results_pkey ON public.lead_validation_results USING btree (lead_validation_results_id);

CREATE UNIQUE INDEX lead_validation_results_key_key ON public.lead_validation_results USING btree (lead_validation_results_key);

CREATE UNIQUE INDEX lead_validation_results_name_key ON public.lead_validation_results USING btree (lead_validation_results_name);

CREATE UNIQUE INDEX pg_toast_1255_index ON pg_toast.pg_toast_1255 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_1247_index ON pg_toast.pg_toast_1247 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_2604_index ON pg_toast.pg_toast_2604 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_2606_index ON pg_toast.pg_toast_2606 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_2612_index ON pg_toast.pg_toast_2612 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_2600_index ON pg_toast.pg_toast_2600 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_2619_index ON pg_toast.pg_toast_2619 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_3381_index ON pg_toast.pg_toast_3381 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_3429_index ON pg_toast.pg_toast_3429 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_2618_index ON pg_toast.pg_toast_2618 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_2620_index ON pg_toast.pg_toast_2620 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_3466_index ON pg_toast.pg_toast_3466 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_2609_index ON pg_toast.pg_toast_2609 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX refresh_tokens_pkey ON auth.refresh_tokens USING btree (id);

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);

CREATE UNIQUE INDEX pg_toast_16511_index ON pg_toast.pg_toast_16511 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_16522_index ON pg_toast.pg_toast_16522 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX users_pkey ON auth.users USING btree (id);

CREATE UNIQUE INDEX pg_toast_2615_index ON pg_toast.pg_toast_2615 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_1262_index ON pg_toast.pg_toast_1262 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_2964_index ON pg_toast.pg_toast_2964 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_1213_index ON pg_toast.pg_toast_1213 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_1260_index ON pg_toast.pg_toast_1260 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_2396_index ON pg_toast.pg_toast_2396 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_3600_index ON pg_toast.pg_toast_3600 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_3079_index ON pg_toast.pg_toast_3079 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_2328_index ON pg_toast.pg_toast_2328 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_1417_index ON pg_toast.pg_toast_1417 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_1418_index ON pg_toast.pg_toast_1418 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_3118_index ON pg_toast.pg_toast_3118 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_3256_index ON pg_toast.pg_toast_3256 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_6000_index ON pg_toast.pg_toast_6000 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_826_index ON pg_toast.pg_toast_826 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_3394_index ON pg_toast.pg_toast_3394 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_3596_index ON pg_toast.pg_toast_3596 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_3592_index ON pg_toast.pg_toast_3592 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_3456_index ON pg_toast.pg_toast_3456 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_6243_index ON pg_toast.pg_toast_6243 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_3350_index ON pg_toast.pg_toast_3350 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_6106_index ON pg_toast.pg_toast_6106 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_6100_index ON pg_toast.pg_toast_6100 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_16529_index ON pg_toast.pg_toast_16529 USING btree (chunk_id, chunk_seq);

CREATE INDEX lead_validation_results_status_idx ON public.lead_validation_results USING btree (status_id);

CREATE UNIQUE INDEX sessions_pkey ON auth.sessions USING btree (id);

CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);

CREATE UNIQUE INDEX audit_log_entries_pkey ON auth.audit_log_entries USING btree (id);

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);

CREATE UNIQUE INDEX instances_pkey ON auth.instances USING btree (id);

CREATE UNIQUE INDEX schema_migrations_pkey ON auth.schema_migrations USING btree (version);

CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);

CREATE UNIQUE INDEX refresh_tokens_token_unique ON auth.refresh_tokens USING btree (token);

CREATE UNIQUE INDEX pg_toast_16499_index ON pg_toast.pg_toast_16499 USING btree (chunk_id, chunk_seq);

CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));

CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);

CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens USING btree (parent);

CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);

CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);

CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);

CREATE UNIQUE INDEX pg_toast_16751_index ON pg_toast.pg_toast_16751 USING btree (chunk_id, chunk_seq);

CREATE INDEX user_id_created_at_idx ON auth.sessions USING btree (user_id, created_at);

CREATE UNIQUE INDEX mfa_factors_pkey ON auth.mfa_factors USING btree (id);

CREATE UNIQUE INDEX pg_toast_18632_index ON pg_toast.pg_toast_18632 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique ON auth.mfa_factors USING btree (friendly_name, user_id) WHERE (TRIM(BOTH FROM friendly_name) <> ''::text);

CREATE UNIQUE INDEX pg_toast_16764_index ON pg_toast.pg_toast_16764 USING btree (chunk_id, chunk_seq);

CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors USING btree (user_id, created_at);

CREATE UNIQUE INDEX mfa_challenges_pkey ON auth.mfa_challenges USING btree (id);

CREATE UNIQUE INDEX pg_toast_16776_index ON pg_toast.pg_toast_16776 USING btree (chunk_id, chunk_seq);

CREATE INDEX sessions_user_id_idx ON auth.sessions USING btree (user_id);

CREATE UNIQUE INDEX mfa_amr_claims_session_id_authentication_method_pkey ON auth.mfa_amr_claims USING btree (session_id, authentication_method);

CREATE UNIQUE INDEX sso_providers_pkey ON auth.sso_providers USING btree (id);

CREATE UNIQUE INDEX amr_id_pk ON auth.mfa_amr_claims USING btree (id);

CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens USING btree (session_id, revoked);

CREATE UNIQUE INDEX pg_toast_19289_index ON pg_toast.pg_toast_19289 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_16794_index ON pg_toast.pg_toast_16794 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers USING btree (lower(resource_id));

CREATE UNIQUE INDEX pg_toast_13458_index ON pg_toast.pg_toast_13458 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_13448_index ON pg_toast.pg_toast_13448 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_13453_index ON pg_toast.pg_toast_13453 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_13463_index ON pg_toast.pg_toast_13463 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_16612_index ON pg_toast.pg_toast_16612 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX secrets_pkey ON vault.secrets USING btree (id);

CREATE UNIQUE INDEX secrets_name_idx ON vault.secrets USING btree (name) WHERE (name IS NOT NULL);

CREATE UNIQUE INDEX pg_toast_16803_index ON pg_toast.pg_toast_16803 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX sso_domains_pkey ON auth.sso_domains USING btree (id);

CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains USING btree (sso_provider_id);

CREATE INDEX identities_user_id_idx ON auth.identities USING btree (user_id);

CREATE INDEX identities_email_idx ON auth.identities USING btree (email text_pattern_ops);

CREATE UNIQUE INDEX identities_pkey ON auth.identities USING btree (id);

CREATE UNIQUE INDEX pg_toast_16686_index ON pg_toast.pg_toast_16686 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX identities_provider_id_provider_unique ON auth.identities USING btree (provider_id, provider);

CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);

CREATE UNIQUE INDEX pg_toast_16939_index ON pg_toast.pg_toast_16939 USING btree (chunk_id, chunk_seq);

CREATE INDEX sso_providers_resource_id_pattern_idx ON auth.sso_providers USING btree (resource_id text_pattern_ops);

CREATE UNIQUE INDEX one_time_tokens_pkey ON auth.one_time_tokens USING btree (id);

CREATE UNIQUE INDEX mfa_factors_last_challenged_at_key ON auth.mfa_factors USING btree (last_challenged_at);

CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);

CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);

CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key ON auth.one_time_tokens USING btree (user_id, token_type);

CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors USING btree (user_id, phone);

CREATE UNIQUE INDEX lead_validation_attempts_pkey ON public.lead_validation_attempts USING btree (lead_validation_attempts_id);

CREATE UNIQUE INDEX lead_validation_attempts_active_unique ON public.lead_validation_attempts USING btree (users_id, leads_id, channels_id) WHERE ((leads_id IS NOT NULL) AND (status_id = ANY (ARRAY[(3)::bigint, (4)::bigint])));

CREATE UNIQUE INDEX pg_toast_16971_index ON pg_toast.pg_toast_16971 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX oauth_clients_pkey ON auth.oauth_clients USING btree (id);

CREATE UNIQUE INDEX lead_validation_attempts_queue_item_unique ON public.lead_validation_attempts USING btree (queue_items_id) WHERE (queue_items_id IS NOT NULL);

CREATE INDEX lead_validation_attempts_user_created_idx ON public.lead_validation_attempts USING btree (users_id, lead_validation_attempts_created_at DESC);

CREATE INDEX oauth_clients_deleted_at_idx ON auth.oauth_clients USING btree (deleted_at);

CREATE INDEX lead_validation_attempts_lead_channel_idx ON public.lead_validation_attempts USING btree (leads_id, channels_id, lead_validation_attempts_created_at DESC) WHERE (leads_id IS NOT NULL);

CREATE UNIQUE INDEX pg_toast_17001_index ON pg_toast.pg_toast_17001 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX oauth_authorizations_pkey ON auth.oauth_authorizations USING btree (id);

CREATE UNIQUE INDEX oauth_authorizations_authorization_id_key ON auth.oauth_authorizations USING btree (authorization_id);

CREATE UNIQUE INDEX oauth_authorizations_authorization_code_key ON auth.oauth_authorizations USING btree (authorization_code);

CREATE INDEX oauth_auth_pending_exp_idx ON auth.oauth_authorizations USING btree (expires_at) WHERE (status = 'pending'::auth.oauth_authorization_status);

CREATE INDEX custom_oauth_providers_identifier_idx ON auth.custom_oauth_providers USING btree (identifier);

CREATE UNIQUE INDEX pg_toast_17034_index ON pg_toast.pg_toast_17034 USING btree (chunk_id, chunk_seq);

CREATE INDEX custom_oauth_providers_provider_type_idx ON auth.custom_oauth_providers USING btree (provider_type);

CREATE UNIQUE INDEX oauth_consents_pkey ON auth.oauth_consents USING btree (id);

CREATE UNIQUE INDEX oauth_consents_user_client_unique ON auth.oauth_consents USING btree (user_id, client_id);

CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents USING btree (user_id, client_id) WHERE (revoked_at IS NULL);

CREATE INDEX oauth_consents_user_order_idx ON auth.oauth_consents USING btree (user_id, granted_at DESC);

CREATE INDEX oauth_consents_active_client_idx ON auth.oauth_consents USING btree (client_id) WHERE (revoked_at IS NULL);

CREATE INDEX custom_oauth_providers_enabled_idx ON auth.custom_oauth_providers USING btree (enabled);

CREATE INDEX sessions_oauth_client_id_idx ON auth.sessions USING btree (oauth_client_id);

CREATE INDEX custom_oauth_providers_created_at_idx ON auth.custom_oauth_providers USING btree (created_at);

CREATE UNIQUE INDEX pg_toast_17074_index ON pg_toast.pg_toast_17074 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX oauth_client_states_pkey ON auth.oauth_client_states USING btree (id);

CREATE INDEX idx_oauth_client_states_created_at ON auth.oauth_client_states USING btree (created_at);

CREATE INDEX webauthn_credentials_user_id_idx ON auth.webauthn_credentials USING btree (user_id);

CREATE UNIQUE INDEX pg_toast_17084_index ON pg_toast.pg_toast_17084 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX custom_oauth_providers_pkey ON auth.custom_oauth_providers USING btree (id);

CREATE UNIQUE INDEX custom_oauth_providers_identifier_key ON auth.custom_oauth_providers USING btree (identifier);

CREATE UNIQUE INDEX pg_toast_17126_index ON pg_toast.pg_toast_17126 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX webauthn_credentials_pkey ON auth.webauthn_credentials USING btree (id);

CREATE UNIQUE INDEX webauthn_credentials_credential_id_key ON auth.webauthn_credentials USING btree (credential_id);

CREATE UNIQUE INDEX pg_toast_18644_index ON pg_toast.pg_toast_18644 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_17149_index ON pg_toast.pg_toast_17149 USING btree (chunk_id, chunk_seq);

CREATE INDEX lead_validation_attempts_chip_created_idx ON public.lead_validation_attempts USING btree (chips_id, lead_validation_attempts_created_at DESC) WHERE (chips_id IS NOT NULL);

CREATE INDEX lead_validation_attempts_status_created_idx ON public.lead_validation_attempts USING btree (users_id, status_id, lead_validation_attempts_created_at DESC);

CREATE UNIQUE INDEX webauthn_challenges_pkey ON auth.webauthn_challenges USING btree (id);

CREATE INDEX webauthn_challenges_user_id_idx ON auth.webauthn_challenges USING btree (user_id);

CREATE INDEX webauthn_challenges_expires_at_idx ON auth.webauthn_challenges USING btree (expires_at);

CREATE INDEX idx_users_email ON auth.users USING btree (email);

CREATE INDEX idx_users_created_at_desc ON auth.users USING btree (created_at DESC);

CREATE INDEX idx_users_last_sign_in_at_desc ON auth.users USING btree (last_sign_in_at DESC);

CREATE INDEX idx_users_name ON auth.users USING btree (((raw_user_meta_data ->> 'name'::text))) WHERE ((raw_user_meta_data ->> 'name'::text) IS NOT NULL);

CREATE UNIQUE INDEX backfill_user_map_pkey ON public.backfill_user_map USING btree (old_user_id);

CREATE UNIQUE INDEX pg_toast_17255_index ON pg_toast.pg_toast_17255 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX messages_pkey ON ONLY realtime.messages USING btree (id, inserted_at);

CREATE UNIQUE INDEX pk_subscription ON realtime.subscription USING btree (id);

CREATE UNIQUE INDEX schema_migrations_pkey ON realtime.schema_migrations USING btree (version);

CREATE INDEX ix_realtime_subscription_entity ON realtime.subscription USING btree (entity);

CREATE INDEX messages_inserted_at_topic_index ON ONLY realtime.messages USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));

CREATE UNIQUE INDEX subscription_subscription_id_entity_filters_action_filter_selec ON realtime.subscription USING btree (subscription_id, entity, filters, action_filter, COALESCE(selected_columns, '{}'::text[]));

CREATE INDEX apify_accounts_users_active_idx ON public.apify_accounts USING btree (users_id, is_active, apify_accounts_id);

CREATE UNIQUE INDEX objects_pkey ON storage.objects USING btree (id);

CREATE UNIQUE INDEX bucketid_objname ON storage.objects USING btree (bucket_id, name);

CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);

CREATE UNIQUE INDEX pg_toast_17306_index ON pg_toast.pg_toast_17306 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX migrations_pkey ON storage.migrations USING btree (id);

CREATE UNIQUE INDEX migrations_name_key ON storage.migrations USING btree (name);

CREATE UNIQUE INDEX pg_toast_17504_index ON pg_toast.pg_toast_17504 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX buckets_pkey ON storage.buckets USING btree (id);

CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);

CREATE UNIQUE INDEX pg_toast_17296_index ON pg_toast.pg_toast_17296 USING btree (chunk_id, chunk_seq);

CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");

CREATE UNIQUE INDEX apify_import_jobs_external_run_uidx ON public.apify_import_jobs USING btree (external_run_id) WHERE (external_run_id IS NOT NULL);

CREATE INDEX apify_import_jobs_user_created_idx ON public.apify_import_jobs USING btree (users_id, created_at DESC);

CREATE UNIQUE INDEX s3_multipart_uploads_pkey ON storage.s3_multipart_uploads USING btree (id);

CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads USING btree (bucket_id, key, created_at);

CREATE UNIQUE INDEX pg_toast_17355_index ON pg_toast.pg_toast_17355 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX s3_multipart_uploads_parts_pkey ON storage.s3_multipart_uploads_parts USING btree (id);

CREATE UNIQUE INDEX pg_toast_17369_index ON pg_toast.pg_toast_17369 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_17429_index ON pg_toast.pg_toast_17429 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX buckets_vectors_pkey ON storage.buckets_vectors USING btree (id);

CREATE UNIQUE INDEX pg_toast_17439_index ON pg_toast.pg_toast_17439 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX vector_indexes_pkey ON storage.vector_indexes USING btree (id);

CREATE UNIQUE INDEX status_pkey ON public.status USING btree (status_id);

CREATE UNIQUE INDEX status_status_name_key ON public.status USING btree (status_name);

CREATE UNIQUE INDEX vector_indexes_name_bucket_id_idx ON storage.vector_indexes USING btree (name, bucket_id);

CREATE INDEX apify_import_jobs_pending_import_idx ON public.apify_import_jobs USING btree (users_id, status, imported_at) WHERE ((status = 'succeeded'::text) AND (imported_at IS NULL));

CREATE UNIQUE INDEX pg_toast_17416_index ON pg_toast.pg_toast_17416 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX buckets_analytics_pkey ON storage.buckets_analytics USING btree (id);

CREATE UNIQUE INDEX buckets_analytics_unique_name_idx ON storage.buckets_analytics USING btree (name) WHERE (deleted_at IS NULL);

CREATE INDEX idx_objects_bucket_id_name_lower ON storage.objects USING btree (bucket_id, lower(name) COLLATE "C");

CREATE UNIQUE INDEX pg_toast_17480_index ON pg_toast.pg_toast_17480 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_17492_index ON pg_toast.pg_toast_17492 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX lead_status_pkey ON public.lead_status USING btree (lead_status_id);

CREATE UNIQUE INDEX lead_status_lead_status_name_key ON public.lead_status USING btree (lead_status_name);

CREATE UNIQUE INDEX users_pkey ON public.users USING btree (users_id);

CREATE UNIQUE INDEX users_auth_user_id_key ON public.users USING btree (auth_user_id);

CREATE UNIQUE INDEX pg_toast_17524_index ON pg_toast.pg_toast_17524 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX countries_pkey ON public.countries USING btree (countries_id);

CREATE UNIQUE INDEX countries_code_unique ON public.countries USING btree (countries_code);

CREATE UNIQUE INDEX pg_toast_17536_index ON pg_toast.pg_toast_17536 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX states_pkey ON public.states USING btree (states_id);

CREATE UNIQUE INDEX states_country_name_unique ON public.states USING btree (countries_id, states_name);

CREATE UNIQUE INDEX states_country_code_unique ON public.states USING btree (countries_id, states_code);

CREATE UNIQUE INDEX pg_toast_17555_index ON pg_toast.pg_toast_17555 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX cities_pkey ON public.cities USING btree (cities_id);

CREATE UNIQUE INDEX cities_state_name_unique ON public.cities USING btree (states_id, cities_name);

CREATE INDEX apify_import_jobs_branches_id_idx ON public.apify_import_jobs USING btree (branches_id);

CREATE UNIQUE INDEX pg_toast_17572_index ON pg_toast.pg_toast_17572 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX channels_pkey ON public.channels USING btree (channels_id);

CREATE UNIQUE INDEX channels_channels_name_key ON public.channels USING btree (channels_name);

CREATE UNIQUE INDEX pg_toast_17584_index ON pg_toast.pg_toast_17584 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX branches_pkey ON public.branches USING btree (branches_id);

CREATE UNIQUE INDEX branches_user_name_unique ON public.branches USING btree (users_id, branches_name);

CREATE INDEX idx_apify_import_jobs_branch_status_location ON public.apify_import_jobs USING btree (branches_id, status, location_query);

CREATE UNIQUE INDEX pg_toast_17630_index ON pg_toast.pg_toast_17630 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX levels_pkey ON public.levels USING btree (levels_id);

CREATE UNIQUE INDEX levels_user_channel_name_unique ON public.levels USING btree (users_id, channels_id, levels_name);

CREATE UNIQUE INDEX pg_toast_17660_index ON pg_toast.pg_toast_17660 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX pg_toast_17692_index ON pg_toast.pg_toast_17692 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX socials_pkey ON public.socials USING btree (socials_id);

CREATE UNIQUE INDEX socials_user_username_unique ON public.socials USING btree (users_id, socials_username);

CREATE UNIQUE INDEX pg_toast_17606_index ON pg_toast.pg_toast_17606 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX instances_pkey ON public.instances USING btree (instances_id);

CREATE UNIQUE INDEX instances_user_name_unique ON public.instances USING btree (users_id, instances_name);

CREATE UNIQUE INDEX chips_pkey ON public.chips USING btree (chips_id);

CREATE UNIQUE INDEX chips_user_phone_unique ON public.chips USING btree (users_id, chips_phone);

CREATE UNIQUE INDEX pg_toast_17719_index ON pg_toast.pg_toast_17719 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX templates_pkey ON public.templates USING btree (templates_id);

CREATE UNIQUE INDEX templates_user_name_unique ON public.templates USING btree (users_id, templates_name);

CREATE UNIQUE INDEX pg_toast_17746_index ON pg_toast.pg_toast_17746 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX apify_accounts_pkey ON public.apify_accounts USING btree (apify_accounts_id);

CREATE UNIQUE INDEX pg_toast_17768_index ON pg_toast.pg_toast_17768 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX apify_import_jobs_pkey ON public.apify_import_jobs USING btree (apify_import_jobs_id);

CREATE UNIQUE INDEX apify_run_user_unique ON public.apify_import_jobs USING btree (users_id, apify_run_id);

CREATE UNIQUE INDEX leads_pkey ON public.leads USING btree (leads_id);

CREATE INDEX leads_users_id_idx ON public.leads USING btree (users_id);

CREATE INDEX leads_apify_import_jobs_id_idx ON public.leads USING btree (apify_import_jobs_id);

CREATE UNIQUE INDEX pg_toast_17950_index ON pg_toast.pg_toast_17950 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX sents_pkey ON public.sents USING btree (sents_id);

CREATE UNIQUE INDEX pg_toast_17872_index ON pg_toast.pg_toast_17872 USING btree (chunk_id, chunk_seq);

CREATE INDEX import_rules_status_idx ON public.import_rules USING btree (status_id);

CREATE UNIQUE INDEX queues_pkey ON public.queues USING btree (queues_id);

CREATE UNIQUE INDEX queues_user_name_unique ON public.queues USING btree (users_id, queues_name);

CREATE UNIQUE INDEX pg_toast_17899_index ON pg_toast.pg_toast_17899 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX queue_items_pkey ON public.queue_items USING btree (queue_items_id);

CREATE UNIQUE INDEX queue_items_queue_lead_unique ON public.queue_items USING btree (queues_id, leads_id);

CREATE INDEX queue_items_queue_status_idx ON public.queue_items USING btree (queues_id, status_id);

CREATE INDEX queue_items_user_status_idx ON public.queue_items USING btree (users_id, status_id);

CREATE INDEX leads_phone_idx ON public.leads USING btree (users_id, leads_phone) WHERE (leads_phone IS NOT NULL);

CREATE INDEX leads_website_idx ON public.leads USING btree (users_id, leads_website) WHERE (leads_website IS NOT NULL);

CREATE INDEX leads_instagram_idx ON public.leads USING btree (users_id, leads_instagram) WHERE (leads_instagram IS NOT NULL);

CREATE INDEX leads_maps_idx ON public.leads USING btree (users_id, leads_maps) WHERE (leads_maps IS NOT NULL);

CREATE INDEX leads_status_idx ON public.leads USING btree (users_id, lead_status_id);

CREATE INDEX users_status_idx ON public.users USING btree (status_id);

CREATE INDEX states_country_idx ON public.states USING btree (countries_id);

CREATE INDEX cities_state_idx ON public.cities USING btree (states_id);

CREATE UNIQUE INDEX import_rules_pkey ON public.import_rules USING btree (import_rules_id);

CREATE UNIQUE INDEX import_rules_users_id_key ON public.import_rules USING btree (users_id);

CREATE INDEX branches_user_idx ON public.branches USING btree (users_id);

CREATE INDEX templates_user_idx ON public.templates USING btree (users_id);

CREATE INDEX sents_user_sent_at_idx ON public.sents USING btree (users_id, sents_sent_at DESC);

CREATE INDEX levels_user_channel_idx ON public.levels USING btree (users_id, channels_id);

CREATE INDEX sents_lead_idx ON public.sents USING btree (leads_id);

CREATE INDEX socials_user_idx ON public.socials USING btree (users_id);

CREATE INDEX apify_accounts_user_idx ON public.apify_accounts USING btree (users_id);

CREATE INDEX apify_jobs_user_created_idx ON public.apify_import_jobs USING btree (users_id, apify_import_jobs_created_at DESC);

CREATE INDEX apify_jobs_status_idx ON public.apify_import_jobs USING btree (apify_job_status_id);

CREATE INDEX queues_user_channel_idx ON public.queues USING btree (users_id, channels_id);

CREATE INDEX instances_user_idx ON public.instances USING btree (users_id);

CREATE INDEX chips_user_idx ON public.chips USING btree (users_id);

CREATE INDEX sents_queue_item_idx ON public.sents USING btree (queue_items_id);

CREATE UNIQUE INDEX pg_toast_18350_index ON pg_toast.pg_toast_18350 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX template_type_pkey ON public.template_channels USING btree (template_channels_id);

CREATE UNIQUE INDEX pg_toast_18386_index ON pg_toast.pg_toast_18386 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX template_types_pkey ON public.template_types USING btree (template_types_id);

CREATE UNIQUE INDEX pg_toast_18418_index ON pg_toast.pg_toast_18418 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX template_variables_pkey ON public.template_variables USING btree (template_variables_id);

CREATE UNIQUE INDEX template_variables_user_key_unique ON public.template_variables USING btree (users_id, template_variables_key);

CREATE UNIQUE INDEX validation_rules_pkey ON public.validation_rules USING btree (validation_rules_id);

CREATE UNIQUE INDEX pg_toast_18463_index ON pg_toast.pg_toast_18463 USING btree (chunk_id, chunk_seq);

CREATE UNIQUE INDEX validation_rules_users_id_key ON public.validation_rules USING btree (users_id);

CREATE UNIQUE INDEX contact_sources_pkey ON public.contact_sources USING btree (contact_sources_id);

CREATE INDEX validation_rules_source_idx ON public.validation_rules USING btree (validation_rules_source_id);

CREATE INDEX validation_rules_channels_idx ON public.validation_rules USING btree (validation_rules_channel_id, validation_rules_fallback_channel_id);

CREATE UNIQUE INDEX contact_sources_users_key_unique ON public.contact_sources USING btree (users_id, contact_sources_key);

CREATE UNIQUE INDEX contact_sources_users_name_unique ON public.contact_sources USING btree (users_id, contact_sources_name);

CREATE INDEX leads_contact_sources_id_idx ON public.leads USING btree (contact_sources_id);

CREATE POLICY users_select_own ON public.users;

CREATE POLICY "users can select own leads" ON public.leads;

CREATE POLICY "users can insert own leads" ON public.leads;

CREATE POLICY "users can update own leads" ON public.leads;

CREATE POLICY "authenticated can read channels" ON public.channels;

CREATE POLICY "authenticated can read countries" ON public.countries;

CREATE POLICY "authenticated can read states" ON public.states;

CREATE POLICY "authenticated can read cities" ON public.cities;

CREATE POLICY "authenticated can read lead status" ON public.lead_status;

CREATE POLICY "authenticated can read contact sources" ON public.contact_sources;

CREATE POLICY status_authenticated_read ON public.status;

CREATE POLICY lead_status_authenticated_read ON public.lead_status;

CREATE POLICY channels_authenticated_read ON public.channels;

CREATE POLICY countries_authenticated_read ON public.countries;

CREATE POLICY states_authenticated_read ON public.states;

CREATE POLICY cities_authenticated_read ON public.cities;

CREATE POLICY apify_accounts_own_select ON public.apify_accounts;

CREATE POLICY apify_accounts_own_insert ON public.apify_accounts;

CREATE POLICY apify_accounts_own_update ON public.apify_accounts;

CREATE POLICY apify_accounts_own_delete ON public.apify_accounts;

CREATE POLICY apify_import_jobs_own_select ON public.apify_import_jobs;

CREATE POLICY apify_import_jobs_own_insert ON public.apify_import_jobs;

CREATE POLICY apify_import_jobs_own_update ON public.apify_import_jobs;

CREATE POLICY apify_import_jobs_own_delete ON public.apify_import_jobs;

CREATE POLICY branches_own_select ON public.branches;

CREATE POLICY branches_own_insert ON public.branches;

CREATE POLICY branches_own_update ON public.branches;

CREATE POLICY branches_own_delete ON public.branches;

CREATE POLICY chips_own_select ON public.chips;

CREATE POLICY chips_own_insert ON public.chips;

CREATE POLICY chips_own_update ON public.chips;

CREATE POLICY chips_own_delete ON public.chips;

CREATE POLICY contact_sources_own_select ON public.contact_sources;

CREATE POLICY contact_sources_own_insert ON public.contact_sources;

CREATE POLICY contact_sources_own_update ON public.contact_sources;

CREATE POLICY contact_sources_own_delete ON public.contact_sources;

CREATE POLICY instances_own_select ON public.instances;

CREATE POLICY instances_own_insert ON public.instances;

CREATE POLICY instances_own_update ON public.instances;

CREATE POLICY instances_own_delete ON public.instances;

CREATE POLICY levels_own_select ON public.levels;

CREATE POLICY levels_own_insert ON public.levels;

CREATE POLICY levels_own_update ON public.levels;

CREATE POLICY levels_own_delete ON public.levels;

CREATE POLICY queues_own_select ON public.queues;

CREATE POLICY queues_own_insert ON public.queues;

CREATE POLICY queues_own_update ON public.queues;

CREATE POLICY queues_own_delete ON public.queues;

CREATE POLICY queue_items_own_select ON public.queue_items;

CREATE POLICY queue_items_own_insert ON public.queue_items;

CREATE POLICY queue_items_own_update ON public.queue_items;

CREATE POLICY queue_items_own_delete ON public.queue_items;

CREATE POLICY sents_own_select ON public.sents;

CREATE POLICY sents_own_insert ON public.sents;

CREATE POLICY sents_own_update ON public.sents;

CREATE POLICY sents_own_delete ON public.sents;

CREATE POLICY socials_own_select ON public.socials;

CREATE POLICY socials_own_insert ON public.socials;

CREATE POLICY socials_own_update ON public.socials;

CREATE POLICY socials_own_delete ON public.socials;

CREATE POLICY template_channels_own_select ON public.template_channels;

CREATE POLICY template_channels_own_insert ON public.template_channels;

CREATE POLICY template_channels_own_update ON public.template_channels;

CREATE POLICY template_channels_own_delete ON public.template_channels;

CREATE POLICY template_types_own_select ON public.template_types;

CREATE POLICY template_types_own_insert ON public.template_types;

CREATE POLICY template_types_own_update ON public.template_types;

CREATE POLICY template_types_own_delete ON public.template_types;

CREATE POLICY template_variables_own_select ON public.template_variables;

CREATE POLICY template_variables_own_insert ON public.template_variables;

CREATE POLICY template_variables_own_update ON public.template_variables;

CREATE POLICY template_variables_own_delete ON public.template_variables;

CREATE POLICY templates_own_select ON public.templates;

CREATE POLICY templates_own_insert ON public.templates;

CREATE POLICY templates_own_update ON public.templates;

CREATE POLICY templates_own_delete ON public.templates;

CREATE POLICY users_own_update ON public.users;

CREATE POLICY import_rules_select_own ON public.import_rules;

CREATE POLICY import_rules_insert_own ON public.import_rules;

CREATE POLICY import_rules_update_own ON public.import_rules;

CREATE POLICY import_rules_delete_own ON public.import_rules;

CREATE POLICY validation_rules_select_own ON public.validation_rules;

CREATE POLICY validation_rules_insert_own ON public.validation_rules;

CREATE POLICY validation_rules_update_own ON public.validation_rules;

CREATE POLICY validation_rules_delete_own ON public.validation_rules;

CREATE POLICY lead_validation_results_authenticated_read ON public.lead_validation_results;

CREATE POLICY lead_validation_attempts_select_own ON public.lead_validation_attempts;

CREATE POLICY profile_images_select_own ON storage.objects;

CREATE POLICY profile_images_insert_own ON storage.objects;

CREATE POLICY profile_images_update_own ON storage.objects;

CREATE POLICY profile_images_delete_own ON storage.objects;