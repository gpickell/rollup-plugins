import type { IncomingMessage, ServerResponse } from "http";

import { FSWatcher, watch } from "fs";
import { mkdir } from "fs/promises";

import Entity, { safeList } from "./Entity";

import http from "http";
import path from "path";
import zlib from "zlib";

const hashx = /\.[a-zA-Z0-9]+\.[a-zA-Z0-9]+$/;
const slashx = /[\\/]+/g;
const tailx = /.*\//;

class ChangeArray extends Array<string> {
    readonly resolve: () => void;
    readonly promise: Promise<void>;

    constructor() {
        super();
        let resolve!: () => void;
        this.promise = new Promise<void>(x => resolve = x);
        this.resolve = resolve;
    }

    push(...items: string[]) {
        this.resolve();
        return super.push.apply(this, items);
    }
}

function slashify(value: string) {
    return value.replace(slashx, "/");
}

export interface RequestHandler {
    (req: IncomingMessage, res: ServerResponse, next: () => any): any;
}

export class Cache extends Map<string, Entity> {
    
}

export class ContentTypes extends Map<string, string> {
    fallback?: string = "application/octet-stream";

    constructor() {
        super(Object.entries({            
            ".html": "text/html",
            ".css": "text/css",
            ".md": "text/markdown",
            ".txt": "text/plain",

            ".js": "text/javascript",
            ".cjs": "text/javascript",
            ".mjs": "text/javascript",

            ".apng": "image/apng",
            ".avi": "image/avif",
            ".gif": "image/gif",
            ".ico": "image/x-icon",
            ".jpg": "image/jpeg",
            ".png": "image/png",
            ".svg": "image/svg+xml",
            ".webp": "image/webp",

            ".json": "application/json",
        }));
    }
}

export class IndexFiles extends Set<string> {
    constructor() {
        super();
        this.add("index.html");
    }
}

class FileServer extends Array<RequestHandler> {

    constructor() {
        super();
        this.process = this.process.bind(this);
    }

    readonly cache = new Cache();
    readonly contentTypes = new ContentTypes();
    readonly indexFiles = new IndexFiles();
    readonly watchers = new Set<Promise<FSWatcher>>();

    cwd = process.cwd();
    log = false;

    final(req: IncomingMessage, res: ServerResponse) {
        req.resume();
        res.statusCode = 404;
        res.end();
    }

    async process(req: IncomingMessage, res: ServerResponse, next: () => any = () => this.final(req, res)) {
        for (const handler of this) {
            await new Promise<void>(async next => {
                let done = false;
                let forward = false;
                try {
                    await handler(req, res, () => {
                        forward = true;

                        if (done) {
                            done = false;
                            next();
                        }
                    });

                    if (forward) {
                        next();
                    } else {
                        done = true;
                    }
                } catch (ex) {
                    this.error(req, res, 500, ex);
                }
            });
        }

        next();
    }

    isInScope(prefix: string, path: string) {
        if (path.startsWith(prefix)) {
            return true;
        }

        if (prefix.startsWith(path)) {
            const tail = prefix.substring(path.length);
            return tail === "/" || tail === "\\";
        }

        return false;
    }

    contentType(fn: string) {
        return this.contentTypes.get(path.extname(fn));
    }

    reparse(webPath: string, fsPath: string, url: string) {
        const { href, pathname } = new URL(url, "local:///");
        if (!href.startsWith("local:///")) {
            return undefined;
        }

        const requestPath = slashify(decodeURIComponent(pathname));
        if (!this.isInScope(webPath, requestPath)) {
            return undefined;
        }

        const suffix = url.substring(webPath.length);
        const fn = path.resolve(path.join(fsPath, suffix));
        if (!this.isInScope(fsPath, fn)) {
            return undefined;
        }

        const entity = new Entity(fn, requestPath);
        entity.contentType = this.contentType(entity.fsPath);

        return entity;
    }

    async resolve(entity: Entity) {
        await entity.stat();

        if (entity.isDirectory()) {
            const { indexFiles } = this;
            const webPath = slashify(`${entity.webPath}/`);
            if (webPath !== entity.urlPath) {
                for (const entry of await entity.list()) {
                    const fn = path.join(entity.fsPath, entry.name);
                    if (entry.isFile() && indexFiles.has(entry.name) && this.contentType(fn)) {
                        entity.webPath = webPath;
                        break;
                    }
                }

                return entity;
            }

            for (const index of this.indexFiles) {
                const fn = path.join(entity.fsPath, index);
                const child = new Entity(fn, entity.webPath);
                child.contentType = this.contentType(child.fsPath);
                await child.stat();

                if (child.isFile() && child.contentType) {
                    await entity.close();
                    return child;
                }

                await child.close();
            }

            return entity;
        }

        if (entity.isFile() && entity.contentType) {
            return entity;
        }

        return undefined;
    }

    error(req: IncomingMessage, res: ServerResponse, statusCode: number, err?: any) {
        req.resume();
        res.statusCode = statusCode;
        res.end();

        if (this.log && err) {
            console.error("Request Failure: %s, ", req.url, err);
        }
    }

    redirect(req: IncomingMessage, res: ServerResponse, statusCode: number, path: string) {
        req.resume();
        res.setHeader("Location", path);
        res.statusCode = statusCode;
        res.end();
    }

    acceptEncoding(req: IncomingMessage) {
        let header = req.headers["accept-encoding"];
        const result = new Set<string>();
        if (header === undefined) {
            return result;
        }

        if (Array.isArray(header)) {
            header = header.join(", ");
        }
       
        for (const part of header.split(",")) {
            const [type] = part.split(";");
            result.add(type.trim());
        }

        return result;
    }

    hit(entity: Entity, accept: Set<string>) {
        const file = this.cache.get(entity.fsPath);
        if (file && file.match(accept)) {
            entity.contentEncoding = file.contentEncoding;
            entity.contentLength = file.contentLength;
            entity.data = file.data;

            return true;
        }

        return false;
    }

    async compress(req: IncomingMessage, entity: Entity) {
        const accept = this.acceptEncoding(req);
        if (this.hit(entity, accept)) {
            return true;
        }

        if (accept.has("deflate")) {
            entity.contentEncoding = "deflate";
            entity.transform = zlib.createDeflate();
            return true;
        }

        if (accept.has("gzip")) {
            entity.contentEncoding = "gzip";
            entity.transform = zlib.createGzip();
            return true;
        }

        return false;
    }

    async tag(entity: Entity) {
        const hash = await entity.hash();
        entity.etag = `"${hash}"`;
    }

    isDynamic(entity: Entity) {
        const fn = entity.fsPath;
        const ext = path.extname(fn);
        switch (ext) {
            case ".cjs":
            case ".mjs":
            case ".js":
                break;

            default:
                return true;
        }

        const dir = path.dirname(fn);
        switch (path.basename(dir)) {
            case "assets":
            case "static":
                break;

            default:
                return true;
        }

        if (hashx.test(fn)) {
            return false;
        }

        return true;
    }

    check(req: IncomingMessage, entity: Entity) {
        const { etag, lastModified } = entity;
        const ifnm = req.headers["if-none-match"];
        if (etag && ifnm) {
            for (const part of ifnm.split(",")) {
                if (part.trim() === etag) {
                    return true;
                }
            }
        } else {
            const ifms = req.headers["if-modified-since"];
            if (lastModified && ifms && lastModified === ifms) {
                return true;
            }
        }

        return false;
    }

    async writeDirectory(req: IncomingMessage, res: ServerResponse, entity: Entity) {
        if (entity.webPath !== entity.urlPath) {
            let suffix = entity.urlPath.replace(tailx, "");
            suffix = encodeURIComponent(suffix);

            return this.redirect(req, res, 302, `${suffix}/`);
        }
        
        return this.error(req, res, 403);
    }

    async writeFile(req: IncomingMessage, res: ServerResponse, entity: Entity) {
        await this.compress(req, entity);

        if (this.isDynamic(entity)) {
            await entity.load();
        }

        if (this.isDynamic(entity)) {
            entity.cacheControl = "must-revalidate";
        } else {
            entity.cacheControl = "public, max-age=604800, immutable";
        }

        await this.tag(entity);

        entity.cacheControl && res.setHeader("Cache-Control", entity.cacheControl);
        entity.contentEncoding && res.setHeader("Content-Encoding", entity.contentEncoding);
        entity.contentLength && res.setHeader("Content-Length", entity.contentLength);
        entity.contentType && res.setHeader("Content-Type", entity.contentType);
        entity.date && res.setHeader("Date", entity.date);
        entity.etag && res.setHeader("ETag", entity.etag);
        entity.lastModified && res.setHeader("Last-Modified", entity.lastModified);
        res.setHeader("Vary", "Accept, Accept-Encoding");
        
        req.resume();

        if (this.check(req, entity)) {
            res.statusCode = 304;
            res.end();
        } else {
            res.statusCode = 200;

            if (req.method !== "HEAD") {
                const stream = await entity.read();
                const promise = new Promise(x => res.on("unpipe", x));
                stream.pipe(res);
                await promise;
            } else {
                res.end();
            }
        }
    }

    timer(res: ServerResponse, delay: number) {
        return new Promise<void>(resolve => {
            if (res.destroyed) {
                resolve();
            } else {
                let timer: any;
                const tick = () => {
                    timer = undefined;
                    resolve();
                };
                
                res.on("close", () => {
                    resolve();
                    timer !== undefined && clearTimeout(timer);
                });
    
                timer = setTimeout(tick, delay);
            }
        });
    }

    prepareForReparse(webPath: string, fsPath: string, ...rels: string[]): [string, string] {
        const rel = rels.join("/");
        webPath = slashify(`/${webPath}/${rel}/`);
        fsPath = path.resolve(this.cwd, path.join(fsPath, rel));
        fsPath = path.normalize(`${fsPath}/`);

        return [webPath, fsPath];
    }

    serveFiles(webPath: string, fsPath: string, ...rels: string[]) {
        [webPath, fsPath] = this.prepareForReparse(webPath, fsPath, ...rels);

        this.push(async (req, res, next) => {
            let entity: Entity | undefined;
            try {
                if (req.url) {
                    entity = this.reparse(webPath, fsPath, req.url);
                }

                if (entity) {
                    entity = await this.resolve(entity);
                }

                if (entity) {
                    const { method } = req;
                    if (method === "HEAD" || method === "GET") {
                        if (entity.isDirectory()) {
                            return await this.writeDirectory(req, res, entity);
                        }

                        if (entity.isFile()) {
                            return await this.writeFile(req, res, entity);
                        }

                        return this.error(req, res, 500);
                    }

                    return this.error(req, res, 405);
                }

                next();
            } catch (err) {
                this.error(req, res, 500, err);
            } finally {
                await entity?.close();
            }
        });
    }

    serveTrack(webPath: string, fsPath: string, ...rels: string[]) {
        [webPath, fsPath] = this.prepareForReparse(webPath, fsPath, ...rels);

        let promise: Promise<void> | undefined;
        let resolve: (() => void) | undefined;
        let pending = false;
        let looping = false;
        const activate = async () => {
            pending = true;

            if (looping) {
                return;
            }

            looping = true;

            if (promise === undefined) {
                promise = new Promise<void>(x => resolve = x);
            }

            while (pending) {
                pending = false;

                let files = false;
                let locks = false;
                for (const file of await safeList(fsPath)) {
                    if (file.isFile()) {
                        if (file.name.startsWith("lock-")) {
                            locks = true;
                        } else {
                            files = true;
                        }
                    }
                }

                if (files && !locks) {
                    resolve?.();
                    promise = undefined;
                    resolve = undefined;
                }
            }

            looping = false;
        };

        const startup = async () => {
            await mkdir(fsPath, { recursive: true });

            const watcher = watch(fsPath, { persistent: false });
            watcher.on("change", activate);

            watcher.on("error", err => {
                this.log && console.log("Could not watch folder [%s]:", fsPath, err);
            });

            await activate();

            return watcher;
        };

        let init: Promise<FSWatcher> | undefined;
        this.push(async (req, res, next) => {
            let entity: Entity | undefined;
            try {
                if (req.url) {
                    entity = this.reparse(webPath, fsPath, req.url);
                }

                if (entity) {
                    if (init === undefined) {
                        init = startup();
                        this.watchers.add(init);
                    }

                    await init;
                    await promise;
                }

                next();
            } catch (err) {
                this.error(req, res, 500, err);
            } finally {
                await entity?.close();
            }
        });
    }

    serveWatch(webPath: string, fsPath: string, ...rels: string[]) {
        [webPath, fsPath] = this.prepareForReparse(webPath, fsPath, ...rels);

        const changes = new Set<string[]>();
        const startup = async () => {
            await mkdir(fsPath, { recursive: true });

            const watcher = watch(fsPath, { persistent: false });
            watcher.on("change", (_, fn) => {
                for (const array of changes) {
                    array.push(fn.toString());
                }
            });

            watcher.on("error", err => {
                this.log && console.log("Could not watch folder [%s]:", fsPath, err);
            });

            return watcher;
        };

        let init: Promise<FSWatcher> | undefined;
        const accept = "application/json; watch";
        this.push(async (req, res, next) => {
            if (req.headers.accept !== accept) {
                return next();
            }

            let entity: Entity | undefined;
            try {
                if (req.url) {
                    entity = this.reparse(webPath, fsPath, req.url);
                }

                if (entity && fsPath.startsWith(entity.fsPath)) {
                    const { method } = req;
                    if (method === "POST") {
                        if (init === undefined) {
                            init = startup();
                            this.watchers.add(init);
                        }

                        await init;

                        req.resume();
                        res.setHeader("Connection", "close");
                        res.setHeader("Content-Type", accept);
                        res.statusCode = 200;
                        res.flushHeaders();

                        const array = new ChangeArray();
                        changes.add(array);

                        try {
                            const maxTimer = this.timer(res, 25000);
                            await Promise.race([maxTimer, array.promise]);
                            await this.timer(res, 100);

                            const set = new Set(array);
                            res.write(JSON.stringify({ changes: set }));

                            return res.end();
                        } finally {
                            changes.delete(array);
                        }
                    }

                    return this.error(req, res, 405);
                }

                next();
            } catch (err) {
                this.error(req, res, 500, err);
            } finally {
                await entity?.close();
            }
        });
    }

    preload(fsPath: string, encoding?: "br" | "deflate" | "gzip") {
        if (!encoding && !!zlib.createBrotliCompress) {
            encoding = "br";
        }

        if (!encoding) {
            encoding = "deflate";
        }

        const load = async (entity: Entity) => {
            switch (encoding) {
                case "br":
                    entity.contentEncoding = encoding;
                    entity.transform = zlib.createBrotliCompress();
                    break;

                case "deflate":
                    entity.contentEncoding = encoding;
                    entity.transform = zlib.createDeflate();
                    break;

                case "gzip":
                    entity.contentEncoding = encoding;
                    entity.transform = zlib.createGzip();
                    break;
            }

            try {
                if (await entity.stat() && entity.isFile()) {
                    await entity.load();
                }
            } catch {
                // don't care
            } finally {
                await entity.close();
            }
        };

        const scan = async () => {
            const ops = [] as any[];
            const dirs = new Set<string>();
            dirs.add(path.resolve(this.cwd, fsPath));

            for (const dir of dirs) {
                for (const dirent of await safeList(dir)) {
                    const fn = path.join(dir, dirent.name);
                    if (dirent.isDirectory()) {
                        dirs.add(fn);
                    }

                    if (dirent.isFile() && !this.cache.has(fn)) {
                        const entity = new Entity(fn, "");
                        this.cache.set(fn, entity);
                        ops.push(load(entity));
                    }
                }
            }

            await Promise.all(ops);
        };

        const promise = scan();
        this.push(async (_req, _res, next) => {
            await promise;
            next();
        });

        return promise;
    }

    configure(dev = false, preload = false, root = "dist") {
        if (dev) {
            this.serveTrack("/", root);
            this.serveWatch("/", root, "hot");
        }

        if (preload) {
            this.preload("dist");
        }

        this.serveFiles("/", root);
    }

    static createServer(dev = false, preload = false, root = "dist", spec = "7180/localhost") {
        const mw = new FileServer();
        mw.configure(dev, preload, root);

        const server = http.createServer();
        server.on("request", mw.process);

        const [port, host] = spec.split("/");
        if (Number(port) > 0 && Number(port) < 0xffff) {
            server.listen(Number(port), host);
        } else {
            server.listen(spec);
        }

        return {
            middleware: mw,
            server,
        };
    }
}

export default FileServer;