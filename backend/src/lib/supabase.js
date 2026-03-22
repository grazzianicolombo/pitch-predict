const { createClient } = require('@supabase/supabase-js')

// Backend usa service key — é um servidor confiável, nunca exposto ao browser.
// A service key bypassa RLS, garantindo acesso total às tabelas do pipeline.
// O anon key não é usado no backend — toda segurança de acesso é feita pelo
// middleware requireAuth (JWT) nas rotas Express.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = supabase
