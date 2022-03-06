import path from "path";

class Trigger {
    promise?: Promise<void>;
    resolve?: () => void;

    clear() {
        this.resolve = undefined;
        this.promise = undefined;
    }

    set() {
        if (this.promise !== undefined) {
            this.resolve?.();
            this.resolve = undefined;
        } else {
            this.promise = Promise.resolve();
        }
    }

    wait() {
        if (this.promise === undefined) {
            this.promise = new Promise<void>(x => this.resolve = x);
        }

        return this.promise;
    }

    state() {
        if (this.promise) {
            if (this.resolve) {
                return undefined;
            }

            return true;
        }

        return false;
    }
}

const all = new Set<LockSet>();
const pending = new Set<LockSet>();
const tickets = new Set<any>();

const enter = new Trigger();
const open = new Trigger();

export class LockSet extends Map<string, number> {
    readonly dirs = new Set<string>();
    readonly gens: number;

    constructor(gens: number) {
        super();
        this.gens = gens;
        all.add(this);
    }

    add(dir: string, fn: string) {
        dir = path.resolve(dir);
        dir = path.normalize(`${dir}/`);
        fn = path.resolve(dir, fn);

        this.set(fn, 0);
        this.dirs.add(dir);
    }

    test(fn: string) {
        const gen = this.get(fn);
        if (gen !== undefined) {
            return true;
        }

        return false;
    }

    async open() {
        pending.add(this);

        if (enter.state() === false) {
            open.set();
        }

        await open.wait();

        for (const [fn, gen] of this) {
            this.set(fn, gen + 1);
        }
    }

    publish() {
        if (pending.delete(this)) {
            for (const [fn, gen] of this) {
                if (gen >= this.gens) {
                    this.delete(fn);
                }
            }
    
            if (pending.size < 1) {
                open.clear();

                if (enter.state() !== false) {
                    enter.set();
                }
            }
        }
    }

    static all() {
        return all[Symbol.iterator]();
    }

    static async enter(ticket: any) {
        tickets.add(ticket);

        if (open.state() === false) {
            enter.set();
        }

        await enter.wait();
    }

    static leave(ticket: any) {
        if (tickets.delete(ticket) && tickets.size < 1) {
            enter.clear();

            if (open.state() !== false) {
                open.set();
            }
        }
    }
}

export default LockSet;
