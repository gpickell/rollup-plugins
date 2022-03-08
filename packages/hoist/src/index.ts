import type { Plugin } from "rollup";
import path from "path";

const suffix = "?hoist";

interface Target {
    id: string;
    external: boolean;
    importer?: string;

    toString(): string;
}

function slashify(dir: string, id: string) {
    if (id.startsWith(dir)) {
        id = id.substring(dir.length);
        id = `/${id}`;

        return id;
    }

    return id;
}

// @ts-expect-error
function defaultFilter(id: string, external: boolean, importer?: string) {
    return external;
}

function hoist(file: string, filter = defaultFilter): Plugin {
    function toString(this: Target) {
        const { id, importer } = this;
        return JSON.stringify({
            id: slashify(dir, id),
            importer: importer && slashify(dir, importer),
            external: this.external,
        });
    };

    let dir = process.cwd();
    dir = path.resolve(dir);
    dir = path.normalize(`${dir}/`);

    const ids = new Map<string, string>();
    const targets = new Map<string, Target>();
    return {
        name: "hoist",

        async resolveId(id, importer, opts) {
            if (id[0] === "\0" && id.endsWith(suffix)) {
                return { id, syntheticNamedExports: "exports" };
            }

            if (importer?.[0] === "\0" && id.endsWith(suffix)) {
                return undefined;                
            }

            const result = await this.resolve(id, importer, {
                ...opts, skipSelf: true
            });

            if (result === null) {
                return result;
            }

            if (filter(id, !!result.external, importer)) {
                const target: Target = {
                    id: result.id,
                    external: !!result.external,
                    importer,
                    toString,
                };

                const key = `${target}`;
                let id = ids.get(key);
                if (id === undefined) {
                    id = slashify(dir, result.id);
                    id = `\0${id}?${ids.size}${suffix}`;
                    ids.set(key, id);
                }

                targets.set(id, target);
                return { id, syntheticNamedExports: "exports" };
            }
          
            return result;
        },

        load(id) {
            const target = targets.get(id);
            if (target) {
                const { id, external } = target;
                const result = [                   
                    `import resolve from ${JSON.stringify(file)};\n`,
                    `const { id, external, importer } = ${target};\n`,
                ];

                if (external) {
                    result.push(`export const exports = await resolve(id, external, importer);\n`);
                } else {
                    result.unshift(`import * as module from ${JSON.stringify(id)};\n`);
                    result.push(`export const exports = await resolve(id, external, importer, module);\n`);
                }

                return result.join("");
            }

            return undefined;
        }
    };
}

export default hoist;
