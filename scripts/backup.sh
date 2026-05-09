#!/bin/sh
set -eu

backup_dir="${1:-/backups}"
retention_days="${BACKUP_RETENTION_DAYS:-14}"
timestamp="$(date +%Y%m%d-%H%M%S)"
outfile="${backup_dir}/beanconqueror-db-${DB_NAME:-beanconqueror}-${timestamp}.sql.gz"
checksum_file="${outfile}.sha256"

mkdir -p "${backup_dir}"
MYSQL_PWD="${DB_PASSWORD:?missing DB_PASSWORD}" mysqldump \
  -h "${DB_HOST:?missing DB_HOST}" \
  -P "${DB_PORT:-3306}" \
  -u "${DB_USER:?missing DB_USER}" \
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

if [ "${retention_days}" -gt 0 ] 2>/dev/null; then
  find "${backup_dir}" -type f -name "beanconqueror-db-${DB_NAME:-beanconqueror}-*.sql.gz*" -mtime +"${retention_days}" -delete || true
  echo "Pruned backups older than ${retention_days} days in ${backup_dir}"
fi
