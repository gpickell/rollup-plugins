import type Context from "./Context";
import contexts from "./contexts";

function create(id: string, cls: typeof Context, ver: number, url: string) {
    let context = contexts.get(id);
    if (context !== undefined) {
        if (context.version > ver) {
            return new cls(id, ver, url, false);
        }

        if (context.version >= ver) {
            return context;
        }

        const next = new cls(id, ver, url, true);
        contexts.set(id, next);

        Object.defineProperty(context, "ready", { value: false, writable: false });
        context.detach(next);
        Object.freeze(context);
        next.attach();

        return next;
    }

    context = new cls(id, ver, url, true);
    contexts.set(id, context);
    context.attach();

    return context;
}

export default create;
