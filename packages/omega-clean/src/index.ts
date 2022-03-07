import type { Plugin } from "rollup";

import fs from "fs/promises";
import path from "path";

import { Minimatch, IMinimatch } from "minimatch";
import LockSet from "./LockSet";

const keeps = new Map<string, IMinimatch[]>();

function safeList(dir: string) {
    return fs.readdir(dir, { withFileTypes: true }).catch(() => []);
}

function safeUnlink(fn: string) {
    return fs.unlink(fn).catch(() => {});
}

function test(fn: string) {
    for (const locks of LockSet.all()) {
        if (locks.test(fn)) {
            return true;
        }
    }

    fn = fn.toLowerCase();

    for (const [dir, matchers] of keeps) {
        if (fn.startsWith(dir)) {
            let result: boolean | undefined;
            const rel = fn.substring(dir.length);
            for (const matcher of matchers) {
                if (result === undefined) {
                    result = matcher.negate;
                }

                if (matcher.match(rel) !== matcher.negate) {
                    result = !matcher.negate;
                }
            }

            if (result) {
                return true;
            }
        }
    }
    
    return false;
}

interface Options {
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
        if (test(fn)) {
            files.delete(fn);
        }
    }

    const array = [...files].map(safeUnlink);
    await Promise.all(array);

    LockSet.leave(ticket);
}

let cleaner: Promise<void> | undefined;

function omegaClean(options: Partial<Options> = {}): Plugin {
    const watching = process.env.ROLLUP_WATCH === "true";
    let maxgen = Number(options.gens);
    if (!isFinite(maxgen) || maxgen <= 0) {
        maxgen = watching ? 3 : 1;
    }

    const files = new LockSet(maxgen);
    return {
        name: "omega-clean",

        async buildStart() {
            await files.open();
        },

        writeBundle(opts, bundle) {
            const dir = path.resolve(opts.dir ?? ".");
            for (const fn in bundle) {
                files.add(dir, fn);
                files.add(dir, fn + ".map");
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

namespace omegaClean {
    export function keep(dir: string, globs: string[]) {
        dir = path.resolve(dir);
        dir = path.normalize(`${dir}/`)
        dir = dir.toLowerCase();

        const matcher = (glob: string) => {
            return new Minimatch(glob, { nocase: true });
        };

        keeps.set(dir, globs.map(matcher));
    }
}

export default omegaClean;
