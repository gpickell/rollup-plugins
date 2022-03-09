import type { BigIntStats, Stats } from "fs";
import type { OutputPlugin, Plugin, PluginContext } from "rollup";

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

import Virtual from "./utils/Virtual";

export interface HotModuleReloadOptions {
    dev: boolean;
    dir: string;
    init: string | ((id: string) => string | undefined);
    module: string;
}

const statOptions = { bigint: true };

function mtime(stats: Stats | BigIntStats) {
    if ("mtimeNs" in stats) {
        return stats.mtimeNs;
    }

    const result = BigInt(stats.mtimeMs);
    return result * BigInt(1000);
}

function zero() {
    return BigInt(0);
}

function slashify(value: string) {
    value = path.normalize(value);
    return value.replace(/[\\/]+/g, "/");
}

function stat(fn: string) {
    return fs.stat(fn, statOptions).then(mtime, zero);
}

function prefixOf(dir: string) {
    dir = path.resolve(dir);
    dir = path.normalize(`${dir}/`);

    return dir;
}

const files = new WeakMap<OutputPlugin | PluginContext, string>();

function fileOf(context: PluginContext) {
    return files.get(context) ?? "hot/hmr.json";
}

const hmrConnect = new Virtual("hmr-connect");;
const hmrCreate = new Virtual("hmr-create");
const hmrRegister = new Virtual("hmr-register");

function hmr(options: Partial<HotModuleReloadOptions> = {}): Plugin {
    let genId = 0;
    let hmrId = "";
    let hmrResolve = Promise.resolve();
    const hmr = new Set<string>();
    const watching = process.env.ROLLUP_WATCH === "true";
    const dev = options.dev ?? watching;
    const dir = prefixOf(options.dir ?? "src");
    const init = options.init;
    const module = options.module ?? "@tsereact/rollup-plugin-hmr/hmr";
    const mtimes = new Map<string, bigint>();
    const output = new Map<string, string>();
    const plugin: Plugin = {
        name: "hmr",

        async buildStart() {
            genId = (new Date()).valueOf();
            hmrId = "";
            mtimes.clear();
            output.clear();

            const resolve = async () => {
                const hmr = await this.resolve(module, undefined, { isEntry: false });
                if (hmr && !hmr.external) {
                    hmrId = hmr.id;
                }
            };

            await (hmrResolve = resolve());
        },

        async resolveId(id, importer, opts) {
            if (opts.isEntry) {
                await hmrResolve;
            }

            if (hmrConnect.match(id)) {
                return id;
            }

            if (hmrCreate.match(id)) {
                return id;
            }

            if (hmrRegister.match(id)) {
                return id;
            }

            if (hmrId) {
                const result = await this.resolve(id, importer, { ...opts, skipSelf: true });
                if (!result || result.external) {
                    return result;
                }

                if (result.id === hmrId && importer?.startsWith(dir)) {
                    const ref = importer.substring(dir.length);
                    return hmrCreate.wrap(ref);
                }

                if (dev && opts.isEntry && result.id.startsWith(dir)) {
                    const ref = result.id.substring(dir.length);
                    return hmrRegister.wrap(ref);
                }

                return result;
            }

            return undefined;
        },
        
        async load(id) {
            if (hmrCreate.match(id)) {
                return "export default undefined;"
            }

            return undefined;
        },
    };

    const hot: Plugin = {
        name: "hmr",

        async load(id) {
            if (hmrConnect.match(id)) {
                const ref = hmrConnect.ref(id);
                const result = [
                    `import { connect } from ${JSON.stringify(ref)};\n`,
                    `connect();\n`,
                ];

                return result.join("");
            }

            if (hmrCreate.match(id)) {
                const ref = hmrCreate.ref(id);
                const result = [
                    `export * from ${JSON.stringify(hmrId)};\n`,
                    `import { create, Context } from ${JSON.stringify(hmrId)};\n`,
                    `const context = create(${JSON.stringify(ref)}, Context, import.meta.hmrVersion, import.meta.url);\n`,
                    `export default context;\n`,
                ];

                return result.join("");
            }

            if (hmrRegister.match(id)) {
                const ref = hmrRegister.ref(id);
                const fn = path.join(dir, ref);
                const result = [
                    `import { register } from ${JSON.stringify(hmrId)};\n`,
                    `register(${JSON.stringify(ref)}, import.meta.hmrFile, import.meta.url);\n`,
                    `export * from ${JSON.stringify(fn)};\n`,
                ];

                const module = await this.load({ id: fn });
                if (module.hasDefaultExport) {
                    const extra = [
                        `import __default from ${JSON.stringify(fn)};\n`,
                        `export default __default;\n`,    
                    ];

                    result.push(...extra);
                }

                let start = init;
                if (typeof start === "function") {
                    start = start(fn);
                }

                if (start) {
                    const id = hmrConnect.wrap(start);
                    result.unshift(`import ${JSON.stringify(id)};\n`);
                }

                return result.join("");
            }

            return undefined;
        },

        async buildEnd() {
            const map = new Map<string, Promise<bigint>>();
            for (const id of this.getModuleIds()) {
                if (id.startsWith(dir)) {
                    map.set(id, stat(id));
                }
            }

            for (const [id, promise] of map) {
                mtimes.set(id, await promise);
            }

            hmr.clear();
            
            for (const id of this.getModuleIds()) {
                const info = this.getModuleInfo(id);
                if (info && (hmrConnect.match(id) || hmrCreate.match(id))) {
                    for (const id of info.importedIds) {
                        hmr.add(id);
                    }

                    for (const id of info.dynamicallyImportedIds) {
                        hmr.add(id);
                    }
                }
            }

            for (const id of hmr) {
                const info = this.getModuleInfo(id);
                if (info) {
                    for (const id of info.importedIds) {
                        hmr.add(id);
                    }

                    for (const id of info.dynamicallyImportedIds) {
                        hmr.add(id);
                    }
                }
            }
        },

        renderStart(opts) {
            for(const plugin of opts.plugins) {
                const file = files.get(plugin);
                file && files.set(this, file);
            }
        },

        outputOptions(opts) {
            const { manualChunks } = opts;
            opts.manualChunks = function (id, api) {
                if (hmr.has(id)) {
                    return "hmr";
                }

                if (typeof manualChunks === "function") {
                    return manualChunks.call(this, id, api);    
                }

                if (manualChunks) {
                    for (const key in manualChunks) {
                        const array = manualChunks[key];
                        for (const hint of array) {
                            if (id.indexOf(hint) >= 0) {
                                return key;
                            }
                        }
                    }
                }

                return undefined;
            };

            return opts;
        },

        augmentChunkHash(chunk) {
            const json = {} as any;
            const keys = Object.keys(chunk.modules).sort();
            for (const key of keys) {
                json[key] = mtimes.get(key)?.toString();
            }

            return JSON.stringify(json);
        },

        resolveImportMeta(prop, { chunkId }) {
            if (prop === "hmrFile") {
                const file = fileOf(this);
                const dir = path.dirname(chunkId);
                const rel = slashify(path.relative(dir, file));
                return JSON.stringify(rel);
            }

            if (prop === "hmrVersion") {
                return JSON.stringify(genId);
            }

            return undefined;
        },

        generateBundle(opts, bundle) {
            const refs = new Set<string>();
            const file = fileOf(this);
            const chunks = {} as Record<string, string[]>;
            for (const key of Object.keys(bundle).sort()) {
                const chunk = bundle[key];
                if (chunk.type === "chunk") {
                    let ref = path.relative(path.dirname(file), chunk.fileName);
                    ref = slashify(ref);

                    const array = [] as string[];
                    for (const id in chunk.modules) {
                        if (id.startsWith(dir)) {
                            array.push(id.substring(dir.length));
                            chunks[ref] = array;
                        }

                        if (hmr.has(id)) {
                            refs.add(ref);
                        }
                    }

                    array.sort();
                }
            }

            const kernel = [...refs].sort();
            const hasher = crypto.createHash("sha256");
            hasher.update(JSON.stringify(kernel));
            hasher.update(JSON.stringify(chunks));

            const hash = hasher.digest("hex");
            const source = { hash, version: genId, kernel, chunks };
            const fn = path.resolve(opts.dir ?? ".", file);
            const str = JSON.stringify(source, undefined, 4);
            output.set(fn, str);

            this.emitFile({
                type: "asset",
                fileName: file,
                source: "{}",
            });
        },

        async closeBundle() {
            for (const [fn, source] of output) {
                await fs.writeFile(fn, source);
            }
        }
    };

    if (dev) {
        return { ...plugin, ...hot };
    }

    return plugin;
}

namespace hmr {
    export function file(fn: string) {
        const plugin: OutputPlugin = { name: "hmr-file" };
        files.set(plugin, fn);
        return plugin;
    }

    export const nodeDriver = "@tsereact/rollup-plugin-hmr/client/NodeDriver";
    export const webDriver = "@tsereact/rollup-plugin-hmr/client/WebDriver";
}

export default hmr;
