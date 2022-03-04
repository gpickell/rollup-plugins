import type { BigIntStats } from "fs";

import fs from "fs/promises";
import path from "path";
import DataSet from "./DataSet";

function ls(dir: string) {
    return fs.readdir(dir, { withFileTypes: true }).catch(() => []);
}

function slashify(fn: string) {
    return fn.replace(/[\\/]+/g, "/");
}

const cache = new WeakMap<BigIntStats, Buffer>();
const stats = new Map<string, BigIntStats>();

class AssetSnapshot extends Map<string, [BigIntStats, Buffer]> {
    static async load(dir: string) {
        dir = path.resolve(dir);

        const prefix = path.normalize(dir + "/");
        const queue = new Set<string>();
        const result = new this();
        for (const dir of queue) {
            for (const entry of await ls(dir)) {
                const fn = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    queue.add(fn);
                }

                if (entry.isFile()) {
                    const stat = await fs.stat(fn, { bigint: true }).catch(() => undefined);
                    if (stat) {
                        const current = stats.get(fn);
                        const content = current && cache.get(current);
                        const rel = slashify(fn.substring(prefix.length));
                        if (content && stat.mtimeNs === current?.mtimeNs) {
                            result.set(rel, [current, content]);
                        } else {
                            const content = await fs.readFile(fn).catch(() => undefined);
                            content && result.set(rel, [stat, content]);
                        }    
                    }
                }
            }
        }

        return result;
    }

    data(files: Set<string>) {
        const result = new DataSet();
        result.add("title", "_");

        if (files.has("favicon.ico")) {
            result.addElement("meta", {
                href: "favicon.ico",
                rel: "apple-icon",
            });

            result.addElement("meta", {
                href: "favicon.ico",
                rel: "apple-touch-icon",
            });
        }

        return result;
    }

    contents() {
        const result = new Map<string, string | Uint8Array>();
        for (const [key, [, data]] of this) {
            if (typeof data === "string") {
                result.set(key, data);
            } else {
                result.set(key, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            }
        }

        return result;
    }

    split(fn: (key: string) => boolean) {
        const result = new AssetSnapshot();
        for (const [key, content] of this) {
            if (fn(key)) {
                result.set(key, content);
                this.delete(key);
            }
        }

        return result;
    }
}

export default AssetSnapshot;
