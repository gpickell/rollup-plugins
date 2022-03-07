import type { BigIntStats, Stats } from "fs";
import type { Plugin } from "rollup";

import { urlToPath } from "./utils/url";

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

import Virtual from "./utils/Virtual";

export interface HotModuleReloadOptions {
    dev: boolean;
    dir: string;
    file: string;
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

const hmrCreate = new Virtual("hmr-create");
const hmrRegister = new Virtual("hmr-register");

function hmr(options: Partial<HotModuleReloadOptions> = {}): Plugin | false {
    const watching = process.env.ROLLUP_WATCH === "true";
    const dev = options.dev ?? watching;
    if (!dev) {
        return false;
    }

    let genId = 0;
    let hmrId = "";
    let hmrPrefix = "";
    let hmrResolve = Promise.resolve();
    const cjsPrefix = prefixOf(urlToPath(import.meta.url, "./"));
    const dir = prefixOf(options.dir ?? "src");
    const file = options.file ?? "hot/hmr.json";
    const module = options.module ?? "@tsereact/rollup-plugin-hmr/hmr";
    const mtimes = new Map<string, bigint>();
    const output = new Map<string, string>();
    return {
        name: "hmr",

        async buildStart() {
            genId = (new Date()).valueOf();
            hmrId = "";
            hmrPrefix = "";
            output.clear();

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
                        return hmrRegister.wrap(result.id);
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
                    const fn = hmrRegister.ref(id);
                    const ref = fn.substring(dir.length);
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

                    return result.join("");
                }
            }

            return undefined;
        },

        async transform(_, id) {
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

        generateBundle(opts, bundle) {
            const chunks = {} as Record<string, string[]>;
            for (const chunk of Object.values(bundle)) {
                if (chunk?.type === "chunk") {
                    const array = [] as string[];
                    for (const id in chunk.modules) {
                        if (id.startsWith(dir)) {
                            array.push(id.substring(dir.length));
                        }
                    }

                    if (array.length > 0) {
                        const ref = path.relative(path.dirname(file), chunk.fileName);
                        chunks[slashify(ref)] = array;
                    }
                }
            }

            const hasher = crypto.createHash("sha256");
            hasher.update(JSON.stringify(chunks));

            const hash = hasher.digest("hex");
            const source = {
                hash, version: genId, chunks
            };

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
}

export default hmr;
