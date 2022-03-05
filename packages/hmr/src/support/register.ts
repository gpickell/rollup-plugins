import watch from "./watch";

export const hints = new Map<string, Set<string>>();

function register(hint: string, file: string, url: string) {
    if (Object.isFrozen(hints)) {
        return false;
    }

    const href = new URL(file, url);
    const key = href.toString();
    let set = hints.get(key);
    if (set === undefined) {
        hints.set(key, set = new Set());
    }

    set.add(hint);
    watch.pulse();

    return true;
}

export default register;
