class Virtual {
    readonly suffix: string;

    constructor(id: string) {
        this.suffix = `?${id}`;
    }

    match(id: string) {
        return id[0] === "\0" && id.endsWith(this.suffix);
    }

    ref(id: string) {
        return id.substring(1, id.length - this.suffix.length);
    }

    wrap(id: string) {
        return `\0${id}${this.suffix}`;
    }
}

export default Virtual;
