export const next = new WeakMap<Context, Context | undefined>();

export class Context {
    readonly id: string;
    readonly url: string;
    readonly ready: boolean;
    readonly version: number;

    constructor(id: string, version: number, url: string, ready: boolean) {
        this.id = id;
        this.url = url;
        this.version = version;
        this.ready = ready;
    }

    attach() {
        
    }

    /**
     * 
     * @param next The next context to pass state to.
     */
    // @ts-expect-error
    detach(next?: Context) {
        
    }
}

export default Context;