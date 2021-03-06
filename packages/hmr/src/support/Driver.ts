import type Context from "./Context";
import contexts from "./contexts";

import { hints } from "./register";
import watch from "./watch";

const aborted = new WeakSet();
const drivers = new Map<typeof Driver, Driver>();

watch.add(drivers, () => {
    for (const driver of drivers.values()) {
        driver.react();
    }
});

interface AbortControllerClass {
    new (): {
        readonly aborted: boolean;
        readonly signal?: AbortSignal;

        abort(): void;
        add(cb: () => any): void;
        remove(cb: () => any): void;       
    };
}

function derive(): AbortControllerClass {
    if (typeof AbortController === "function") {
        return class extends AbortController {
            get aborted() {
                return this.signal.aborted;
            }

            add(cb: () => any) {
                this.signal.addEventListener("abort", cb);
            }

            remove(cb: () => any) {
                this.signal.removeEventListener("abort", cb);
            }
        };
    }

    function push(handlers: Set<() => any>, cb: () => any) {
        setTimeout(() => {
            if (handlers.has(cb)) {
                handlers.delete(cb);
                cb();
            }
        });
    }

    return class {
        handlers = new Set<() => any>();

        get aborted() {
            return aborted.has(this);
        }

        abort() {
            if (!this.aborted) {
                aborted.add(this);

                const { handlers } = this;
                for (const handler of handlers) {
                    push(handlers, handler);
                }
            }
        }

        add(cb: () => any) {
            this.handlers.add(cb);

            if (this.aborted) {
                push(this.handlers, cb);
            }
        }

        remove(cb: () => any) {
            this.handlers.add(cb);
        }
    }
}

interface Manifest {
    url?: string;
    hash: string;
    version: number;
    kernel: string[];
    chunks: Record<string, string[]>;
}

function test(current: Manifest | undefined, next: Manifest, url: string) {
    if (typeof next !== "object" || next === null) {
        return false;
    }

    if (typeof next.hash !== "string") {
        return false;
    }

    if (typeof next.version !== "number") {
        return false;
    }

    const { kernel, chunks } = next;
    if (!Array.isArray(kernel)) {
        return false;
    }

    if (kernel.some(x => typeof x !== "string")) {
        return false;
    }

    if (typeof chunks !== "object" || chunks === null) {
        return false;
    }

    for (const key in chunks) {
        const values = chunks[key];
        if (!Array.isArray(values)) {
            return false;
        }

        if (values.some(x => typeof x !== "string")) {
            return false;
        }
    }

    if (current?.url === url) {
        if (next.hash === current.hash) {
            return false;
        }

        if (next.version <= current.version) {
            return false;
        }
    }

    next.url = new URL(url).toString();
    next.kernel = [];
    next.chunks = {};

    for (const key of kernel) {
        const _key = (new URL(key, url)).toString();
        next.kernel.push(_key);
    }

    for (const key in chunks) {
        const _key = (new URL(key, url)).toString();
        next.chunks[_key] = chunks[key];
    }

    current = next;

    return true;
}

let current: Manifest | undefined;
let pending: [Manifest, Driver, string] | undefined;

function reload(next: Manifest) {
    const url = (new URL(import.meta.url)).toString();
    return next.kernel.indexOf(url) < 0;
}

async function update() {
    await Promise.resolve();

    while (pending && !Object.isFrozen(drivers)) {
        const [next, driver, url] = pending;
        const set = hints.get(url);
        const exists = new Set<string>();
        const spawn = new Set<string>();
        const { chunks } = next;
        for (const key in chunks) {
            const files = chunks[key];
            for (const file of files) {
                exists.add(file);

                if (set?.has(file)) {
                    spawn.add(key)
                }
            }
        }

        if (reload(next)) {
            for (const context of contexts.values()) {
                driver.gc(context);
            }

            Driver.freeze();

            current = undefined;
            pending = undefined;
        }

        const all = [...spawn].map(x => driver.load(x));
        await Promise.all(all);

        if (current === next) {           
            for (const context of contexts.values()) {
                if (!exists.has(context.id)) {
                    driver.gc(context);
                }
            }

            pending = undefined;
        }
    }
}

export class Watch extends derive() {
    
}

class Driver {
    static connect() {
        if (Object.isFrozen(drivers)) {
            return false;
        }

        if (!drivers.has(this)) {
            drivers.set(this, new this());
            watch.pulse();
        }

        return true;
    }

    static clear() {
        for (const driver of drivers.values()) {
            driver.close();
        }

        drivers.clear();
        hints.clear();
    }

    static freeze() {
        this.clear();
        Object.freeze(drivers);
        Object.freeze(hints);
    }

    readonly watches = new Map<string, Watch>();

    protected constructor() {
        let { react } = this;
        react = this.react = react.bind(this);
    }

    close() {
        const { watches } = this;
        for (const watch of watches.values()) {
            watch.abort();
        }

        watches.clear();
    }

    react() {
        const { watches } = this;
        for (const url of hints.keys()) {
            if (!watches.has(url)) {
                watches.set(url, this.watch(url));
            }
        }

        for (const [url, watch] of watches) {
            if (!hints.has(url)) {
                watch.abort();
                watches.delete(url);
            }
        }
    }

    load(url: string) {
        return import(url);
    }

    gc(context: Context) {
        if (contexts.get(context.id) === context && context.ready) {
            contexts.delete(context.id);

            Object.defineProperty(context, "ready", { value: false, writable: false });
            context.detach();
            Object.freeze(context);
        }
    }

    tap(url: string, payload: string) {
        try {
            const result = JSON.parse(payload) as Manifest;
            if (test(current, result, url)) {
                pending || update();
                pending = [current = result, this, url];
            }
        } catch {
            // parse failure
        }
    }

    // @ts-expect-error
    watch(url: string) {
        return new Watch();
    }
}

export default Driver;
