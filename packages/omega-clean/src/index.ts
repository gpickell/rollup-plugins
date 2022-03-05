import type { Plugin } from "rollup";

import fs from "fs/promises";
import path from "path";

import LockSet from "./LockSet";

function safeList(dir: string) {
    return fs.readdir(dir, { withFileTypes: true }).catch(() => []);
}

function safeUnlink(fn: string) {
    return fs.unlink(fn).catch(() => {});
}

interface Options {
    keep: string[];
    gens: number;
}

async function clean() {
    const ticket = {};
    await LockSet.enter(ticket);

    const dirs = new Set<string>();
    for (const locks of LockSet.all()) {
        for (const dir of locks.dirs) {
            dirs.add(dir);
        }
    }

    const files = new Set<string>();
    for (const dir of dirs) {
        for (const de of await safeList(dir)) {
            const fn = path.join(dir, de.name);
            if (de.isDirectory()) {
                dirs.add(path.normalize(`${fn}/`));;
            }

            if (de.isFile()) {
                files.add(fn);
            }
        }
    }

    for (const fn of files) {
        for (const locks of LockSet.all()) {
            if (locks.test(fn)) {
                files.delete(fn);
                break;
            }
        }
    }

    const array = [...files].map(safeUnlink);
    await Promise.all(array);

    LockSet.leave(ticket);
}

let cleaner: Promise<void> | undefined;

function omegaClean(options: Partial<Options> = {}): Plugin {
    let keep = options.keep;
    if (typeof keep === "string") {
        keep = [keep];
    }

    if (!Array.isArray(keep)) {
        keep = [];
    }

    keep = keep.filter(x => typeof x === "string");

    let maxgen = Number(options.gens);
    if (!isFinite(maxgen) || maxgen <= 0) {
        maxgen = 1;
    }

    const files = new LockSet(maxgen, keep);
    return {
        name: "omega-clean",

        async generateBundle() {
            await files.open();
        },

        writeBundle(opts, bundle) {
            const dir = path.resolve(opts.dir ?? ".");
            for (const fn in bundle) {
                files.add(dir, fn);
            }
        },

        async closeBundle() {
            const promise = cleaner || (cleaner = clean());
            files.publish();
            await promise;

            if (cleaner === promise) {
                cleaner = undefined;
            }
        }
    };
}

export default omegaClean;
