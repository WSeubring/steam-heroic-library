#!/bin/bash
# Install steam-heroic-library for the current user:
#   - links bin/ scripts into ~/.local/bin
#   - makes Steam's launcher run the sync first (desktop entry override,
#     plus the Game Mode session on Bazzite/SteamOS-like systems)
#   - seeds ~/.config/heroic-steam-sync/categories.json from the example
#   - builds and installs the Millennium plugin (needs bun and Millennium)
# Re-running it is safe.
set -euo pipefail

repo=$(cd "$(dirname "$0")" && pwd)
bin=$HOME/.local/bin
apps=$HOME/.local/share/applications
config=$HOME/.config/heroic-steam-sync

echo "== scripts"
mkdir -p "$bin"
for script in heroic-steam-sync heroic-steam-launch; do
	ln -sf "$repo/bin/$script" "$bin/$script"
	echo "linked $bin/$script"
done

echo "== Steam launcher"
if [[ -f /usr/share/applications/steam.desktop ]]; then
	mkdir -p "$apps"
	sed -E "s#^Exec=(/usr/bin/(bazzite-)?steam)#Exec=env HEROIC_STEAM=\1 $bin/heroic-steam-sync --launch-steam#" \
		/usr/share/applications/steam.desktop >"$apps/steam.desktop"
	update-desktop-database "$apps" 2>/dev/null || true
	echo "wrote $apps/steam.desktop (Steam now syncs Heroic games on launch)"
else
	echo "no /usr/share/applications/steam.desktop; run heroic-steam-sync yourself before starting Steam"
fi

echo "== Game Mode"
# Bazzite starts Steam as client "steam" or "ogui-steam"; both end in "steam -gamepadui ...".
for client in steam ogui-steam; do
	session=$HOME/.config/gamescope-session-plus/sessions.d/$client
	if [[ ! -f /usr/share/gamescope-session-plus/sessions.d/$client ]]; then
		echo "no gamescope-session-plus client $client; skipping"
	elif [[ -f $session ]] && ! grep -q steam-heroic-library "$session"; then
		echo "kept your own $session; prefix Steam in its CLIENTCMD with heroic-steam-sync --launch-steam yourself"
	else
		mkdir -p "$(dirname "$session")"
		cat >"$session" <<EOF
# steam-heroic-library: sync Heroic games before Game Mode starts Steam.
[[ -x $bin/heroic-steam-sync ]] && CLIENTCMD="\${CLIENTCMD/steam -/$bin/heroic-steam-sync --launch-steam -}"
EOF
		echo "wrote $session (Game Mode syncs Heroic games on launch)"
	fi
done

echo "== categories"
mkdir -p "$config"
if [[ -f "$config/categories.json" ]]; then
	echo "kept existing $config/categories.json"
else
	cp "$repo/config/categories.example.json" "$config/categories.json"
	echo "created $config/categories.json from the example"
fi

echo "== Millennium plugin"
if ! command -v bun >/dev/null; then
	echo "bun not found; skipping the plugin (see README)"
elif [[ ! -d /usr/lib/millennium && ! -d $HOME/.local/lib/millennium && ! -d $HOME/.local/share/millennium ]]; then
	echo "Millennium not found; skipping the plugin (see README)"
else
	(cd "$repo/plugin" && bun install && bun run build)
	echo "built; enable 'Heroic Install' in Steam > Millennium > Plugins, then fully restart Steam"
fi

echo
echo "Done. Quit Steam fully and start it again to run the first sync."
