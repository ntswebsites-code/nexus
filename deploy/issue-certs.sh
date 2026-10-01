#!/bin/bash
# Issue Let's Encrypt certificates for every Nexus hostname once DNS points here.
#   bash /opt/matanho-nexus/deploy/issue-certs.sh admin@matanho.com
set -euo pipefail

EMAIL="${1:?usage: issue-certs.sh <contact-email>}"
SERVER_IP="$(curl -s4 https://ifconfig.me)"
HOSTS=(nexus.matanho.com investor.nexus.matanho.com onboarding.nexus.matanho.com company.nexus.matanho.com custodian.nexus.matanho.com api.nexus.matanho.com)

for h in "${HOSTS[@]}"; do
  ip="$(getent ahostsv4 "$h" | awk 'NR==1{print $1}')"
  if [ "$ip" != "$SERVER_IP" ]; then
    echo "DNS not ready: $h -> ${ip:-<none>} (expected $SERVER_IP)"; exit 1
  fi
done

args=()
for h in "${HOSTS[@]}"; do args+=(-d "$h"); done
certbot --nginx --non-interactive --agree-tos --redirect -m "$EMAIL" --cert-name nexus.matanho.com "${args[@]}"
nginx -t && systemctl reload nginx
echo "Certificates issued for: ${HOSTS[*]}"
