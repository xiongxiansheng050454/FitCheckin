BEGIN;

CREATE TABLE public.fitcheckin_profiles (
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 128),
  entity_id text NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 100),
  body jsonb,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, entity_id),
  CHECK ((deleted AND body IS NULL) OR (NOT deleted AND jsonb_typeof(body) = 'object'))
);
CREATE TABLE public.fitcheckin_exercises (LIKE public.fitcheckin_profiles INCLUDING ALL);
CREATE TABLE public.fitcheckin_templates (LIKE public.fitcheckin_profiles INCLUDING ALL);
CREATE TABLE public.fitcheckin_overrides (LIKE public.fitcheckin_profiles INCLUDING ALL);
CREATE TABLE public.fitcheckin_records (LIKE public.fitcheckin_profiles INCLUDING ALL);
ALTER TABLE public.fitcheckin_profiles ADD CHECK (entity_id = 'profile' AND NOT deleted);
ALTER TABLE public.fitcheckin_records ADD CHECK (NOT deleted AND body->>'id' = entity_id AND body->>'date' = entity_id);

CREATE TABLE public.fitcheckin_operations (
  owner_id text NOT NULL,
  operation_id text NOT NULL,
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, operation_id)
);

-- This view is backend-only; clients receive a deliberately smaller entity envelope.
CREATE VIEW public.fitcheckin_entities AS
SELECT owner_id, 'profile'::text AS kind, entity_id, body, revision, deleted FROM public.fitcheckin_profiles
UNION ALL SELECT owner_id, 'exercise', entity_id, body, revision, deleted FROM public.fitcheckin_exercises
UNION ALL SELECT owner_id, 'template', entity_id, body, revision, deleted FROM public.fitcheckin_templates
UNION ALL SELECT owner_id, 'override', entity_id, body, revision, deleted FROM public.fitcheckin_overrides
UNION ALL SELECT owner_id, 'record', entity_id, body, revision, deleted FROM public.fitcheckin_records;

CREATE FUNCTION public.fitcheckin_mutate(p_owner text, p_operation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_kind text := p_operation->>'kind';
  v_id text := p_operation->>'id';
  v_operation_id text := p_operation->>'operationId';
  v_table text;
  v_base bigint;
  v_deleted boolean;
  v_body jsonb := p_operation->'body';
  v_current record;
  v_exists boolean;
  v_previous record;
  v_entity jsonb;
  v_result jsonb;
  v_occurred timestamptz;
  v_started timestamptz;
BEGIN
  IF p_owner IS NULL OR length(p_owner) NOT BETWEEN 1 AND 128
    OR jsonb_typeof(p_operation) IS DISTINCT FROM 'object'
    OR v_operation_id IS NULL OR v_operation_id !~ '^[A-Za-z0-9_-]{1,100}$'
    OR v_id IS NULL OR v_id !~ '^[A-Za-z0-9_-]{1,100}$'
    OR octet_length(p_operation::text) > 600000 THEN
    RETURN jsonb_build_object('code', 'VALIDATION');
  END IF;

  -- Lock the absent-operation case too; no check-then-insert race can double-apply.
  PERFORM pg_advisory_xact_lock(hashtextextended('fitcheckin:operation:' || p_owner || ':' || v_operation_id, 0));
  SELECT payload, result INTO v_previous FROM public.fitcheckin_operations
    WHERE owner_id = p_owner AND operation_id = v_operation_id;
  IF FOUND THEN
    IF v_previous.payload = p_operation THEN RETURN v_previous.result; END IF;
    RETURN jsonb_build_object('code', 'OPERATION_REUSED');
  END IF;

  v_table := CASE v_kind
    WHEN 'profile' THEN 'fitcheckin_profiles' WHEN 'exercise' THEN 'fitcheckin_exercises'
    WHEN 'template' THEN 'fitcheckin_templates' WHEN 'override' THEN 'fitcheckin_overrides'
    WHEN 'record' THEN 'fitcheckin_records' END;
  IF v_table IS NULL OR jsonb_typeof(p_operation->'baseRevision') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_operation->'deleted') IS DISTINCT FROM 'boolean'
    OR p_operation->>'baseRevision' !~ '^[0-9]+$' THEN
    RETURN jsonb_build_object('code', 'VALIDATION');
  END IF;
  BEGIN
    v_base := (p_operation->>'baseRevision')::bigint;
    v_deleted := (p_operation->>'deleted')::boolean;
    v_occurred := (p_operation->>'occurredAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('code', 'VALIDATION');
  END;
  IF v_base < 0 OR v_base >= 9007199254740991 OR v_occurred IS NULL OR v_occurred > clock_timestamp()
    OR (v_deleted AND (v_kind IN ('profile', 'record') OR v_body IS DISTINCT FROM 'null'::jsonb))
    OR (NOT v_deleted AND (jsonb_typeof(v_body) IS DISTINCT FROM 'object' OR v_body->>'id' IS DISTINCT FROM v_id))
    OR (v_kind = 'profile' AND v_id <> 'profile') THEN
    RETURN jsonb_build_object('code', 'VALIDATION');
  END IF;
  IF v_kind = 'record' THEN
    BEGIN v_started := (v_body->>'startedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('code', 'VALIDATION'); END;
    IF v_body->>'date' IS DISTINCT FROM v_id OR v_id IS DISTINCT FROM to_char(v_occurred AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')
      OR v_started IS NULL OR v_started > v_occurred
      OR v_id IS DISTINCT FROM to_char(v_started AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')
      OR jsonb_typeof(v_body->'completed') IS DISTINCT FROM 'array'
      OR jsonb_typeof(v_body->'items') IS DISTINCT FROM 'array'
      OR jsonb_array_length(v_body->'items') > 50
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_body->'completed') AS c(value)
        WHERE jsonb_typeof(c.value) <> 'string' OR NOT EXISTS
          (SELECT 1 FROM jsonb_array_elements(v_body->'items') AS i(value) WHERE i.value->'entryId' = c.value))
      OR (SELECT count(*) <> count(DISTINCT value) FROM jsonb_array_elements(v_body->'completed')) THEN
      RETURN jsonb_build_object('code', 'VALIDATION');
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('fitcheckin:entity:' || p_owner || ':' || v_kind || ':' || v_id, 0));
  EXECUTE format('SELECT body, revision, deleted FROM public.%I WHERE owner_id = $1 AND entity_id = $2 FOR UPDATE', v_table)
    INTO v_current USING p_owner, v_id;
  v_exists := v_current.revision IS NOT NULL;
  IF v_exists THEN
    v_entity := jsonb_build_object('kind', v_kind, 'id', v_id, 'body', v_current.body,
      'revision', v_current.revision, 'deleted', v_current.deleted);
  ELSE v_entity := 'null'::jsonb; END IF;
  IF v_base <> CASE WHEN v_exists THEN v_current.revision ELSE 0 END THEN
    v_result := jsonb_build_object('code', 'CONFLICT', 'entity', v_entity);
  ELSIF v_kind = 'record' AND v_exists AND (v_current.body - 'completed') IS DISTINCT FROM (v_body - 'completed') THEN
    v_result := jsonb_build_object('code', 'IMMUTABLE_RECORD');
  ELSE
    EXECUTE format('INSERT INTO public.%I (owner_id, entity_id, body, revision, deleted)
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT (owner_id, entity_id)
      DO UPDATE SET body = EXCLUDED.body, revision = EXCLUDED.revision, deleted = EXCLUDED.deleted, updated_at = now()', v_table)
      USING p_owner, v_id, CASE WHEN v_deleted THEN NULL ELSE v_body END, v_base + 1, v_deleted;
    v_entity := jsonb_build_object('kind', v_kind, 'id', v_id,
      'body', CASE WHEN v_deleted THEN NULL ELSE v_body END, 'revision', v_base + 1, 'deleted', v_deleted);
    v_result := jsonb_build_object('code', 0, 'entity', v_entity);
  END IF;
  INSERT INTO public.fitcheckin_operations (owner_id, operation_id, payload, result)
    VALUES (p_owner, v_operation_id, p_operation, v_result);
  RETURN v_result;
END;
$function$;

CREATE FUNCTION public.fitcheckin_pull(p_owner text, p_after_kind text DEFAULT '', p_after_id text DEFAULT '', p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE v_entities jsonb; v_kind text; v_id text; v_more boolean;
BEGIN
  IF p_owner IS NULL OR length(p_owner) NOT BETWEEN 1 AND 128 OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid pull parameters';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'id', entity_id, 'body', body,
      'revision', revision, 'deleted', deleted) ORDER BY kind COLLATE "C", entity_id COLLATE "C"), '[]'::jsonb)
    INTO v_entities
    FROM (SELECT * FROM public.fitcheckin_entities WHERE owner_id = p_owner
      AND (kind COLLATE "C", entity_id COLLATE "C") > (p_after_kind COLLATE "C", p_after_id COLLATE "C")
      ORDER BY kind COLLATE "C", entity_id COLLATE "C" LIMIT p_limit) AS page;
  IF jsonb_array_length(v_entities) = 0 THEN
    RETURN jsonb_build_object('entities', v_entities, 'cursor', NULL);
  END IF;
  v_kind := v_entities->-1->>'kind'; v_id := v_entities->-1->>'id';
  SELECT EXISTS(SELECT 1 FROM public.fitcheckin_entities WHERE owner_id = p_owner
    AND (kind COLLATE "C", entity_id COLLATE "C") > (v_kind COLLATE "C", v_id COLLATE "C")) INTO v_more;
  RETURN jsonb_build_object('entities', v_entities, 'cursor',
    CASE WHEN v_more THEN jsonb_build_object('kind', v_kind, 'id', v_id) ELSE NULL END);
END;
$function$;

ALTER TABLE public.fitcheckin_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fitcheckin_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fitcheckin_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fitcheckin_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fitcheckin_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fitcheckin_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fitcheckin_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fitcheckin_exercises FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fitcheckin_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fitcheckin_overrides FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fitcheckin_records FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fitcheckin_operations FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.fitcheckin_profiles, public.fitcheckin_exercises, public.fitcheckin_templates,
  public.fitcheckin_overrides, public.fitcheckin_records, public.fitcheckin_operations,
  public.fitcheckin_entities FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.fitcheckin_profiles, public.fitcheckin_exercises,
  public.fitcheckin_templates, public.fitcheckin_overrides, public.fitcheckin_records,
  public.fitcheckin_operations TO service_role;
GRANT SELECT ON public.fitcheckin_entities TO service_role;
REVOKE ALL ON FUNCTION public.fitcheckin_mutate(text, jsonb), public.fitcheckin_pull(text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fitcheckin_mutate(text, jsonb), public.fitcheckin_pull(text, text, text, integer)
  TO service_role;

COMMIT;
