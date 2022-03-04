import { hints } from "./register";
import watch from "./watch";

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
            return Object.isFrozen(this);
        }

        abort() {
            if (!this.aborted) {
                Object.freeze(this);

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

export class Watch extends derive() {

}

export interface Watch extends Pick<AbortController, "abort"> {
    
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

        for (const [url, abort] of watches) {
            if (!hints.has(url)) {
                abort.abort();
                watches.delete(url);
            }
        }
    }

    tap(url: string, payload: string) {
        url;
        payload;
    }

    // @ts-expect-error
    watch(url: string) {
        return new Watch();
    }
}

export default Driver;
