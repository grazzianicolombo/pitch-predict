#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# start.sh — Script de inicialização do backend em produção (Railway)
#
# Estratégia de segurança:
#   1. O único segredo no Railway é DOPPLER_TOKEN (service token read-only)
#   2. Este script instala o Doppler CLI se não estiver presente
#   3. Executa o app via "doppler run" — todas as variáveis são injetadas
#      em memória pelo Doppler, nunca escritas em disco
#
# NUNCA adicione variáveis de ambiente reais aqui.
# NUNCA faça commit de .env com valores reais.
# ─────────────────────────────────────────────────────────────────────────────

set -e  # Aborta se qualquer comando falhar

# ── Valida que DOPPLER_TOKEN está presente ────────────────────────────────────
if [ -z "$DOPPLER_TOKEN" ]; then
  echo "ERRO: DOPPLER_TOKEN não está definido."
  echo "Configure a variável DOPPLER_TOKEN no painel do Railway com um Service Token."
  echo "Crie em: https://dashboard.doppler.com → Projeto → Access → Service Tokens"
  exit 1
fi

# ── Instala Doppler CLI se não estiver no PATH ────────────────────────────────
if ! command -v doppler > /dev/null 2>&1; then
  echo "Instalando Doppler CLI..."
  # Instalação oficial sem redirecionar para sh via pipe (mais seguro)
  curl -Ls --tlsv1.2 --proto "=https" \
    "https://cli.doppler.com/install.sh" -o /tmp/doppler-install.sh
  # Verifica que o script foi baixado corretamente
  if [ ! -s /tmp/doppler-install.sh ]; then
    echo "ERRO: Falha ao baixar o instalador do Doppler CLI."
    exit 1
  fi
  sh /tmp/doppler-install.sh --no-install-completion 2>&1
  rm -f /tmp/doppler-install.sh
  echo "Doppler CLI instalado com sucesso."
fi

echo "Doppler CLI version: $(doppler --version)"

# ── Inicia o app com variáveis injetadas pelo Doppler ─────────────────────────
# --token usa o DOPPLER_TOKEN da env do Railway
# --project e --config são resolvidos pelo token (service token é project-scoped)
# As variáveis são injetadas no process.env do Node — nunca gravadas em disco
echo "Iniciando servidor via Doppler..."
exec doppler run \
  --token "$DOPPLER_TOKEN" \
  -- node src/server.js
