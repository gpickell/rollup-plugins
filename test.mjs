import minim from "minimatch";

const { Minimatch } = minim;
const mm = new Minimatch("*.txt");
console.log(mm.negate);
console.log(mm.match("test.txt"));

