import type { Plugin } from "rollup";

import FileServer from "./FileServer";

import http, { Server } from "http";
import path, { relative } from "path";

interface Configure {
    (mw: FileServer, server: Server): Promise<void> | void;
}

interface Options {
    dev: boolean;
    preload: boolean;
    path: string;
    spec: string;

    root?: string;
    configure?: Configure;
}

interface Config extends Options {
    roots: Set<string>;
}

const configs = new Map<string, Promise<Config>[]>();
const servers = new Map<string, Promise<void>>();

async function start(spec: string, array: Promise<Config>[]) {
    const fs = new FileServer();
    const configs = await Promise.all(array);
    for (const { dev, path, roots } of configs) {
        for (const root of roots) {
            const hint = relative(fs.cwd, root);
            console.log("[WebServer]: [spec = %s]: Serve: dev = %s, %s =>", spec, dev, path, hint);

            if (dev) {
                fs.serveWatch(path, root, "hot");
            }
        }
    }

    const preloads = [] as Promise<void>[]; 
    for (const { preload, roots } of configs) {
        if (preload) {
            for (const root of roots) {
                const hint = relative(fs.cwd, root);
                console.log("[WebServer]: [spec = %s]: Preloading %s ...", spec, hint);
                preloads.push(fs.preload(root));
            }
        }
    }

    if (preloads.length) {
        await Promise.all(preloads);
        console.log("[WebServer]: [spec = %s]: Preloading done.", spec);
    }

    for (const { path, roots } of configs) {
        for (const root of roots) {
            fs.serveFiles(path, root);
        }
    }

    const server = http.createServer();
    for (const { configure } of configs) {
        await configure?.(fs, server);
    }

    let [port, host] = spec.split("/") as any[];
    port = Number(port);
    host = !host ? "localhost" : host;

    if (port > 0 && port < 0xffff) {
        server.listen(port, host !== "*" ? host : undefined);

        if (host === "*") {
            host = "localhost";
        }
    } else {
        server.listen(spec);
    }

    if (server.listenerCount("request") < 1) {
        server.on("request", fs.process);
    }

    server.on("error", err => {
        console.log("[WebServer]: [spec = %s]: Could not listen:", spec, err);
    });

    server.on("listening", () => {
        const addr = server.address();
        if (addr) {
            if (typeof addr === "string") {
                console.log("[WebServer]: Listening on pipe:", addr);
            } else {
                const url = `http://${host}:${port}/`;
                console.log("[WebServer]: Listening on port:", url);
            }
        }
    });
}

function register(config: Config) {
    let resolve!: (config: Config) => void;
    const { spec } = config;
    const promise = new Promise<Config>(x => resolve = x);
    const array = configs.get(spec) ?? [];
    configs.set(spec, array);

    if (!Object.isFrozen(array)) {
        array.push(promise);
    }
    
    return async () => {
        resolve(config);

        const promise = servers.get(spec) || start(spec, array);
        servers.set(spec, promise);
        await promise;
    };
}

function webServer(options: Partial<Options> = {}): Plugin {
    const roots = new Set<string>();
    const config: Config = {
        dev: !!(options?.dev),
        preload: !!(options?.preload),
        path: options?.path || "/",
        spec: options?.spec || "7180/localhost", 
        roots,
        root: options?.root,
        configure: options.configure,
    };

    const { root } = config;
    if (typeof root === "string") {
        roots.add(path.resolve(root));
    }

    const resolve = register(config);
    return {
        name: "web",

        writeBundle(opts) {
            if (typeof root !== "string") {
                roots.add(path.resolve(opts.dir ?? "."));
            }
        },

        async closeBundle() {
            return await resolve();
        }
    };
}

export default webServer;
