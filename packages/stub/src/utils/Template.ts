import type { PluginContext } from "rollup";

// @ts-ignore
import globals from "acorn-globals";
import DataSet from "./DataSet";
import Element from "./Element";

interface Line {
    (...args: any[]): [any, boolean][];
    keys: string[];
}

const cache = new WeakMap<any, Template>();

class Template extends Array<string | Line> {
    static error(value: string, lineNo: number) {
        const error = new Error("Error while parsing template line.");
        return Object.assign(error, { value, lineNo });
    }

    static parseLine(context: PluginContext, value: string, lineNo: number): string | Line {
        const code = `\`${value}\``;
        const node = context.parse(code);
        if (node.type !== "Program") {
            throw this.error(value, lineNo);
        }

        // @ts-ignore
        const { body } = node;
        if (body.length !== 1) {
            throw this.error(value, lineNo);
        }

        const stmt = body[0];
        if (stmt.type !== "ExpressionStatement") {
            throw this.error(value, lineNo);
        }

        const tmpl = stmt.expression;
        if (tmpl.type !== "TemplateLiteral") {
            throw this.error(value, lineNo);
        }

        const { expressions, quasis } = tmpl;
        if (expressions.length > 0) {
            const keys = globals(node).map((x: any) => x.name);
            const array = [...expressions, ...quasis];
            array.sort(({ start: x }, { start: y }) => {
                return Math.sign(x - y);
            });

            const result = ["return ["];
            for (const node of array) {
                if (result.length > 1) {
                    result.push(",");
                }

                if (node.type === "TemplateElement") {
                    const value = JSON.stringify(node.value.cooked);
                    result.push(`[${value}, false]`);
                } else {
                    const { start, end } = node;
                    const value = code.substring(start, end);
                    result.push(`[${value},true]`);
                }
            }

            result.push("];");
            
            const fn = new Function(...keys, result.join(""));
            return Object.assign(fn, { keys }) as any;
        }

        if (quasis.length > 0) {
            return quasis[0].value.cooked;
        }

        return "";
    }

    static parseFile(context: PluginContext, value: string): Template {
        let i = 0;
        const result = new Template();
        for (const text of value.split(/\r?\n/)) {
            result.push(this.parseLine(context, text, i++));
        }

        return result;
    }

    static cacheFile(context: PluginContext, data: string | Buffer, ctx: any) {
        const current = cache.get(ctx);
        if (current !== undefined) {
            return current;
        }

        const template = this.parseFile(context, data.toString());
        cache.set(ctx, template);
        return template;
    }

    apply(data: DataSet, dir: string, escape: (value: any, last: string) => string = String) {
        const result = [] as string[];
        for (const line of this) {
            if (typeof line === "string") {
                result.push(line);
                result.push("\n");
            }

            if (typeof line === "function") {
                for (const record of data.records(global, ...line.keys)) {
                    let last = "";
                    const array = line(...record);
                    const value = array.map(([part, esc]) => {
                        if (Element.isRender(part)) {
                            return last = part.render(dir);
                        }

                        if (esc) {
                            return last = escape(part, last);
                        }

                        return last = String(part);
                    });

                    result.push(value.join(""));
                    result.push("\n");
                }
            }
        }

        return result.join("").trim();
    }
}

export default Template;
