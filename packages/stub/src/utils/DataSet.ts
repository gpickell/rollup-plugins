import Element from "./Element";

class DataSet extends Map<string, any[]> {
    add(key: string, value: any) {
        let array = this.get(key);
        if (array === undefined) {
            this.set(key, array = []);
        }

        array.push(value);
    }

    addElement(key: string, attr?: Record<string, string | undefined>) {
        const element = new Element(key, attr);
        this.add(key, element);
        return element;
    }

    *records(context: any, ...keys: string[]) {
        let max = 0;
        for (const key of new Set(keys)) {
            const array = this.get(key);
            array && (max = Math.max(array.length, max));
        }

        let i = 0;
        while (i < max) {
            const result = [] as any[];
            for (const key of new Set(keys)) {
                const array = this.get(key);
                result.push(array ? array[i] : context[key]);
            }

            yield result;
            i++;
        }
    }
}

export default DataSet;
