#!/bin/sh
set -eu

backup_dir="${1:-/backups}"
timestamp="$(date +%Y%m%d-%H%M%S)"
outfile="${backup_dir}/beanconqueror-db-${DB_NAME:-beanconqueror}-${timestamp}.sql.gz"
checksum_file="${outfile}.sha256"

mkdir -p "${backup_dir}"
mysqldump \
  -h "${DB_HOST:?missing DB_HOST}" \
  -P "${DB_PORT:-3306}" \
  -u "${DB_USER:?missing DB_USER}" \
  -p"${DB_PASSWORD:?missing DB_PASSWORD}" \
  "${DB_NAME:?missing DB_NAME}" | gzip > "${outfile}"

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${outfile}" > "${checksum_file}"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "${outfile}" > "${checksum_file}"
else
  echo "WARN: sha256 tool missing, checksum file not created" >&2
fi

echo "Created backup ${outfile}"
if [ -f "${checksum_file}" ]; then
  echo "Created checksum ${checksum_file}"
fi
