import path from "path";

export function urlToPath(url: string | URL, rel?: string) {
    url = new URL(url);
    
    if (rel !== undefined) {
        url = new URL(rel, url);
    }
    
    if (url.protocol !== "file:") {
        throw new Error("URL not a file URL: " + url.toString());
    }

    const pathname = decodeURIComponent(url.pathname);
    if (url.hostname.length > 0) {
        return path.resolve(`//${url.hostname}${pathname}`)
    }

    if (pathname[2] === ":") {
        const rel = pathname.substring(1);
        return path.resolve(rel);
    }

    return path.resolve(pathname);
}
