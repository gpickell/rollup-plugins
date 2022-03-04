export class Context {
    readonly id: string;
    readonly url: string;
    readonly ready: boolean;
    readonly version: number;

    constructor(id: string, version: number, url: string, ready: boolean) {
        this.id = id;
        this.ready = ready;
        this.url = url;
        this.version = version;
    }

    attach() {
        
    }

    // @ts-expect-error
    detach(ctx?: Context) {
        
    }
}

export default Context;