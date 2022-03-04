import { urlToPath } from "../utils/url";
import Driver, { Watch } from "../support/Driver";

import { mkdir, readFile } from "fs/promises";
import { watch } from "fs";

function nop() {}

class NodeWatch  extends Watch {
    promise?: Promise<void>;
    resolve?: () => void;

    pulse() {
        this.resolve?.();
        this.promise = undefined;
        this.resolve = undefined;
    }

    wait() {
        if (this.promise === undefined) {
            this.promise = new Promise<void>(x => this.resolve = x);
        }

        return this.promise;
    }

    async start(dir: string) {
        try {
            await mkdir(dir, { recursive: true });
        } catch (ex) {
            console.log("[HMR]: fs.mkdir dir =", dir);
        }

        const watcher = watch(dir, { persistent: false });
        watcher.on("change", () => this.pulse());
        watcher.on("error", () => console.log("[HMR]: fs.watch dir =", dir));

        this.add(() => watcher.close());
    }

    async execute(fn: string, cb: (content: string) => any) {
        while (true) {
            const promise = this.wait();
            await readFile(fn, "utf-8").then(cb, nop);
            await promise;
        }
    }
}

function isNode(url: string) {
    if (!url.startsWith("file:")) {
        return false;
    }

    if (typeof process !== "object" || !process) {
        return false;
    }

    const { versions } = process;
    if (typeof versions !== "object" || !versions) {
        return false;
    }

    return !!versions.node;
}

class NodeDriver extends Driver {
    watch(url: string) {
        if (isNode(url)) {
            const dir = urlToPath(url, "./");
            const fn = urlToPath(url);
            const watch = new NodeWatch();
            watch.start(dir);
            watch.execute(fn, content => this.tap(url, content));

            return watch;
        }

        return super.watch(url);
    }
}

export default NodeDriver;
