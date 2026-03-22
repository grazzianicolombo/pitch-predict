require('dotenv').config({ override: true })
const https = require('https')

function pdlGet(path, params) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString()
    const options = {
      hostname: 'api.peopledatalabs.com',
      path: `/v5/${path}?${qs}`,
      headers: { 'X-Api-Key': process.env.PDL_API_KEY }
    }
    https.get(options, res => {
      let body = ''
      res.on('data', d => body += d)
      res.on('end', () => {
        try { resolve(JSON.parse(body)) }
        catch(e) { reject(new Error('JSON inválido: ' + body.slice(0, 200))) }
      })
    }).on('error', reject)
  })
}

async function test() {

  // Pessoas: CMO/Diretor de Marketing Ambev Brasil (sem LIMIT no SQL)
  console.log('=== CMO/Diretor Marketing Ambev ===')
  const sql = "SELECT * FROM person WHERE job_company_name='ambev' AND job_company_location_country='brazil' AND job_title_role='marketing' AND job_title_levels IN ('director','vp','c_suite')"
  const p = await pdlGet('person/search', { sql, size: 5 })
  console.log('Status:', p.status, '| Total:', p.total)
  if (p.data?.length) {
    p.data.forEach(person => {
      console.log('  Nome:', person.full_name)
      console.log('  Cargo:', person.job_title)
      console.log('  Localização:', person.job_company_location_name)
      console.log('  LinkedIn:', person.linkedin_url)
      console.log()
    })
  } else {
    console.log('Erro/sem dados:', JSON.stringify(p).slice(0, 300))
  }

  // Natura CMO
  console.log('=== CMO Marketing Natura ===')
  const sql2 = "SELECT * FROM person WHERE job_company_name='natura' AND job_company_location_country='brazil' AND job_title_role='marketing' AND job_title_levels IN ('director','vp','c_suite')"
  const p2 = await pdlGet('person/search', { sql: sql2, size: 5 })
  console.log('Status:', p2.status, '| Total:', p2.total)
  if (p2.data?.length) {
    p2.data.forEach(person => {
      console.log('  Nome:', person.full_name)
      console.log('  Cargo:', person.job_title)
      console.log('  LinkedIn:', person.linkedin_url)
    })
  }
  console.log()

  // Company enrichment de várias marcas BR
  console.log('=== EMPRESAS (enrich) ===')
  const marcas = ['Ambev', 'Natura', 'Itaú Unibanco', 'Magazine Luiza', 'Nubank', 'Bradesco', 'Vivo', 'iFood']
  for (const name of marcas) {
    const c = await pdlGet('company/enrich', { name, country: 'brazil' })
    if (c.status === 200) {
      console.log(`  ${name}: ${c.employee_count} funcionários | ${c.industry} | ${c.linkedin_url}`)
    } else {
      console.log(`  ${name}: não encontrado (${c.status})`)
    }
  }
}

test().catch(e => console.error('ERRO:', e.message))
