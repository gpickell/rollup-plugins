import Driver, { Watch } from "../support/Driver";

const accept = "application/json; watch";
const rx = /^https?:/;

function nop() {}

function invalidFetch(): never {
    throw new Error("Cannot bind fetch( ... ).");
}

function bindFetch(): typeof fetch {
    if (typeof fetch === "function") {
        if (typeof window === "object" && window?.fetch === fetch) {
            return window.fetch.bind(window);
        }
    
        if (typeof self === "object" && self?.fetch === fetch) {
            return self.fetch.bind(self);
        }    
    }

    return invalidFetch;
}

class WebWatch extends Watch {
    readonly fetch = WebDriver.fetch;
    readonly url: string;
    
    constructor(_fetch: typeof fetch, _url: string) {
        super();

        this.fetch = _fetch;
        this.url = _url;
    }

    delay() {
        return new Promise<void>(resolve => {
            if (this.aborted) {

            }

            let timer: any;
            const remove = () => {
                timer !== undefined && clearTimeout(timer);
            };

            const tick = () => {
                timer = undefined;
                resolve();
            };

            this.add(remove);
            timer = setTimeout(tick, 3000);
        });
    }

    rel(rel: string) {
        const url = new URL(rel, this.url);
        return url.toString();
    }

    async observe() {
        const { signal } = this;
        const url = this.rel("./");
        while (true) {
            try {
                const res = await this.fetch(url, {
                    method: "POST",
                    headers: { accept },
                    signal,
                });

                if (res.status === 200 && res.headers.get("content-type") === accept) {
                    return res;
                }

                if (res.status === 405 || res.status === 200) {
                    this.abort();
                }
            } catch {
                // don't care
            }

            await this.delay();
        }
    }

    async ping() {
        const { signal } = this;
        while (true) {
            try {
                const res = await this.fetch(this.url, { signal });
                if (res.status === 200) {
                    return await res.text();
                }
            } catch {
                // don't care
            }

            await this.delay();
        }
    }

    async execute(cb: (content: string) => any) {
        while (true) {
            const res = await this.observe();
            await this.ping().then(cb);
            await res.arrayBuffer().then(nop, nop);
        }
    }
}

class WebDriver extends Driver {
    static fetch = bindFetch();

    watch(url: string) {
        const { fetch } = WebDriver;
        if (rx.test(url) && fetch !== invalidFetch) {
            const watch = new WebWatch(fetch, url);
            watch.execute(content => this.tap(url, content));
        }

        return super.watch(url);
    }
}

export default WebDriver;
