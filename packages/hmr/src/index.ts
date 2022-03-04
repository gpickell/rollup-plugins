import type { BigIntStats, Stats } from "fs";
import type { Plugin } from "rollup";

import { urlToPath } from "./utils/url";

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

import Virtual from "./utils/Virtual";

export interface HotModuleReloadOptions {
    dir?: string;
    file?: string;
    module?: string;
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

const hmrCreate = new Virtual("hmr-create");
const hmrRegister = new Virtual("hmr-register");

function hmr(options: HotModuleReloadOptions): Plugin {
    options = options ?? {};

    let genId = 0;
    let hmrId = "";
    let hmrPrefix = "";
    let hmrResolve = Promise.resolve();
    const cjsPrefix = prefixOf(urlToPath(import.meta.url, "./"));
    const dir = prefixOf(options.dir ?? "src");
    const file = options.file ?? "hmr/manifest.json";
    const module = options.module ?? "@tsereact/rollup-plugin-hmr/hmr";
    const entry = new Map<string, string>();
    const mtimes = new Map<string, bigint>();
    return {
        name: "hmr",

        async buildStart() {
            entry.clear();
            genId = (new Date()).valueOf();
            hmrId = "";
            hmrPrefix = "";

            const resolve = async () => {
                const hmr =await this.resolve(module, undefined, { isEntry: false });
                if (hmr && !hmr.external) {
                    hmrId = hmr.id;
                    hmrPrefix = prefixOf(hmrId);
                }
            };

            await (hmrResolve = resolve());
        },

        async resolveId(id, importer, opts) {
            if (opts.isEntry) {
                await hmrResolve;
            }

            if (hmrCreate.match(id)) {
                return id;
            }

            if (hmrRegister.match(id)) {
                return id;
            }

            if (hmrId) {
                if (importer?.startsWith(cjsPrefix)) {
                    return undefined;
                }

                if (importer?.startsWith(hmrPrefix)) {
                    return undefined;
                }

                const result = await this.resolve(id, importer, { ...opts, skipSelf: true });
                if (result && !result.external) {
                    if (result.id === hmrId && importer?.startsWith(dir)) {
                        const ref = importer.substring(dir.length);
                        return hmrCreate.wrap(ref);
                    }

                    if (result.id.startsWith(cjsPrefix)) {
                        return result;
                    }

                    if (result.id.startsWith(hmrPrefix)) {
                        return result;
                    }

                    if (opts.isEntry && result.id.startsWith(dir)) {
                        const ref = result.id.substring(dir.length);
                        entry.set(result.id, ref);
                    }
                }

                return result;
            }

            return undefined;
        },

        async load(id) {
            if (hmrId && id[0] === "\0") {
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
                    const result = [
                        `import { register } from ${JSON.stringify(hmrId)};\n`,
                        `register(${JSON.stringify(ref)}, import.meta.hmrFile, import.meta.url);\n`
                    ];

                    return result.join("");
                }
            }

            return undefined;
        },

        async transform(code, id) {
            if (id.startsWith(dir)) {
                let detect = true;
                if (id.startsWith(cjsPrefix)) {
                    detect = false;
                }

                if (id.startsWith(hmrPrefix)) {
                    detect = false;   
                }

                if (detect) {
                    mtimes.set(id, await stat(id));
                }
            }

            const entryRef = entry.get(id);
            if (entryRef !== undefined) {
                const { mappings, ...map } = this.getCombinedSourcemap();
                const ref = hmrRegister.wrap(entryRef);
                const result = [
                    `import ${JSON.stringify(ref)};\n`,
                    code,
                ];

                return {
                    code: result.join(""),
                    map: { ...map, mappings: `;${mappings}` },
                }
            }

            return undefined;
        },

        outputOptions(opts) {
            const hmr = new Set<string>();
            for (const id of this.getModuleIds()) {
                if (id.startsWith(cjsPrefix)) {
                    hmr.add(id);
                }

                if (hmrPrefix && id.startsWith(hmrPrefix)) {
                    hmr.add(id);
                }
            }

            if (opts.manualChunks) {
                if (typeof opts.manualChunks === "object") {
                    opts.manualChunks = {
                        ...opts.manualChunks,
                        hmr: [...hmr],
                    };
                } else {
                    const fn = opts.manualChunks;
                    opts.manualChunks = function (id, api) {
                        if (hmr.has(id)) {
                            return "hmr";
                        }

                        return fn.call(this, id, api);
                    };
                }
            } else {
                opts.manualChunks = { hmr: [...hmr] };
            }

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
                const dir = path.dirname(chunkId);
                const rel = slashify(path.relative(dir, file));
                return JSON.stringify(rel);
            }

            if (prop === "hmrVersion") {
                return JSON.stringify(genId);
            }

            return undefined;
        },

        generateBundle(_, bundle) {
            const chunks = {} as Record<string, string[]>;
            for (const chunk of Object.values(bundle)) {
                if (chunk.type === "chunk") {
                    const array = [] as string[];
                    for (const id in chunk.modules) {
                        if (id.startsWith(dir)) {
                            array.push(id.substring(dir.length));
                        }
                    }

                    if (array.length > 0) {
                        const ref = path.relative(path.dirname(file), chunk.fileName);
                        chunks[ref] = array;
                    }
                }
            }

            const hasher = crypto.createHash("sha256");
            hasher.update(JSON.stringify(chunks));

            const hash = hasher.digest("hex");
            this.emitFile({
                type: "asset",
                fileName: file,
                source: JSON.stringify({ hash, version: genId, chunks }, undefined, 4),
            });
        },
    }; 
}

export default hmr;
