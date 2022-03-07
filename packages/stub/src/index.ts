import type { OutputBundle, Plugin } from "rollup";

import path from "path";

import AssetSnapshot from "./utils/AssetSnapshot";
import DataSet from "./utils/DataSet";
import Element from "./utils/Element";
import Template from "./utils/Template";

function escapeHtml(value: string, last: string) {
    value = Element.escapeHtml(value);

    if (last.endsWith("=")) {
        return `"${value}"`;
    }

    return value;
}

function slashify(file: string) {
    file = path.normalize(path.join(".", file));
    file = file.replace(/[\\/]+/g, "/");
    
    return file;
}

function makeModuleRelative(id: string) {
    const result = slashify(id);
    return result.startsWith("../") ? result : `./${result}`;
}

const defualtKey = {} as any;
const defaultTemplate = `
<html>
    <head>
        <title>\${title}</title>
        \${meta}
        \${link}
    </head>
    <body>
        \${script}
    </body>
</html>
`;

function useDefault(): [any, string] {
    return [defualtKey, defaultTemplate];
}

function groupsOf(bundle: OutputBundle) {
    const assets: OutputBundle = {};
    for (const [key, chunk] of Object.entries(bundle)) {
        if (chunk.type === "asset") {
            assets[key] = chunk;
        }
    }

    const groups = new Map<string, OutputBundle>();
    for (const [key, chunk] of Object.entries(bundle)) {
        if (chunk.type === "chunk" && chunk.isEntry) {
            let group = groups.get(chunk.name);
            if (group === undefined) {
                groups.set(chunk.name, group = {...assets});
            }

            group[key] = chunk;
        }
    }

    for (const group of groups.values()) {
        const queue = new Set(Object.keys(group));
        for (const key of queue) {
            const chunk = bundle[key];
            if (chunk?.type === "chunk") {
                group[key] = chunk;

                for (const key of chunk.imports) {
                    queue.add(key);
                }

                for (const key of chunk.dynamicImports) {
                    queue.add(key);
                }
            }
        }
    }

    return groups;
}

namespace stub {
    interface BrowserCallback {
        (name: string, data: DataSet, bundle: OutputBundle): string | false | undefined;
    }   

    interface BrowserResolver {
        name: string;
        template: string;
        output(name: string, data: DataSet, bundle: OutputBundle): string | false;
        render(name: string, data: DataSet): void;
    }

    function browser(resolver: BrowserResolver): Plugin {
        const { name, template, output, render } = resolver;
        const dir = path.dirname(template);
        const tname = path.basename(template);
        return {
            name,

            async generateBundle(_, bundle) {
                const assets = await AssetSnapshot.load(dir);
                const templates = assets.split(x => x.endsWith(".html"));
                const results = assets.contents();
                const [entry, content] = templates.get(tname) || useDefault();
                const template = Template.cacheFile(this, content, entry);
                const groups = groupsOf(bundle);
                for (const [name, bundle] of groups) {
                    const files = new Set([...assets.keys(), ...Object.keys(bundle)]);
                    const data = assets.data(files);
                    for (const chunk of Object.values(bundle)) {
                        if (chunk.type === "chunk" && chunk.isEntry) {
                            render(chunk.fileName, data);
                        }
                    }

                    const target = output(name, data, bundle);
                    if (target) {
                        const file = slashify(target.endsWith("/") ? `${target}${tname}` : target);
                        const dir = slashify(path.dirname(file));
                        const result = template.apply(data, dir, escapeHtml);
                        results.set(file, result);
                    }
                }

                const keys = new Set(Object.keys(bundle));
                for (const [key, data] of results) {
                    if (!keys.has(key)) {
                        this.emitFile({
                            type: "asset",
                            fileName: key,
                            source: data
                        });
                    }
                }
            }
        };
    }

    function defaultHtmlTarget(name: string) {
        if (name.endsWith("index")) {
            return `${name}.html`;
        }

        return `${name}/index.html`;
    }

    export function browserModule(template = "static/index.html", cb?: BrowserCallback): Plugin {
        return browser({
            name: "stub-browser-module",
            template,

            output(name, ...args) {
                return cb?.(name, ...args) ?? defaultHtmlTarget(name);
            },
            
            render(name, data) {
                data.addElement("script", {
                    type: "module",
                    src: name,
                    crossorigin: "",
                    defer: "",
                });
            }
        });
    }

    export function browserScript(template = "static/index.html", cb?: BrowserCallback): Plugin {
        return browser({
            name: "stub-browser-script",
            template,

            output(name, ...args) {
                return cb?.(name, ...args) ?? defaultHtmlTarget(name);
            },
            
            render(name, data) {
                data.addElement("script", {
                    src: name,
                    crossorigin: "",
                    defer: "",
                });
            }
        });
    }

    interface NodeCallback {
        (name: string): string | false | undefined;
    }

    interface NodeResolver {
        name: string;
        output(name: string): string | false;
        render(name: string): string;
    }

    function node(resolver: NodeResolver): Plugin {
        const { name, output, render } = resolver;
        return {
            name,

            generateBundle(_, bundle) {
                const groups = groupsOf(bundle);
                for (const [key, bundle] of groups) {
                    let target = output(key);
                    if (target) {
                        if (target.endsWith("/")) {                        
                            target = path.join(target, "index.cjs");
                        }

                        target = slashify(target);

                        const code = [] as string[];
                        const dir = path.dirname(target);
                        for (const chunk of Object.values(bundle)) {
                            if (chunk.type === "chunk" && chunk.isEntry) {
                                const rel = path.join(path.relative(dir, chunk.fileName));
                                const ref = makeModuleRelative(rel);
                                code.push(render(ref));;
                            }
                        }

                        this.emitFile({
                            type: "asset",
                            fileName: target,
                            source: code.join(""),
                        });
                    }
                }
            }
        };
    }

    export function nodeImport(cb?: NodeCallback) {
        return node({
            name: "stub-node-module",

            output(name) {
                return cb?.(name) ?? `${name}.mjs`;
            },

            render(name) {
                return `import(${JSON.stringify(name)});\n`;
            },
        });
    }

    export function nodeRequire(cb?: NodeCallback) {
        return node({
            name: "stub-node-require",

            output(name) {
                return cb?.(name) ?? `${name}.cjs`;
            },

            render(name) {
                return `require(${JSON.stringify(name)});\n`;
            },
        });
    }
}

export default stub;
