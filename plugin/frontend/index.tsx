import { ChromeDevToolsProtocol, definePlugin, Field } from 'millennium';
import { pageScript } from './page';

// Plugin frontends run in an isolated world without Steam's globals, so the page
// work lives in pageScript (injected into Steam's main world over CDP). This side
// only relays: the game list from heroic-steam-sync in, Install clicks out.

const PAGE_SCRIPT = `(${pageScript.toString()})()`;
const CLICK_POLL_MS = 700;
const LIST_REFRESH_MS = 3000;
const CALL_TIMEOUT_MS = 15000;

let session: string | undefined;

async function send(expression: string, sessionId?: string): Promise<any> {
	const r: any = await ChromeDevToolsProtocol.send(
		'Runtime.evaluate',
		{ expression, returnByValue: true, awaitPromise: true },
		sessionId,
	);
	if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
	return r?.result?.value;
}

/** Evaluate in SharedJSContext's main world; attach a CDP session to it if needed. */
async function evaluate(expression: string): Promise<any> {
	try {
		return await send(expression, session);
	} catch (e) {
		if (session) throw e;
		const { targetInfos } = await ChromeDevToolsProtocol.send('Target.getTargets');
		const target = targetInfos.find((t) => t.title === 'SharedJSContext');
		if (!target) throw e;
		({ sessionId: session } = await ChromeDevToolsProtocol.send('Target.attachToTarget', {
			targetId: target.targetId,
			flatten: true,
		}));
		return await send(expression, session);
	}
}

/** Millennium parses JSON returned from Lua, so backend results may arrive as objects or strings. */
function asObject(value: unknown): any {
	return typeof value === 'string' ? JSON.parse(value) : value;
}

async function pushGames() {
	const list = asObject(await backend.heroic_list());
	await evaluate(`${PAGE_SCRIPT}; window.__heroicInstall.setGames(${JSON.stringify(list)})`);
}

async function drainClicks() {
	const clicks: { appid: string; action: 'install' | 'stop' | 'remove' }[] =
		(await evaluate('window.__heroicInstall?.takeClicks() ?? []')) ?? [];
	for (const { appid, action } of clicks) {
		const call = { install: backend.heroic_install, stop: backend.heroic_stop, remove: backend.heroic_remove }[action];
		const result = asObject(await call(Number(appid)));
		if (!result.ok) console.error(`heroic ${action} failed`, appid, result);
	}
}

/** A dead backend or CDP call never settles; time out so the loop logs and retries. */
function withTimeout<T>(promise: Promise<T>): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${CALL_TIMEOUT_MS} ms`)), CALL_TIMEOUT_MS)),
	]);
}

function every(ms: number, fn: () => Promise<void>) {
	let running = false;
	const run = async () => {
		if (running) return;
		running = true;
		try {
			await withTimeout(fn());
		} catch (e) {
			console.error('Heroic Install:', e);
		} finally {
			running = false;
		}
	};
	run();
	setInterval(run, ms);
}

const SettingsContent = () => (
	<Field
		label="Heroic Install"
		description="Epic and GOG games that are not installed get an Install via Heroic button and show greyed out in the library list. Games are synced by heroic-steam-sync."
	/>
);

export default definePlugin(() => {
	every(LIST_REFRESH_MS, pushGames);
	every(CLICK_POLL_MS, drainClicks);

	return {
		title: 'Heroic Install',
		icon: <div style={{ width: '16px', height: '16px' }}>H</div>,
		content: <SettingsContent />,
	};
});
