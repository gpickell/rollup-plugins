import type Context from "./Context";

function create(id: string, cls: typeof Context, ver: number, url: string) {
    return new cls(id, ver, url, false);
}

export default create;
