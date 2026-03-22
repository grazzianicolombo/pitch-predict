/**
 * sourceDomains.js
 *
 * Catálogo centralizado de todos os domínios/URLs que os crawlers
 * do Pitch Predict monitoram. Usado pelo frontend de Fontes para
 * exibição e gestão, e pelos crawlers para verificar se uma fonte
 * está ativa antes de processar.
 *
 * Categorias:
 *  Marketing & Publicidade — publicações especializadas em mkt/propaganda
 *  Negócios & Finanças     — imprensa econômica e financeira
 *  Grandes Portais         — portais de notícias gerais
 *  Tech & Startups         — tech/startups BR
 *  APIs de Dados           — fontes via API (não web scraping)
 */

const DOMAINS = [
  // ─── Marketing & Publicidade ──────────────────────────────────────────────
  {
    id:       'rss_propmark',
    name:     'Propmark — RSS',
    url:      'https://propmark.com.br/feed/',
    domain:   'propmark.com.br',
    category: 'Marketing & Publicidade',
    method:   'RSS',
    description: '~15 artigos recentes por polling · coleta a cada 15 min',
  },
  {
    id:       'sitemap_propmark',
    name:     'Propmark — Sitemap',
    url:      'https://propmark.com.br/sitemap-posts.xml',
    domain:   'propmark.com.br',
    category: 'Marketing & Publicidade',
    method:   'Sitemap',
    description: '~50 mil URLs históricas · backfill sob demanda',
  },
  {
    id:       'rss_meioemensagem',
    name:     'Meio & Mensagem — RSS',
    url:      'https://www.meioemensagem.com.br/feed/',
    domain:   'meioemensagem.com.br',
    category: 'Marketing & Publicidade',
    method:   'RSS',
    description: 'Feed completo · todos os artigos são relevantes · coleta a cada 4h',
  },
  {
    id:       'rss_adnews',
    name:     'Adnews — RSS',
    url:      'https://adnews.com.br/feed/',
    domain:   'adnews.com.br',
    category: 'Marketing & Publicidade',
    method:   'RSS',
    description: 'Publicação especializada em publicidade · todos os artigos relevantes · coleta a cada 4h',
  },
  {
    id:       'search_meioemensagem',
    name:     'Meio & Mensagem — Busca',
    url:      'https://meioemensagem.com.br',
    domain:   'meioemensagem.com.br',
    category: 'Marketing & Publicidade',
    method:   'Tavily',
    description: 'Domínio prioritário nas buscas de sinais e agências',
  },
  {
    id:       'search_propmark',
    name:     'Propmark — Busca',
    url:      'https://propmark.com.br',
    domain:   'propmark.com.br',
    category: 'Marketing & Publicidade',
    method:   'Tavily',
    description: 'Busca direcionada por marca/agência/executivo',
  },
  {
    id:       'search_adnews',
    name:     'Adnews — Busca',
    url:      'https://adnews.com.br',
    domain:   'adnews.com.br',
    category: 'Marketing & Publicidade',
    method:   'Tavily',
    description: 'Busca corporativa search-first',
  },
  {
    id:       'search_b9',
    name:     'Brainstorm9 / B9',
    url:      'https://brainstorm9.com.br',
    domain:   'brainstorm9.com.br',
    category: 'Marketing & Publicidade',
    method:   'Tavily',
    description: 'Referência em criatividade e campanhas BR',
  },
  {
    id:       'search_portalprop',
    name:     'Portal da Propaganda',
    url:      'https://portaldapropaganda.com.br',
    domain:   'portaldapropaganda.com.br',
    category: 'Marketing & Publicidade',
    method:   'Tavily',
    description: 'Histórico de contas e pitchs do mercado',
  },
  {
    id:       'search_mundomarketing',
    name:     'Mundo do Marketing',
    url:      'https://mundodomarketing.com.br',
    domain:   'mundodomarketing.com.br',
    category: 'Marketing & Publicidade',
    method:   'Tavily',
    description: 'Cases e estratégias de marketing BR',
  },
  {
    id:       'search_anuncie_globo',
    name:     'Anuncie Globo',
    url:      'https://anuncie.globo.com',
    domain:   'anuncie.globo.com',
    category: 'Marketing & Publicidade',
    method:   'Tavily',
    description: 'Dados de anunciantes e campanhas Globo',
  },

  // ─── Negócios & Finanças ──────────────────────────────────────────────────
  {
    id:       'rss_exame',
    name:     'Exame — RSS',
    url:      'https://exame.com/feed/',
    domain:   'exame.com',
    category: 'Negócios & Finanças',
    method:   'RSS',
    description: 'Feed com conteúdo completo (content:encoded) · filtrado por marca/agência · coleta a cada 4h',
  },
  {
    id:       'rss_valor',
    name:     'Valor Econômico — RSS',
    url:      'https://valor.globo.com/rss/valor',
    domain:   'valor.globo.com',
    category: 'Negócios & Finanças',
    method:   'RSS',
    description: 'Resumos sem conteúdo completo · filtrado por marca/agência · coleta a cada 4h',
  },
  {
    id:       'search_valor',
    name:     'Valor Econômico — Busca',
    url:      'https://valor.com.br',
    domain:   'valor.com.br',
    category: 'Negócios & Finanças',
    method:   'Tavily',
    description: 'Resultados financeiros, fusões e aquisições',
  },
  {
    id:       'search_exame',
    name:     'Exame — Busca',
    url:      'https://exame.com',
    domain:   'exame.com',
    category: 'Negócios & Finanças',
    method:   'Tavily',
    description: 'Negócios, C-level e expansão de marcas',
  },
  {
    id:       'search_forbes',
    name:     'Forbes Brasil',
    url:      'https://forbes.com.br',
    domain:   'forbes.com.br',
    category: 'Negócios & Finanças',
    method:   'Tavily',
    description: 'Rankings, executivos e empresas de alto crescimento',
  },
  {
    id:       'search_infomoney',
    name:     'InfoMoney',
    url:      'https://infomoney.com.br',
    domain:   'infomoney.com.br',
    category: 'Negócios & Finanças',
    method:   'Tavily',
    description: 'Resultados financeiros e sinais de mercado de capital',
  },
  {
    id:       'search_istoedinheiro',
    name:     'IstoÉ Dinheiro',
    url:      'https://istoedinheiro.com.br',
    domain:   'istoedinheiro.com.br',
    category: 'Negócios & Finanças',
    method:   'Tavily',
    description: 'Negócios, finanças e reestruturações',
  },

  // ─── Grandes Portais ──────────────────────────────────────────────────────
  {
    id:       'search_estadao',
    name:     'Estadão',
    url:      'https://estadao.com.br',
    domain:   'estadao.com.br',
    category: 'Grandes Portais',
    method:   'Tavily',
    description: 'Cobertura econômica e política empresarial',
  },
  {
    id:       'search_folha',
    name:     'Folha de S.Paulo',
    url:      'https://folha.uol.com.br',
    domain:   'folha.uol.com.br',
    category: 'Grandes Portais',
    method:   'Tavily',
    description: 'Cobertura econômica e de negócios',
  },
  {
    id:       'search_g1',
    name:     'G1 / Globo',
    url:      'https://g1.globo.com',
    domain:   'g1.globo.com',
    category: 'Grandes Portais',
    method:   'Tavily',
    description: 'Notícias de economia e negócios',
  },
  {
    id:       'search_uol',
    name:     'UOL',
    url:      'https://uol.com.br',
    domain:   'uol.com.br',
    category: 'Grandes Portais',
    method:   'Tavily',
    description: 'Portal geral com seção de negócios e economia',
  },
  {
    id:       'search_globo',
    name:     'Globo.com',
    url:      'https://globo.com',
    domain:   'globo.com',
    category: 'Grandes Portais',
    method:   'Tavily',
    description: 'Portal de notícias gerais do Grupo Globo',
  },
  {
    id:       'search_econ_uol',
    name:     'Economia UOL',
    url:      'https://economia.uol.com.br',
    domain:   'economia.uol.com.br',
    category: 'Grandes Portais',
    method:   'Tavily',
    description: 'Seção de economia do UOL',
  },

  // ─── Tech & Startups ──────────────────────────────────────────────────────
  {
    id:       'search_canaltech',
    name:     'Canaltech',
    url:      'https://canaltech.com.br',
    domain:   'canaltech.com.br',
    category: 'Tech & Startups',
    method:   'Tavily',
    description: 'Tecnologia, inovação e transformação digital',
  },
  {
    id:       'search_startups',
    name:     'Startups.com.br',
    url:      'https://startups.com.br',
    domain:   'startups.com.br',
    category: 'Tech & Startups',
    method:   'Tavily',
    description: 'Ecossistema de startups e fintechs brasileiras',
  },

  // ─── APIs de Dados ────────────────────────────────────────────────────────
  {
    id:       'api_tavily',
    name:     'Tavily Search API',
    url:      'https://api.tavily.com',
    domain:   'tavily.com',
    category: 'APIs de Dados',
    method:   'API',
    description: 'Busca semântica em tempo real · usada pelos agentes 6, 7 e 8',
  },
  {
    id:       'api_pdl',
    name:     'People Data Labs',
    url:      'https://api.peopledatalabs.com',
    domain:   'peopledatalabs.com',
    category: 'APIs de Dados',
    method:   'API',
    description: 'Enriquecimento de executivos via API · Agente 4 · $0,001/registro',
  },
]

module.exports = { DOMAINS }
