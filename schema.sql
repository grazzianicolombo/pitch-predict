CREATE TABLE IF NOT EXISTS brands (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  segment TEXT,
  group_name TEXT,
  website TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agency_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  agency TEXT NOT NULL,
  scope TEXT,
  year_start INTEGER,
  year_end INTEGER,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing_leaders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT,
  linkedin TEXT,
  start_date DATE,
  end_date DATE,
  is_current BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sources (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT,
  active BOOLEAN DEFAULT TRUE,
  frequency TEXT DEFAULT 'daily',
  last_crawled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS collected_fields (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_variables (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  weight NUMERIC DEFAULT 1.0,
  type TEXT,
  description TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS articles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id uuid REFERENCES sources(id),
  title TEXT,
  content TEXT,
  url TEXT UNIQUE,
  published_at TIMESTAMPTZ,
  crawled_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brand_mentions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  article_id uuid REFERENCES articles(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES brands(id),
  context TEXT,
  signal_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE brands DISABLE ROW LEVEL SECURITY;
ALTER TABLE agency_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_leaders DISABLE ROW LEVEL SECURITY;
ALTER TABLE sources DISABLE ROW LEVEL SECURITY;
ALTER TABLE collected_fields DISABLE ROW LEVEL SECURITY;
ALTER TABLE model_variables DISABLE ROW LEVEL SECURITY;
ALTER TABLE articles DISABLE ROW LEVEL SECURITY;
ALTER TABLE brand_mentions DISABLE ROW LEVEL SECURITY;

INSERT INTO sources (name, url, type, frequency) VALUES
  ('Meio & Mensagem', 'https://www.meioemensagem.com.br', 'portal_noticias', 'daily'),
  ('Propmark', 'https://propmark.com.br', 'portal_noticias', 'daily'),
  ('Adnews', 'https://adnews.com.br', 'portal_noticias', 'daily'),
  ('E-Commerce Brasil', 'https://www.ecommercebrasil.com.br', 'portal_noticias', 'daily'),
  ('Exame', 'https://exame.com/marketing', 'portal_noticias', 'daily');

INSERT INTO model_variables (name, weight, type, description) VALUES
  ('Troca de CMO', 3.0, 'sinal', 'Mudança no líder de marketing aumenta chance de revisão de agência'),
  ('Tempo de contrato com agência', 2.5, 'indicador', 'Contratos acima de 3 anos têm maior probabilidade de revisão'),
  ('Notícias negativas sobre a relação', 2.0, 'sinal', 'Rumores ou críticas públicas sobre a parceria'),
  ('Expansão de negócio', 1.5, 'indicador', 'Crescimento da marca pode demandar nova agência'),
  ('Mudança de grupo controlador', 2.0, 'sinal', 'Fusões e aquisições geralmente levam à revisão de fornecedores'),
  ('Redução de verba publicitária', 1.5, 'indicador', 'Cortes de budget podem gerar revisão de contratos'),
  ('Abertura de vaga de marketing', 1.0, 'sinal', 'Contratações estratégicas indicam mudança de direção');

INSERT INTO collected_fields (name, category, description) VALUES
  ('Troca de executivo', 'pessoas', 'Menciona mudança de CMO, VP de marketing ou diretor'),
  ('Nome de agência', 'agencia', 'Qualquer menção a agências de publicidade'),
  ('Abertura de concorrência', 'pitch', 'Menção explícita a processo de pitch ou concorrência'),
  ('Verba publicitária', 'financeiro', 'Valores de investimento em comunicação'),
  ('Novo produto ou campanha', 'marca', 'Lançamentos que indicam atividade de marketing'),
  ('Conflito ou insatisfação', 'relacionamento', 'Sinais de tensão entre marca e agência');
