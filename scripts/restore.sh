#!/bin/sh
set -eu

backup_file="${1:?usage: restore.sh <backup.sql.gz> [--dry-run]}"
mode="${2:-}"
checksum_file="${backup_file}.sha256"

if [ -f "${checksum_file}" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "${checksum_file}"
  elif command -v shasum >/dev/null 2>&1; then
    expected="$(cut -d' ' -f1 < "${checksum_file}")"
    actual="$(shasum -a 256 "${backup_file}" | cut -d' ' -f1)"
    [ "${expected}" = "${actual}" ]
  fi
fi

if [ "${mode}" = "--dry-run" ]; then
  gunzip -t "${backup_file}"
  echo "Dry run passed: gzip stream valid for ${backup_file}"
  exit 0
fi

gunzip -c "${backup_file}" | MYSQL_PWD="${DB_PASSWORD:?missing DB_PASSWORD}" mysql \
  -h "${DB_HOST:?missing DB_HOST}" \
  -P "${DB_PORT:-3306}" \
  -u "${DB_USER:?missing DB_USER}" \
  "${DB_NAME:?missing DB_NAME}"

echo "Restore completed from ${backup_file}"
