import path from "path";

function slashify(file: string) {
    file = path.normalize(path.join(".", file));
    file = file.replace(/[\\/]+/g, "/");
    
    return file;
}

interface Render {
    render(dir: string): string;
    toString(): string;
}

class Result implements Render {
    readonly value: string;

    constructor(value: string) {
        this.value = value;
    }

    render() {
        return this.value;
    }

    toString() {
        return this.value;
    }
}

class Element {
    readonly name: string;
    readonly attr: Record<string, string | undefined>;
    innerHTML?: string;

    constructor(name: string, attr?: Record<string, string | undefined>) {
        this.name = name;
        this.attr = attr ? {...attr} : {};

        if (name === "script") {
            this.innerHTML = "";
        }
    }

    start(): Render {
        return {
            render: dir => this.renderStart(dir),
            toString: () => this.renderStart("./")
        };
    }

    end() {
        if (typeof this.innerHTML === "string") {
            return new Result(`</${this.name}>`);
        }

        return "";
    }

    render(dir: string) {
        const start = this.renderStart(dir);
        const end = this.end();
        const inner = typeof this.innerHTML === "string" ? this.innerHTML : "";
        return `${start}${inner}${end}`;
    }

    renderAttribute(key: string, dir: string) {
        let value = this.attr[key];
        if (value === undefined || value.length < 1) {
            return key;
        }

        if (!value.startsWith("data:")) {
            if (key === "src") {
                value = path.relative(dir, value);
                value = slashify(value);
            }

            if (key === "href") {
                value = path.relative(dir, value);
                value = slashify(value);
            }
        }

        value = Element.escapeHtml(value);
        return `${key}="${value}"`;
    }

    renderStart(dir: string) {
        const result = [`<${this.name}`];
        for (const key in this.attr) {
            result.push(" ");
            result.push(this.renderAttribute(key, dir));
        }

        if (typeof this.innerHTML === "string") {
            result.push(">");
        } else {
            result.push(" />");
        }

        return result.join("");
    }

    toString() {
        return this.render("./");
    }

    static isRender(value: unknown): value is Render {
        if (typeof value !== "object") {
            return false;
        }

        if (value === null) {
            return false;
        }

        const { render } = value as any;
        if (typeof render === "function") {
            return true;
        }

        return false;
    }

    static escapeHtml(value: string) {
        return value.replace(/[]/g, ch => {
            switch (ch.charCodeAt(0)) {
                case 34: // "
                    return "&quot;";
                case 38: // &
                    return "&amp;";
                case 39: // '
                    return "&#39;";
                case 60: // <
                    return "&lt;";
                case 62: // >
                    return "&gt;";
            }
    
            return ch;
        });
    }
}

export default Element;