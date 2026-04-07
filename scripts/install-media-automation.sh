#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
MEDIA_SERVICES_HOME="${MEDIA_SERVICES_HOME:-$USER_HOME/services}"
RELEASES_DIR="${RELEASES_DIR:-$MEDIA_SERVICES_HOME/releases}"
PROOT_DISTRO_ALIAS="${PROOT_DISTRO_ALIAS:-debian-hs}"
PROOT_NO_SECCOMP="${PROOT_NO_SECCOMP:-1}"
CHROOT_ROOTFS="${CHROOT_ROOTFS:-/data/data/com.termux/files/usr/var/lib/proot-distro/installed-rootfs/$PROOT_DISTRO_ALIAS}"
SONARR_VERSION="${SONARR_VERSION:-v4.0.17.2952}"
RADARR_VERSION="${RADARR_VERSION:-v6.1.1.10360}"
PROWLARR_VERSION="${PROWLARR_VERSION:-v2.3.0.5236}"
BAZARR_VERSION="${BAZARR_VERSION:-v1.5.6}"
JELLYSEERR_VERSION="${JELLYSEERR_VERSION:-v3.1.0}"
INSTALL_SONARR="${INSTALL_SONARR:-1}"
INSTALL_RADARR="${INSTALL_RADARR:-1}"
INSTALL_PROWLARR="${INSTALL_PROWLARR:-1}"
INSTALL_BAZARR="${INSTALL_BAZARR:-0}"
INSTALL_JELLYSEERR="${INSTALL_JELLYSEERR:-0}"
CONFIGURE_ARR_STACK="${CONFIGURE_ARR_STACK:-1}"

mkdir -p "$MEDIA_SERVICES_HOME" "$RELEASES_DIR"

ensure_proot_plugin() {
    local plugin_path="/data/data/com.termux/files/usr/etc/proot-distro/$PROOT_DISTRO_ALIAS.sh"

    [ "$PROOT_DISTRO_ALIAS" = "debian-hs" ] || return 0
    [ -f "$plugin_path" ] && return 0

    cat > "$plugin_path" <<'EOF'
DISTRO_NAME="Debian (trixie, home-server)"
DISTRO_COMMENT="Debian without locale post-install hooks."

TARBALL_URL['aarch64']="https://easycli.sh/proot-distro/debian-trixie-aarch64-pd-v4.37.0.tar.xz"
TARBALL_SHA256['aarch64']="9bd3b19ff7cd300c7c7bf33124b726eb199f4bab9a3b1472f34749c6d12c9195"
TARBALL_URL['arm']="https://easycli.sh/proot-distro/debian-trixie-arm-pd-v4.37.0.tar.xz"
TARBALL_SHA256['arm']="af9b22fc1b82ccc665e484342af71c35a86f9f3dd525b0f423649976dded239f"
TARBALL_URL['i686']="https://easycli.sh/proot-distro/debian-trixie-i686-pd-v4.37.0.tar.xz"
TARBALL_SHA256['i686']="61f4c3b55d5defc1e9885efbe3b78d476f30d146eaffe45030916a77341c6768"
TARBALL_URL['x86_64']="https://easycli.sh/proot-distro/debian-trixie-x86_64-pd-v4.37.0.tar.xz"
TARBALL_SHA256['x86_64']="17eec851f40330cb3be77880aedd9e49c87d044f4ee5b02b3568c6aae0a5973b"

distro_setup() {
    :
}
EOF
}

install_debian() {
    if [ ! -d "$CHROOT_ROOTFS" ]; then
        ensure_proot_plugin
        PROOT_NO_SECCOMP="$PROOT_NO_SECCOMP" proot-distro install "$PROOT_DISTRO_ALIAS"
    fi

    su -c "mkdir -p '$CHROOT_ROOTFS/dev' '$CHROOT_ROOTFS/proc' '$CHROOT_ROOTFS/sys'"
    su -c "grep -q ' $CHROOT_ROOTFS/dev ' /proc/mounts || mount --bind /dev '$CHROOT_ROOTFS/dev'"
    su -c "grep -q ' $CHROOT_ROOTFS/proc ' /proc/mounts || mount -t proc proc '$CHROOT_ROOTFS/proc'"
    su -c "grep -q ' $CHROOT_ROOTFS/sys ' /proc/mounts || mount -t sysfs sysfs '$CHROOT_ROOTFS/sys'"
    su -c "chroot '$CHROOT_ROOTFS' /usr/bin/env PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin DEBIAN_FRONTEND=noninteractive DEBCONF_NOWARNINGS=yes /bin/sh -c 'apt-get -o APT::Sandbox::User=root -o Dpkg::Use-Pty=0 update && apt-get -o APT::Sandbox::User=root -o Dpkg::Use-Pty=0 install -y ca-certificates curl sqlite3 libicu-dev libssl-dev libstdc++6 tzdata'"
}

download_release() {
    local url="$1"
    local archive="$2"

    if [ -s "$archive" ]; then
        return 0
    fi

    curl -fL "$url" -o "$archive"
}

install_servarr_app() {
    local slug="$1"
    local url="$2"
    local binary_name="$3"
    local archive="$RELEASES_DIR/$slug.tar.gz"
    local target="$CHROOT_ROOTFS/opt/home-server/$slug/app"

    download_release "$url" "$archive"
    rm -rf "$target"
    mkdir -p "$target"
    tar -xzf "$archive" -C "$target" --strip-components=1
    mkdir -p "$CHROOT_ROOTFS/opt/home-server/$slug/data"
    chmod +x "$target/$binary_name" || true
}

install_bazarr() {
    local archive="$RELEASES_DIR/bazarr.zip"
    local target="$MEDIA_SERVICES_HOME/bazarr/app"
    local venv="$MEDIA_SERVICES_HOME/bazarr/venv"

    download_release "https://github.com/morpheus65535/bazarr/releases/download/$BAZARR_VERSION/bazarr.zip" "$archive"
    rm -rf "$target"
    mkdir -p "$target"
    unzip -oq "$archive" -d "$target"
    python -m venv "$venv"
    "$venv/bin/pip" install --upgrade pip wheel setuptools
    "$venv/bin/pip" install -r "$target/requirements.txt"
}

install_jellyseerr() {
    local archive="$RELEASES_DIR/jellyseerr.tar.gz"
    local target="$MEDIA_SERVICES_HOME/jellyseerr/app"
    local package_manager=""

    download_release "https://codeload.github.com/Fallenbagel/jellyseerr/tar.gz/refs/tags/$JELLYSEERR_VERSION" "$archive"
    rm -rf "$target"
    mkdir -p "$target"
    tar -xzf "$archive" -C "$target" --strip-components=1
    cd "$target"

    package_manager="$(node -p "require('./package.json').packageManager || ''" 2>/dev/null || true)"
    if [ -n "$package_manager" ] && printf '%s' "$package_manager" | grep -q '^pnpm@'; then
        if command -v corepack >/dev/null 2>&1; then
            corepack enable
            CYPRESS_INSTALL_BINARY=0 corepack pnpm install --frozen-lockfile --config.engine-strict=false
            CYPRESS_INSTALL_BINARY=0 corepack pnpm build --config.engine-strict=false
        else
            CYPRESS_INSTALL_BINARY=0 npx --yes pnpm@10.24.0 install --frozen-lockfile --config.engine-strict=false
            CYPRESS_INSTALL_BINARY=0 npx --yes pnpm@10.24.0 build --config.engine-strict=false
        fi
    else
        CYPRESS_INSTALL_BINARY=0 npm install --legacy-peer-deps
        npm run build
    fi
}

install_debian
[ "$INSTALL_SONARR" = "1" ] && install_servarr_app sonarr "https://github.com/Sonarr/Sonarr/releases/download/$SONARR_VERSION/Sonarr.main.${SONARR_VERSION#v}.linux-arm64.tar.gz" "Sonarr"
[ "$INSTALL_RADARR" = "1" ] && install_servarr_app radarr "https://github.com/Radarr/Radarr/releases/download/$RADARR_VERSION/Radarr.master.${RADARR_VERSION#v}.linux-core-arm64.tar.gz" "Radarr"
[ "$INSTALL_PROWLARR" = "1" ] && install_servarr_app prowlarr "https://github.com/Prowlarr/Prowlarr/releases/download/$PROWLARR_VERSION/Prowlarr.master.${PROWLARR_VERSION#v}.linux-core-arm64.tar.gz" "Prowlarr"
[ "$INSTALL_BAZARR" = "1" ] && install_bazarr
[ "$INSTALL_JELLYSEERR" = "1" ] && install_jellyseerr
[ "$CONFIGURE_ARR_STACK" = "1" ] && "$USER_HOME/home-server/scripts/configure-arr-stack.sh"
