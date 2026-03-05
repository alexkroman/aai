import { Hono } from "@hono/hono";

const INSTALL_SCRIPT = `#!/bin/sh
set -e

REPO="alexkroman/aai"
INSTALL_DIR="\${AAI_INSTALL_DIR:-\$HOME/.aai/bin}"

# Verify curl is available
if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required to install aai." >&2
  exit 1
fi

# Detect OS and architecture
OS="\$(uname -s)"
ARCH="\$(uname -m)"

case "\$OS" in
  Darwin) os="darwin" ;;
  Linux)  os="linux" ;;
  *) echo "Unsupported OS: \$OS" >&2; exit 1 ;;
esac

case "\$ARCH" in
  arm64|aarch64) arch="arm64" ;;
  x86_64)        arch="x64" ;;
  *) echo "Unsupported architecture: \$ARCH" >&2; exit 1 ;;
esac

ARTIFACT="aai-\${os}-\${arch}"

# Get latest version from GitHub (retry up to 3 times)
n=0
VERSION=""
while [ -z "\$VERSION" ] && [ "\$n" -lt 3 ]; do
  VERSION="\$(curl -fsSL "https://api.github.com/repos/\$REPO/releases/latest" | grep '"tag_name"' | sed 's/.*"v\\(.*\\)".*/\\1/')" || true
  n=\$((n + 1))
  [ -z "\$VERSION" ] && [ "\$n" -lt 3 ] && sleep 2
done

if [ -z "\$VERSION" ]; then
  echo "Failed to get latest version" >&2
  exit 1
fi

URL="https://github.com/\$REPO/releases/download/v\${VERSION}/\${ARTIFACT}.tar.gz"

echo "Installing aai v\$VERSION (\$os/\$arch)..."

# Download and extract
mkdir -p "\$INSTALL_DIR"
TMP="\$(mktemp -d)"
trap 'rm -rf "\$TMP"' EXIT

if ! curl -fsSL "\$URL" | tar xz -C "\$TMP"; then
  echo "Download failed. Check that a release exists for \$os/\$arch." >&2
  exit 1
fi
mv "\$TMP/aai" "\$INSTALL_DIR/aai"
chmod +x "\$INSTALL_DIR/aai"

# Verify the binary works
if ! "\$INSTALL_DIR/aai" --version >/dev/null 2>&1; then
  echo "Warning: installed binary does not appear to work" >&2
fi

echo "Installed aai to \$INSTALL_DIR/aai"

# Add to PATH if needed (skip if already present)
case ":\$PATH:" in
  *":\$INSTALL_DIR:"*) ;;
  *)
    SHELL_NAME="\$(basename "\$SHELL")"
    case "\$SHELL_NAME" in
      zsh)  RC="\$HOME/.zshrc" ;;
      bash) RC="\$HOME/.bashrc" ;;
      fish) RC="\$HOME/.config/fish/config.fish" ;;
      *)    RC="" ;;
    esac
    if [ -n "\$RC" ]; then
      PATH_LINE="export PATH=\\"\\\$HOME/.aai/bin:\\\$PATH\\""
      if [ -f "\$RC" ] && grep -qF ".aai/bin" "\$RC"; then
        echo "\$INSTALL_DIR already in \$RC"
      else
        echo "" >> "\$RC"
        echo "\$PATH_LINE" >> "\$RC"
        echo "Added \$INSTALL_DIR to PATH in \$RC"
      fi
      echo "Run: source \$RC"
    else
      echo "Add \$INSTALL_DIR to your PATH"
    fi
    ;;
esac

echo "Run 'aai' to get started"
`;

export function installRoute(): Hono {
  const routes = new Hono();
  routes.get("/install", (c) => {
    return c.body(INSTALL_SCRIPT, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  });
  return routes;
}
