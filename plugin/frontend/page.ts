// @ts-nocheck
// Runs in Steam's main SharedJSContext world, not the plugin's isolated world, so
// Steam's globals and webpack modules are reachable. index.tsx serializes it with
// toString(), so it must stay self-contained. Installed once as window.__heroicInstall:
// the plugin pushes the game list in with setGames() and drains Install clicks with
// takeClicks().
export function pageScript() {
	return (() => {
		if (window.__heroicInstall) return 'already installed';

		const BUTTON_CLASS = 'heroic-install-button';
		let games = {}; // appid -> { title, store, installed }
		let clicks = [];

		// Steam's CSS class maps, looked up by key name so hashed class names can change.
		let classes = null;
		function steamClasses() {
			if (classes) return classes;
			let req;
			window.webpackChunksteamui.push([[Symbol()], {}, (r) => { req = r; }]);
			const found = {};
			for (const id of Object.keys(req.m)) {
				let m;
				try { m = req(id); } catch { continue; }
				if (!m || typeof m !== 'object') continue;
				if (m.PlayButtonContainer && m.PlayButton) found.play = m;
				if (m.Container && m.Installed && m.Uninstalled) found.row = m;
			}
			if (found.play && found.row) classes = found;
			return found;
		}

		function mainDoc() {
			const popup = [...(window.g_PopupManager?.m_mapPopups?.values() ?? [])]
				.find((p) => p.m_strName === 'SP Desktop_uid0');
			return popup?.m_popup?.document;
		}

		function openAppId() {
			const path = window.MainWindowBrowserManager?.m_lastLocation?.pathname ?? '';
			const m = /\/library\/app\/(\d+)/.exec(path);
			return m ? m[1] : null;
		}

		const BLUE = '#1a9fff', DARK_BLUE = '#1466d6', TRACK = '#2a3f5a';

		function makeButton(doc, appid, play) {
			const button = doc.createElement('div');
			button.className = BUTTON_CLASS;
			button.dataset.appid = appid;
			// Same footprint as the Play button it replaces.
			Object.assign(button.style, {
				display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
				boxSizing: 'border-box', minWidth: `${play.dataset.heroicWidth}px`, height: `${play.dataset.heroicHeight}px`,
				padding: '0 16px', borderRadius: '3px', whiteSpace: 'nowrap', color: '#fff',
				fontWeight: '700', letterSpacing: '0.04em', userSelect: 'none',
			});
			button.style.position = 'relative';
			const label = doc.createElement('div');
			const detail = doc.createElement('div');
			Object.assign(detail.style, { fontSize: '11px', fontWeight: '400', opacity: '0.85', letterSpacing: '0' });
			// Controls on the right edge: ⏸ pauses a download, ✕ removes the install
			// (asks for a second click first, since it deletes the downloaded files).
			const controls = doc.createElement('div');
			Object.assign(controls.style, { position: 'absolute', top: '0', right: '0', bottom: '0', display: 'flex' });
			const control = (text, title, onClick) => {
				const el = doc.createElement('div');
				el.textContent = text;
				el.title = title;
				Object.assign(el.style, {
					width: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center',
					background: 'rgba(0, 0, 0, 0.25)', borderLeft: '1px solid rgba(0, 0, 0, 0.3)',
					cursor: 'pointer', fontWeight: '400',
				});
				el.addEventListener('click', (event) => {
					event.stopPropagation();
					onClick();
					renderButton(button, games[appid]);
				});
				controls.append(el);
				return el;
			};
			control('⏸', 'Pause install (resume later)', () => {
				clicks.push({ appid, action: 'stop' });
				button.dataset.pending = String(Date.now());
			});
			control('✕', 'Remove install (deletes downloaded files)', () => {
				if (Date.now() - Number(button.dataset.confirm || 0) < 4000) {
					delete button.dataset.confirm;
					clicks.push({ appid, action: 'remove' });
					button.dataset.pending = String(Date.now());
					button.dataset.removing = '1';
				} else {
					button.dataset.confirm = String(Date.now());
					setTimeout(() => renderButton(button, games[appid]), 4100);
				}
			});
			button.append(label, detail, controls);
			button.addEventListener('click', () => {
				const state = games[appid]?.install?.state;
				const confirming = Date.now() - Number(button.dataset.confirm || 0) < 4000;
				if (state === 'downloading' || button.dataset.pending || button.dataset.removing || confirming) return;
				clicks.push({ appid, action: 'install' });
				button.dataset.pending = String(Date.now());
				renderButton(button, games[appid]);
			});
			renderButton(button, games[appid]);
			return button;
		}

		// INSTALL, STARTING…/STOPPING… (clicked, waiting for the backend), INSTALLING n% with
		// the button filling up as a progress bar and a stop control, RESUME after a stop,
		// or RETRY after a failed install.
		function renderButton(button, game) {
			const [label, detail, controls] = button.children;
			const [pause, remove] = controls.children;
			const install = game.install;
			const state = install?.state;
			// A click is pending until the state it asked for shows up (or 15 s pass).
			const asked = button.dataset.pendingFor;
			if (button.dataset.pending && (state === asked || Date.now() - Number(button.dataset.pending) > 15000)) {
				delete button.dataset.pending;
			}
			const pending = !!button.dataset.pending;
			if (button.dataset.removing && !state) {
				delete button.dataset.removing;
				delete button.dataset.pending;
			}
			const confirming = Date.now() - Number(button.dataset.confirm || 0) < 4000;
			let text, sub, fill, clickable;
			if (button.dataset.removing) {
				text = 'REMOVING…'; sub = `Deleting files · ${game.store}`; fill = null; clickable = false;
			} else if (confirming) {
				text = 'DELETE?'; sub = 'Click ✕ again to remove'; fill = null; clickable = false;
			} else if ((pending && state === 'downloading') || state === 'stopping') {
				text = 'STOPPING…'; sub = `${install.percent}% · ${game.store}`; fill = install.percent; clickable = false;
			} else if (state === 'downloading') {
				text = 'INSTALLING'; sub = `${install.percent}% · ${game.store}`; fill = install.percent; clickable = false;
			} else if (pending) {
				text = 'STARTING…'; sub = `via Heroic · ${game.store}`; fill = 0; clickable = false;
			} else if (state === 'stopped') {
				text = 'RESUME'; sub = `Stopped at ${install.percent}% · ${game.store}`; fill = null; clickable = true;
			} else if (state === 'failed') {
				text = 'RETRY INSTALL'; sub = 'Last install failed'; fill = null; clickable = true;
			} else {
				text = 'INSTALL'; sub = `via Heroic · ${game.store}`; fill = null; clickable = true;
			}
			if (label.textContent !== text) label.textContent = text;
			if (detail.textContent !== sub) detail.textContent = sub;
			button.style.cursor = clickable ? 'pointer' : 'default';
			button.dataset.pendingFor = state === 'downloading' || state === 'stopping' ? 'stopped' : 'downloading';
			const busy = pending || button.dataset.removing;
			pause.style.display = state === 'downloading' && !busy ? 'flex' : 'none';
			remove.style.display = (state === 'downloading' || state === 'stopped') && !busy ? 'flex' : 'none';
			const shown = [pause, remove].filter((el) => el.style.display === 'flex').length;
			button.style.paddingRight = `${16 + shown * 26}px`;
			if (button.dataset.removing) button.dataset.pendingFor = '';
			button.style.background = fill === null
				? `linear-gradient(90deg, ${BLUE} 0%, ${DARK_BLUE} 100%)`
				: `linear-gradient(90deg, ${BLUE} ${fill}%, ${TRACK} ${fill}%)`;
			button.title = install?.state === 'failed'
				? `Install of ${game.title} failed. Log: ${install.log}`
				: game.store === 'Epic'
					? `${game.title} is not installed. Downloads it directly with Heroic's legendary.`
					: `${game.title} is not installed. Opens Heroic's install dialog.`;
		}

		// The page has two Play buttons: under the banner, and in the sticky header that
		// appears on scroll. For a Heroic game that is not installed, each is swapped for an
		// Install button in the same spot, like Steam does for its own uninstalled games.
		function placeButton(doc, cls) {
			const appid = openAppId();
			const game = appid && games[appid];
			const all = [...doc.querySelectorAll(`.${cls.play.PlayButtonContainer.split(' ')[0]}`)];
			const plays = game && !game.installed ? all : [];
			for (const play of plays) {
				// Measure while Play is still visible; a hidden element measures 0.
				if (play.style.display !== 'none') {
					play.dataset.heroicWidth = String(play.offsetWidth || 200);
					play.dataset.heroicHeight = String(play.offsetHeight || 44);
				}
				const next = play.nextElementSibling;
				if (next?.classList.contains(BUTTON_CLASS) && next.dataset.appid === appid) {
					renderButton(next, game);
				} else {
					play.parentElement?.insertBefore(makeButton(doc, appid, play), play.nextSibling);
				}
				play.style.display = 'none';
			}
			for (const play of all) {
				if (!plays.includes(play) && play.style.display === 'none') play.style.display = '';
			}
			for (const button of doc.querySelectorAll(`.${BUTTON_CLASS}`)) {
				const placed = plays.includes(button.previousElementSibling) && button.dataset.appid === appid;
				if (!placed) button.remove();
			}
		}

		// Sidebar: show not-installed Heroic games greyed like Steam's own uninstalled games.
		function greyRows(doc, cls) {
			const missing = new Set(Object.values(games).filter((g) => !g.installed).map((g) => g.title));
			const installed = cls.row.Installed.split(' ')[0];
			const uninstalled = cls.row.Uninstalled.split(' ')[0];
			for (const row of doc.querySelectorAll(`.${cls.row.Container.split(' ')[0]}.${installed}`)) {
				if (missing.has(row.textContent.trim())) row.classList.replace(installed, uninstalled);
			}
		}

		function tick() {
			const doc = mainDoc();
			const cls = steamClasses();
			if (!doc || !cls.play || !cls.row) return;
			placeButton(doc, cls);
			greyRows(doc, cls);
		}

		setInterval(tick, 500);
		window.__heroicInstall = {
			setGames(next) { games = next; tick(); },
			takeClicks() { const out = clicks; clicks = []; return out; },
			debug() { return { games: Object.keys(games).length, appid: openAppId(), haveDoc: !!mainDoc(), classes: !!classes, buttons: mainDoc()?.querySelectorAll(`.${BUTTON_CLASS}`).length ?? 0 }; },
		};
		return 'installed';
	})();
}
