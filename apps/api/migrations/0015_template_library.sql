BEGIN;

CREATE TABLE template_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  sector_hint text NOT NULL,
  description text,
  schema_json jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO template_library (code, name, sector_hint, description, schema_json)
VALUES
(
  'CONTROLADORIA_PROVISOES',
  'Coleta de Provisões',
  'Controladoria',
  'Modelo inicial para coleta mensal de provisões entre áreas.',
  '{
    "fields": [
      {"key":"conta","label":"Conta","type":"TEXT","required":true},
      {"key":"descricao","label":"Descrição","type":"TEXT","required":true},
      {"key":"valor","label":"Valor","type":"MONEY","required":true,"min":0},
      {"key":"competencia","label":"Competência","type":"TEXT","required":true},
      {"key":"observacao","label":"Observação","type":"TEXT","required":false}
    ]
  }'::jsonb
),
(
  'FISCAL_DIVERGENCIAS',
  'Tratativa de Divergências Fiscais',
  'Fiscal',
  'Modelo inicial para justificativas de CFOP/NCM e divergências fiscais.',
  '{
    "fields": [
      {"key":"chave_documento","label":"Chave/Documento","type":"TEXT","required":true},
      {"key":"cfop","label":"CFOP","type":"TEXT","required":true},
      {"key":"ncm","label":"NCM","type":"TEXT","required":true},
      {"key":"valor","label":"Valor","type":"MONEY","required":true},
      {"key":"justificativa","label":"Justificativa","type":"TEXT","required":true}
    ]
  }'::jsonb
);

COMMIT;
