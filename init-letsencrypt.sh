#!/bin/bash
# Run this ONCE on the DigitalOcean server to obtain SSL certificates.
# After it completes, run: docker compose up -d

set -e

domains=(bookplus.pro www.bookplus.pro api.bookplus.pro)
email="bookplusdigital@gmail.com"
data_path="./certbot"
rsa_key_size=4096
staging=0   # Set to 1 to test without hitting Let's Encrypt rate limits

# ── Confirm overwrite ────────────────────────────────────────────────────────
if [ -d "$data_path" ]; then
  read -rp "Existing certbot data found. Replace certificate? (y/N) " decision
  if [ "$decision" != "Y" ] && [ "$decision" != "y" ]; then
    exit
  fi
fi

# ── Download recommended TLS options ────────────────────────────────────────
if [ ! -e "$data_path/conf/options-ssl-nginx.conf" ] || [ ! -e "$data_path/conf/ssl-dhparams.pem" ]; then
  echo "### Downloading recommended TLS parameters ..."
  mkdir -p "$data_path/conf"
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf \
    > "$data_path/conf/options-ssl-nginx.conf"
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem \
    > "$data_path/conf/ssl-dhparams.pem"
fi

# ── Create dummy certificate so nginx can start ──────────────────────────────
echo "### Creating dummy certificate for ${domains[0]} ..."
mkdir -p "$data_path/conf/live/${domains[0]}"
docker compose run --rm --entrypoint "openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
  -keyout /etc/letsencrypt/live/${domains[0]}/privkey.pem \
  -out    /etc/letsencrypt/live/${domains[0]}/fullchain.pem \
  -subj   '/CN=localhost'" certbot

# ── Start nginx with dummy cert ──────────────────────────────────────────────
echo "### Starting nginx ..."
docker compose up --force-recreate -d nginx

# ── Remove dummy cert ────────────────────────────────────────────────────────
echo "### Removing dummy certificate ..."
docker compose run --rm --entrypoint "rm -Rf \
  /etc/letsencrypt/live/${domains[0]} \
  /etc/letsencrypt/archive/${domains[0]} \
  /etc/letsencrypt/renewal/${domains[0]}.conf" certbot

# ── Request real certificate ─────────────────────────────────────────────────
echo "### Requesting Let's Encrypt certificate for: ${domains[*]} ..."
domain_args=""
for domain in "${domains[@]}"; do
  domain_args="$domain_args -d $domain"
done

[ "$email" = "" ] && email_arg="--register-unsafely-without-email" || email_arg="--email $email"
[ "$staging" -ne "0" ] && staging_arg="--staging" || staging_arg=""

docker compose run --rm --entrypoint "certbot certonly --webroot -w /var/www/certbot \
  $staging_arg \
  $email_arg \
  $domain_args \
  --rsa-key-size $rsa_key_size \
  --agree-tos \
  --force-renewal" certbot

# ── Reload nginx with real cert ──────────────────────────────────────────────
echo "### Reloading nginx ..."
docker compose exec nginx nginx -s reload

echo ""
echo "✓ SSL certificates issued. Now bring up the full stack:"
echo "  docker compose up -d"
