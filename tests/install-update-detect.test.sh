#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

workdir="$tmpdir/repo"
bindir="$tmpdir/bin"
mkdir -p "$workdir" "$bindir"

cp "$repo_root/install.sh" "$workdir/install.sh"
cp "$repo_root/docker-compose.yml" "$workdir/docker-compose.yml"
cp "$repo_root/Dockerfile" "$workdir/Dockerfile"

cat > "$bindir/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$*" == *"info"* ]]; then
  exit 0
fi

if [[ "$*" == *"inspect s3pia --format"*"{{.State.Status}}"* ]]; then
  printf 'running\n'
  exit 0
fi

if [[ "$*" == *"inspect s3pia --format"*"{{range .Mounts}}{{.Type}}|{{.Source}}|{{.Destination}}|{{.RW}}"* ]]; then
  printf '%s\n' \
    'volume|s3pia_s3pia-workspace|/app/ws|true' \
    'bind|/host/config|/app/config|true' \
    'bind|/host/custom|/app/custom|false'
  exit 0
fi

if [[ "$*" == *"inspect s3pia --format"*"{{if and (eq .Destination \"/app/ws\") (eq .Type \"bind\")}}{{.Source}}{{end}}{{end}}"* ]]; then
  exit 0
fi

if [[ "$*" == *"inspect s3pia"* ]]; then
  exit 0
fi

exit 0
EOF
chmod +x "$bindir/docker"

cat > "$bindir/docker-compose" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "$*" in
  *"version"*)
    exit 0
    ;;
  *"up -d --build"*)
    exit 0
    ;;
esac

exit 0
EOF
chmod +x "$bindir/docker-compose"

cat > "$bindir/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exit 0
EOF
chmod +x "$bindir/curl"

(
  cd "$workdir"
  PATH="$bindir:$PATH" S3PIA_PROMPT_SOURCE=stdin bash ./install.sh <<'EOF_INPUT'
1
EOF_INPUT
) > "$tmpdir/output.txt" 2>&1

if ! grep -Fq "Current mounts:" "$tmpdir/output.txt"; then
  printf 'expected current mount summary in installer output\n' >&2
  exit 1
fi

for expected in \
  "/app/ws" \
  "/host/config" \
  "/host/custom" \
  "s3pia_s3pia-workspace"; do
  if ! grep -Fq "$expected" "$tmpdir/output.txt"; then
    printf 'expected mount summary to include %s\n' "$expected" >&2
    exit 1
  fi
done

override_file="$workdir/docker-compose.override.yml"

for expected in \
  "type: volume" \
  "source: 's3pia_s3pia-workspace'" \
  "target: '/app/ws'" \
  "source: '/host/config'" \
  "target: '/app/config'" \
  "source: '/host/custom'" \
  "target: '/app/custom'" \
  "read_only: true"; do
  if ! grep -Fq "$expected" "$override_file"; then
    printf 'expected override to include %s\n' "$expected" >&2
    exit 1
  fi
done
