import type { Dirent } from "fs";
import { Duplex, Readable } from "stream";

import { createHash } from "crypto";
import { FileHandle, open, readdir, stat } from "fs/promises";

class MemReadable extends Readable {
    constructor(data: Buffer) {
        super({
            autoDestroy: true,

            read() {
                this.push(data);
                this.push(null);
            }
        });

        this.byteLength = data.byteLength;
        this.data = data;
    }

    readonly byteLength: bigint | number;
    readonly data: Buffer;

    static async read(reader: Readable) {
        const bufs = [] as Buffer[];
        reader.on("data", x => bufs.push(x));
        await new Promise(x => reader.on("close", x));

        return new this(Buffer.concat(bufs));
    }
}

export function safeList(fn: string): Promise<Dirent[]> {
    return readdir(fn, { withFileTypes: true }).catch(() => []);
}

interface Stats {
    isDirectory(): boolean;
    isFile(): boolean;

    size: bigint | number;
    ctimeMs: bigint | number;
    ctimeNs?: bigint;
    mtimeMs: bigint | number;
    mtimeNs?: bigint;
}

function safeOpen(fn: string) {
    return open(fn, "r").catch(() => undefined);
}

function safeStat(ref: FileHandle | string): Promise<Stats | undefined> {
    if (typeof ref === "string") {
        return stat(ref, { bigint: true }).catch(() => undefined);    
    }
    
    return ref.stat({ bigint: true }).catch(() => undefined);    
}

function mtime(stats?: Stats) {
    if (stats?.isFile()) {
        if (stats.mtimeNs !== undefined) {
            return String(stats.mtimeNs);
        }

        if (stats.mtimeMs !== undefined) {
            return String(stats.mtimeMs);
        }
    }

    return "";
}

export class Entity {
    fsPath: string;
    urlPath: string;
    webPath: string;

    content?: Readable;
    fh?: FileHandle;
    files?: Dirent[];
    stats?: Stats;
    transform?: Duplex;
    
    cacheControl?: string;
    contentEncoding?: string;
    contentLength?: string;
    contentType?: string;
    data?: Buffer;
    date?: string;
    etag?: string;
    lastModified?: string;

    constructor(fsPath: string, webPath: string) {
        this.fsPath = fsPath;
        this.urlPath = webPath;
        this.webPath = webPath;
    }

    async list() {
        if (this.files !== undefined) {
            return this.files;
        }

        return this.files = await safeList(this.fsPath);
    }

    async stat() {
        if (this.stats !== undefined) {
            return true;
        }

        if (this.fh = await safeOpen(this.fsPath)) {
            if (this.stats = await safeStat(this.fh)) {
                const { stats } = this;
                if (stats.isFile()) {
                    this.contentLength = String(stats.size);
                    this.date = (new Date(Number(stats.ctimeMs))).toUTCString();
                    this.lastModified = (new Date(Number(stats.mtimeMs))).toUTCString();
                }
            }
        }
       
        return !!this.stats;
    }

    async load() {
        if (this.data !== undefined) {
            return new MemReadable(this.data);
        }
        
        if (this.fh === undefined) {
            throw new Error("Entity is not a file.")
        }

        const stream = this.fh.createReadStream();
        const mem = await MemReadable.read(stream);
        const { transform } = this;
        if (transform !== undefined) {
            mem.pipe(transform);

            const result = await MemReadable.read(transform);
            this.contentLength = String(result.byteLength);
            this.data = result.data;
    
            return result;
        }

        this.contentLength = String(mem.byteLength);
        this.data = mem.data;

        return mem;
    }

    async hash() {
        const { data, stats } = this;
        const hash = createHash("sha256");
        hash.update(`${this.fsPath}:`);
        hash.update(`${this.webPath}:`);
        hash.update(`${this.cacheControl}:`);
        hash.update(`${this.contentEncoding}:`);
        hash.update(`${this.contentLength}:`);
        hash.update(`${this.contentType}:`);
        hash.update(`${this.date}:`);
        hash.update(`${this.lastModified}:`);
        hash.update(`${mtime(stats)}:`);
        hash.update(`${!!this.data}:`);
        data && hash.update(data);

        return hash.digest("hex");
    }

    read(): Readable {
        if (this.data !== undefined) {
            return new MemReadable(this.data);
        }

        if (this.fh === undefined) {
            throw new Error("Entity is not a file.")
        }

        const stream = this.content = this.fh.createReadStream();
        const { transform } = this;
        if (transform !== undefined) {
            stream.pipe(transform);
            stream.on("error", err => transform.destroy(err));

            return transform;
        }

        return stream;
    }

    async close() {
        Object.freeze(this);

        await this.fh?.close();
        this.content?.destroy();
        this.transform?.destroy();
    }

    match(accept: Set<string>) {
        if (!this.data) {
            return false;
        }

        if (this.contentEncoding && !accept.has(this.contentEncoding)) {
            return false;
        }

        return true;
    }

    isDirectory() {
        return this.stats ? this.stats.isDirectory() : false;
    }

    isFile() {
        return this.stats ? this.stats.isFile() : false;
    }
}

export default Entity;
