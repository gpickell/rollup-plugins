export const observers = new Map<any, () => any>();

const immediate = Promise.resolve();
const pending = new WeakSet<() => any>();

namespace watch {
    export function add(key: any, fn: () => any) {
        const result = !observers.has(key) && observers.set(key, fn) && true;
        result && pulse();
        return result;
    }

    export function clear(key: any) {
        const result = observers.delete(key);
        result && pulse();
        return result;
    }

    export function has(key: any) {
        return observers.has(key);
    }

    export function pulse() {
        for (const [key, fn] of observers) {
            if (!pending.has(fn)) {
                pending.add(fn);

                immediate.then(() => {
                    if (pending.delete(fn) && observers.get(key) === fn) {
                        fn();
                    }
                });
            }
        }
    }
}

export default watch;
